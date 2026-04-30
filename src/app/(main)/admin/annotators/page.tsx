import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getLocale, t } from "@/lib/i18n/server";
import { AnnotatorsPageClient } from "@/components/admin/annotators-page-client";
import type {
  AssignmentAnnotatorRow,
  AssignmentPkgGroup,
  AssignmentMemberRow,
} from "@/components/admin/assignment-management-tab";
import type { PeopleRow } from "@/components/admin/people-management-tab";
import { listCalibrationBatches } from "@/app/(main)/admin/annotators/assessment-action";
import { listCalibrationLeaderboard } from "@/app/(main)/admin/annotators/leaderboard-action";
import type { LeaderboardResponse } from "@/app/(main)/admin/annotators/leaderboard-action";
import { listAnnotatorsForCredentials } from "@/app/(main)/admin/annotators/credential-action";
import { calculateIntegrity } from "@/lib/integrity";
import { getAdminScope, getScopedUserIds } from "@/lib/admin-scope";

type TabId =
  | "assignment"
  | "people"
  | "groups"
  | "calibration"
  | "credentials";

function normalizeTab(raw: string | undefined): TabId {
  if (
    raw === "people" ||
    raw === "groups" ||
    raw === "calibration" ||
    raw === "credentials"
  )
    return raw;
  return "assignment";
}

interface Props {
  searchParams: Promise<{ tab?: string; pkg?: string }>;
}

export default async function AnnotatorsPage({ searchParams }: Props) {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") redirect("/tasks");
  const locale = await getLocale();
  const { tab: rawTab, pkg: selectedPkgId } = await searchParams;
  const activeTab = normalizeTab(rawTab);

  // Resolve the visible annotator-id universe once. SYSTEM scope gets the
  // sentinel "ALL" and every subsequent query skips the user filter.
  const scopedUserIds = await getScopedUserIds(scope);
  const scopedUserIdList = scopedUserIds === "ALL" ? null : [...scopedUserIds];
  const userIdWhere = scopedUserIdList
    ? { id: { in: scopedUserIdList } }
    : {};

  // Shared data for all tabs
  const [annotators, publishedPackages, groups] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: { in: ["ANNOTATOR", "VENDOR_ANNOTATOR"] },
        deletedAt: null,
        ...userIdWhere,
      },
      select: {
        id: true,
        name: true,
        email: true,
        accountType: true,
        riskLevel: true,
        gender: true,
        ageRange: true,
        city: true,
        education: true,
        groupMemberships: {
          select: {
            isAdmin: true,
            group: { select: { id: true, name: true } },
          },
        },
        tags: {
          select: {
            source: true,
            confidence: true,
            tag: { select: { id: true, name: true, nameEn: true } },
          },
        },
        capabilityAssessments: {
          orderBy: { assessmentDate: "desc" },
          take: 1,
          select: {
            accuracy: true,
            consistency: true,
            coverage: true,
            detailOriented: true,
            speed: true,
            compositeScore: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.evaluationPackage.findMany({
      where: { status: "PUBLISHED", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        taskType: true,
        evaluationMode: true,
        deadline: true,
        startAt: true,
        createdAt: true,
      },
    }),
    prisma.annotatorGroup.findMany({
      where:
        scope.kind === "GROUP"
          ? { id: { in: scope.groupIds } }
          : undefined,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        location: true,
        organization: true,
        monthlyQuota: true,
        memberships: {
          select: {
            isAdmin: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                accountType: true,
              },
            },
          },
        },
      },
    }),
  ]);

  // Natural sort users: "User 2" before "User 10"
  annotators.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // Item counts: scope to pkg if selected, else global
  const pkgItemWhere = selectedPkgId ? { packageId: selectedPkgId } : {};
  const itemStats = await prisma.evaluationItem.groupBy({
    by: ["assignedToId", "status"],
    where: pkgItemWhere,
    _count: { _all: true },
  });
  const userItemMap = new Map<string, { completed: number; total: number }>();
  for (const row of itemStats) {
    const bucket = userItemMap.get(row.assignedToId) ?? { completed: 0, total: 0 };
    bucket.total += row._count._all;
    if (row.status === "COMPLETED") bucket.completed += row._count._all;
    userItemMap.set(row.assignedToId, bucket);
  }

  // Per-(user, package, status) breakdown — powers the package-grouped ledger.
  // Unions EvaluationItem (SCORING mode) and ArenaItem (ARENA mode) so Arena
  // packages show real progress instead of empty rows. The keying strategy
  // "pkgId::userId" keeps the two sources flat without introducing nested maps.
  const [evalPerUserPkg, arenaPerUserPkg] = await Promise.all([
    prisma.evaluationItem.groupBy({
      by: ["assignedToId", "packageId", "status"],
      _count: { _all: true },
    }),
    prisma.arenaItem.groupBy({
      by: ["assignedToId", "packageId", "status"],
      _count: { _all: true },
    }),
  ]);
  const perUserPkg = new Map<string, { completed: number; total: number }>();
  const upsertPerUserPkg = (
    uid: string,
    pid: string,
    status: string,
    n: number
  ) => {
    const key = `${pid}::${uid}`;
    const bucket = perUserPkg.get(key) ?? { completed: 0, total: 0 };
    bucket.total += n;
    if (status === "COMPLETED") bucket.completed += n;
    perUserPkg.set(key, bucket);
  };
  for (const row of evalPerUserPkg) {
    if (!row.packageId) continue;
    upsertPerUserPkg(
      row.assignedToId,
      row.packageId,
      row.status,
      row._count._all
    );
  }
  for (const row of arenaPerUserPkg) {
    if (!row.packageId) continue;
    upsertPerUserPkg(
      row.assignedToId,
      row.packageId,
      row.status,
      row._count._all
    );
  }

  // 14-day daily submission histogram per user (oldest → newest)
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const trendStart = new Date(todayStart.getTime() - 13 * MS_PER_DAY);
  const dailyRows = await prisma.$queryRaw<
    Array<{ user_id: string; day: Date; count: bigint }>
  >`
    SELECT assigned_to_id AS user_id,
           DATE_TRUNC('day', completed_at) AS day,
           COUNT(*)::bigint AS count
    FROM evaluation_items
    WHERE status = 'COMPLETED'
      AND completed_at >= ${trendStart}
    GROUP BY assigned_to_id, DATE_TRUNC('day', completed_at)
  `;
  const userTrendMap = new Map<string, number[]>();
  for (const row of dailyRows) {
    const bucket = userTrendMap.get(row.user_id) ?? Array(14).fill(0);
    const dayStart = new Date(row.day);
    dayStart.setHours(0, 0, 0, 0);
    const idx = Math.round((dayStart.getTime() - trendStart.getTime()) / MS_PER_DAY);
    if (idx >= 0 && idx < 14) bucket[idx] = Number(row.count);
    userTrendMap.set(row.user_id, bucket);
  }

  // Real Score aggregates per user (scope by selected package if any). Uses
  // EvaluationItem.packageId (authoritative) to stay consistent with the
  // detail page's counts, avoiding the list-vs-detail inconsistency that
  // hardcoded `suspiciousCount: 0` previously caused.
  const scoreWhere = selectedPkgId
    ? { evaluationItem: { packageId: selectedPkgId } }
    : {};
  const eventWhere = selectedPkgId
    ? { evaluationItem: { packageId: selectedPkgId } }
    : {};

  const [scoreStats, scoreAvgs, eventStats] = await Promise.all([
    prisma.score.groupBy({
      by: ["userId", "validity"],
      where: scoreWhere,
      _count: { _all: true },
    }),
    prisma.score.groupBy({
      by: ["userId"],
      where: { ...scoreWhere, validity: "VALID" },
      _avg: { value: true },
    }),
    prisma.antiCheatEvent.groupBy({
      by: ["userId", "severity"],
      where: eventWhere,
      _count: { _all: true },
    }),
  ]);

  interface ScoreAgg {
    total: number;
    suspicious: number;
    invalid: number;
    critical: number;
    warning: number;
    avg: number | null;
  }
  const userScoreAgg = new Map<string, ScoreAgg>();
  const ensureAgg = (uid: string): ScoreAgg => {
    const existing = userScoreAgg.get(uid);
    if (existing) return existing;
    const fresh: ScoreAgg = {
      total: 0,
      suspicious: 0,
      invalid: 0,
      critical: 0,
      warning: 0,
      avg: null,
    };
    userScoreAgg.set(uid, fresh);
    return fresh;
  };
  for (const row of scoreStats) {
    const agg = ensureAgg(row.userId);
    const n = row._count._all;
    agg.total += n;
    if (row.validity === "SUSPICIOUS") agg.suspicious += n;
    else if (row.validity === "INVALID") agg.invalid += n;
  }
  for (const row of scoreAvgs) {
    ensureAgg(row.userId).avg = row._avg.value;
  }
  for (const row of eventStats) {
    const agg = ensureAgg(row.userId);
    if (row.severity === "CRITICAL") agg.critical += row._count._all;
    else if (row.severity === "WARNING") agg.warning += row._count._all;
  }

  // Shape Assignment rows (flat user-centric — kept for legacy consumers)
  const assignmentRows: AssignmentAnnotatorRow[] = annotators.map((u) => {
    const primary = u.groupMemberships[0];
    const itemStats = userItemMap.get(u.id) ?? { completed: 0, total: 0 };
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      accountType: u.accountType,
      riskLevel: u.riskLevel,
      groupName: primary?.group.name ?? null,
      isGroupAdmin: u.groupMemberships.some((m) => m.isAdmin),
      completed: itemStats.completed,
      total: itemStats.total,
      capability: u.capabilityAssessments[0] ?? null,
    };
  });

  // Shape package-grouped assignment ledger (Bold UI primary data shape).
  // Sort order: overdue first, then ascending deadline, then no-deadline last
  // — mirrors how on-call engineers prioritize: what's on fire, what's next.
  const annotatorById = new Map(annotators.map((u) => [u.id, u]));
  const now = new Date();
  const pkgGroups: AssignmentPkgGroup[] = publishedPackages.map((pkg) => {
    const members: AssignmentMemberRow[] = [];
    for (const u of annotators) {
      const key = `${pkg.id}::${u.id}`;
      const stats = perUserPkg.get(key);
      if (!stats || stats.total === 0) continue;
      const primary = u.groupMemberships[0];
      const agg = userScoreAgg.get(u.id);
      members.push({
        userId: u.id,
        name: u.name,
        email: u.email,
        accountType: u.accountType,
        riskLevel: u.riskLevel,
        groupName: primary?.group.name ?? null,
        isGroupAdmin: u.groupMemberships.some((m) => m.isAdmin),
        completed: stats.completed,
        total: stats.total,
        avgScore: agg?.avg ?? null,
        suspiciousCount: agg?.suspicious ?? 0,
        capability: u.capabilityAssessments[0] ?? null,
      });
    }
    // Natural-sort members within each package for predictable reading order.
    members.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    const accountTypes = new Set(members.map((m) => m.accountType));
    const annotatorTypeMix: AssignmentPkgGroup["annotatorTypeMix"] =
      accountTypes.size === 0
        ? "NONE"
        : accountTypes.size > 1
          ? "MIXED"
          : accountTypes.has("INTERNAL")
            ? "INTERNAL"
            : "VENDOR";
    return {
      packageId: pkg.id,
      packageName: pkg.name,
      taskType: pkg.taskType,
      evaluationMode: pkg.evaluationMode,
      deadline: pkg.deadline,
      startAt: pkg.startAt,
      createdAt: pkg.createdAt,
      annotatorTypeMix,
      members,
    };
  });
  // Derive per-package overdue flag from deadline + completion: if any pending
  // items remain past deadline, the package is overdue. Completed packages stay
  // at the bottom regardless of deadline.
  pkgGroups.sort((a, b) => {
    const aIncomplete = a.members.some((m) => m.completed < m.total);
    const bIncomplete = b.members.some((m) => m.completed < m.total);
    const aOverdue = aIncomplete && a.deadline != null && a.deadline < now;
    const bOverdue = bIncomplete && b.deadline != null && b.deadline < now;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    // Both overdue or both not — ascending deadline, nulls last
    if (a.deadline && b.deadline) return a.deadline.getTime() - b.deadline.getTime();
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return a.packageName.localeCompare(b.packageName, undefined, { numeric: true });
  });
  // `annotatorById` retained in scope intentionally for future dialog data
  void annotatorById;

  // Shape People rows
  const peopleRows: PeopleRow[] = annotators.map((u) => {
    const primary = u.groupMemberships[0];
    const stats = userItemMap.get(u.id) ?? { completed: 0, total: 0 };
    const agg = userScoreAgg.get(u.id);
    const integrityResult = agg
      ? calculateIntegrity({
          totalScores: agg.total,
          suspiciousCount: agg.suspicious,
          invalidCount: agg.invalid,
          criticalEvents: agg.critical,
          warningEvents: agg.warning,
        })
      : null;
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      accountType: u.accountType,
      groupName: primary?.group.name ?? null,
      riskLevel: u.riskLevel,
      completed: stats.completed,
      total: stats.total,
      compositeScore: u.capabilityAssessments[0]?.compositeScore ?? null,
      avgScore: agg?.avg ?? null,
      suspiciousCount: agg?.suspicious ?? 0,
      integrity: integrityResult?.score ?? null,
      trend: userTrendMap.get(u.id) ?? Array(14).fill(0),
      tags: u.tags.map((ut) => ({
        tagId: ut.tag.id,
        name: ut.tag.name,
        nameEn: ut.tag.nameEn,
        source: ut.source,
        confidence: ut.confidence,
      })),
      personalInfo: {
        gender: u.gender,
        ageRange: u.ageRange,
        city: u.city,
        education: u.education,
      },
    };
  });

  // Shape Groups
  const groupRows = groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    location: g.location,
    organization: g.organization,
    monthlyQuota: g.monthlyQuota,
    members: g.memberships
      .map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        accountType: m.user.accountType,
        isAdmin: m.isAdmin,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  }));

  const availableUsers = annotators.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    accountType: u.accountType,
  }));

  const calibrationResult = await listCalibrationBatches();
  const calibrationBatches =
    calibrationResult.status === "ok" ? calibrationResult.data : [];

  // Leaderboard + aggregate stats for the Bold UI Forest Plot. Empty
  // response (e.g. Group Admin with no members) is a legitimate state —
  // the component renders an empty-state row rather than erroring.
  const leaderboardResult = await listCalibrationLeaderboard();
  const calibrationLeaderboard: LeaderboardResponse =
    leaderboardResult.status === "ok"
      ? leaderboardResult.data
      : {
          rows: [],
          aggregate: {
            totalAnnotators: 0,
            tierDistribution: {
              TIER_1: 0,
              TIER_2: 0,
              TIER_3: 0,
              TIER_4: 0,
              unassessed: 0,
            },
            avgCIWidth: null,
            observations: { likert: 0, pairwise: 0, total: 0 },
            teamKrippendorffAlpha: null,
            iccTwoK: null,
            diagnostics: {
              rHat: null,
              divergent: 0,
              chains: "4×1000",
              waic: null,
              sparseAnnotators: 0,
            },
            sampleAdequacy: {
              ok: false,
              assessedRaters: 0,
              minItemsPerRater: 0,
              reason: "raters<5",
            },
          },
        };

  // Credentials tab data — SYSTEM only. For GROUP scope we pass [] so
  // the client doesn't even bootstrap the tab content (the tab itself
  // is hidden by scope gating below).
  let credentialRows: Array<{
    userId: string;
    name: string;
    email: string;
    accountType: string;
    groupName: string | null;
    hasVault: boolean;
    lastResetAt: string | null;
  }> = [];
  if (scope.kind === "SYSTEM") {
    const res = await listAnnotatorsForCredentials();
    if (res.status === "ok") credentialRows = res.data;
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto">
      <h1 className="text-2xl font-bold">{t(locale, "admin.annotators.title")}</h1>
      <AnnotatorsPageClient
        activeTab={activeTab}
        isAdmin={session?.role === "ADMIN"}
        scopeKind={scope.kind === "SYSTEM" ? "SYSTEM" : "GROUP"}
        assignmentRows={assignmentRows}
        pkgGroups={pkgGroups}
        peopleRows={peopleRows}
        groupRows={groupRows}
        availableUsers={availableUsers}
        packages={publishedPackages.map((p) => ({
          id: p.id,
          name: p.name,
          taskType: p.taskType,
        }))}
        selectedPackageId={selectedPkgId ?? null}
        calibrationBatches={calibrationBatches}
        calibrationLeaderboard={calibrationLeaderboard}
        credentialRows={credentialRows}
        currentUserId={session!.userId /* non-null: NONE scope redirected above */}
      />
    </div>
  );
}
