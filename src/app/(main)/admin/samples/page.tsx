import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getLocale, t } from "@/lib/i18n/server";
import { PackageListClient } from "@/components/admin/package-list-client";
import { TopAdjustMembersButton } from "@/components/admin/top-adjust-members-button";
import { getAdminScope, getScopedUserIds } from "@/lib/admin-scope";
import type { AccountType } from "@prisma/client";

// Package-level risk roll-up. HIGH beats MEDIUM beats LOW. "NONE" means no
// members assigned yet (we show a neutral pill). Reducing over members means
// a single high-risk member flags the whole package — safer default.
function aggregatePackageRisk(
  levels: string[],
): "HIGH_RISK" | "MEDIUM_RISK" | "LOW_RISK" | "NONE" {
  if (levels.length === 0) return "NONE";
  if (levels.includes("HIGH_RISK")) return "HIGH_RISK";
  if (levels.includes("MEDIUM_RISK")) return "MEDIUM_RISK";
  return "LOW_RISK";
}

export default async function TaskManagementPage() {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") redirect("/tasks");
  const locale = await getLocale();

  // Group-admin scope: only show packages containing at least one of their
  // group's members. We resolve the member universe once and filter below.
  const scopedUserIds = await getScopedUserIds(scope);
  const scopedIdSet: Set<string> | null =
    scopedUserIds === "ALL" ? null : scopedUserIds;

  const packages = await prisma.evaluationPackage.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      // Dataset-first: models/assets live on pkg.datasets[] M2M. Legacy
      // packages have assets directly on pkg.videoAssets[] instead. We
      // union both so model names render for Dataset-reused packages.
      videoAssets: {
        select: { id: true, model: { select: { name: true } } },
      },
      datasets: {
        select: {
          model: { select: { name: true } },
          videoAssets: { select: { id: true } },
        },
      },
      // EvaluationItem.packageId is the authoritative link for scoring
      // items — no more walking through videoAssets.
      evaluationItems: {
        where: { packageId: { not: null } },
        select: {
          status: true,
          assignedTo: {
            select: {
              id: true,
              name: true,
              email: true,
              accountType: true,
              riskLevel: true,
            },
          },
        },
      },
      arenaItems: {
        select: {
          status: true,
          assignedTo: {
            select: {
              id: true,
              name: true,
              email: true,
              accountType: true,
              riskLevel: true,
            },
          },
          videoAssetA: { select: { model: { select: { name: true } } } },
          videoAssetB: { select: { model: { select: { name: true } } } },
        },
      },
    },
  });

  // For Group Admin scope: a package is visible only if it contains at
  // least one of their group's members. Items belonging to out-of-scope
  // users get filtered out of every downstream aggregation below.
  const visiblePackages = scopedIdSet
    ? packages.filter((pkg) => {
        const hasScopedMember =
          pkg.evaluationItems.some((i) => scopedIdSet!.has(i.assignedTo.id)) ||
          pkg.arenaItems.some((i) => scopedIdSet!.has(i.assignedTo.id));
        return hasScopedMember;
      })
    : packages;

  const serialized = visiblePackages.map((pkg) => {
    const isArena = pkg.evaluationMode === "ARENA";
    // Scope-filter items so aggregates (completion, risk, progress) reflect
    // only the subset of evaluators this admin is entitled to see.
    const scopedEvalItems = scopedIdSet
      ? pkg.evaluationItems.filter((i) => scopedIdSet.has(i.assignedTo.id))
      : pkg.evaluationItems;
    const scopedArenaItems = scopedIdSet
      ? pkg.arenaItems.filter((i) => scopedIdSet.has(i.assignedTo.id))
      : pkg.arenaItems;

    const completed = isArena
      ? scopedArenaItems.filter((i) => i.status === "COMPLETED").length
      : scopedEvalItems.filter((i) => i.status === "COMPLETED").length;
    const totalItems = isArena ? scopedArenaItems.length : scopedEvalItems.length;

    // Model names: derived from the FULL package's assets, not the scoped
    // subset — Group Admins still need to know what models the package is
    // testing, even if they can only see their own team's annotations.
    const modelNames = isArena
      ? [
          ...new Set(
            pkg.arenaItems.flatMap((ai) => [
              ai.videoAssetA.model.name,
              ai.videoAssetB.model.name,
            ]),
          ),
        ]
      : [
          ...new Set([
            ...pkg.videoAssets.map((va) => va.model.name),
            ...pkg.datasets.map((ds) => ds.model.name),
          ]),
        ];

    // Per-annotator progress + account-type mix (source depends on mode)
    const annotatorMap = new Map<
      string,
      {
        id: string;
        name: string;
        email: string;
        accountType: AccountType;
        riskLevel: string;
        completed: number;
        total: number;
      }
    >();
    const addItem = (
      assignedTo: {
        id: string;
        name: string;
        email: string;
        accountType: AccountType;
        riskLevel: string;
      },
      status: string,
    ) => {
      const existing = annotatorMap.get(assignedTo.id);
      if (existing) {
        existing.total++;
        if (status === "COMPLETED") existing.completed++;
      } else {
        annotatorMap.set(assignedTo.id, {
          id: assignedTo.id,
          name: assignedTo.name,
          email: assignedTo.email,
          accountType: assignedTo.accountType,
          riskLevel: assignedTo.riskLevel,
          total: 1,
          completed: status === "COMPLETED" ? 1 : 0,
        });
      }
    };
    if (isArena) {
      for (const ai of scopedArenaItems) addItem(ai.assignedTo, ai.status);
    } else {
      for (const item of scopedEvalItems) addItem(item.assignedTo, item.status);
    }

    const annotators = [...annotatorMap.values()];
    const accountTypes = new Set(annotators.map((a) => a.accountType));
    const annotatorTypeMix: "INTERNAL" | "VENDOR" | "MIXED" | "NONE" =
      accountTypes.size === 0
        ? "NONE"
        : accountTypes.size > 1
          ? "MIXED"
          : accountTypes.has("INTERNAL")
            ? "INTERNAL"
            : "VENDOR";

    const maxRiskLevel = aggregatePackageRisk(
      annotators.map((a) => a.riskLevel),
    );

    const deadlineStatus: "ok" | "near" | "overdue" | null = pkg.deadline
      ? new Date(pkg.deadline) < new Date()
        ? "overdue"
        : new Date(pkg.deadline).getTime() - Date.now() < 24 * 3600_000
          ? "near"
          : "ok"
      : null;

    return {
      id: pkg.id,
      name: pkg.name,
      taskType: pkg.taskType,
      evaluationMode: pkg.evaluationMode,
      videoCount: pkg.videoCount,
      annotatorCount: pkg.annotatorCount,
      completedItems: completed,
      totalItems,
      status: pkg.status,
      publishedAt: pkg.publishedAt?.toISOString() ?? null,
      startAt: pkg.startAt?.toISOString() ?? null,
      deadline: pkg.deadline?.toISOString() ?? null,
      deadlineStatus,
      modelCheckpoint: pkg.modelCheckpoint,
      description: pkg.description,
      modelNames,
      annotatorTypeMix,
      maxRiskLevel,
      annotatorProgress: annotators.map((a) => ({
        name: a.name,
        accountType: a.accountType,
        completed: a.completed,
        total: a.total,
      })),
      // Flat list of current members — used by the page-level adjust dialog
      // so it doesn't have to re-fetch per package.
      currentMembers: annotators.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        accountType: a.accountType,
        completed: a.completed,
        total: a.total,
      })),
      createdAt: pkg.createdAt.toISOString(),
    };
  });

  // Candidate user pool for the page-level adjust dialog. Kept here to
  // avoid an extra server-action round trip when the dialog opens.
  // Group Admins only see/can add their own group members.
  const availableUsersRaw = await prisma.user.findMany({
    where: {
      role: { in: ["ANNOTATOR", "VENDOR_ANNOTATOR"] },
      deletedAt: null,
      ...(scopedIdSet ? { id: { in: [...scopedIdSet] } } : {}),
    },
    select: { id: true, name: true, email: true, accountType: true },
    orderBy: { name: "asc" },
  });
  const availableUsers = availableUsersRaw.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    accountType: u.accountType as string,
  }));

  // Hero strip stats — mirrors the legacy Assignment page's 3 cells so
  // task mgmt is now fully self-sufficient. Derived from the same scoped
  // `serialized` data so numbers match what's rendered in the grid below.
  const now = Date.now();
  let totalAssignments = 0;
  let totalCompleted = 0;
  let overduePackages = 0;
  for (const p of serialized) {
    totalAssignments += p.totalItems;
    totalCompleted += p.completedItems;
    const hasPending = p.completedItems < p.totalItems;
    if (
      hasPending &&
      p.deadline &&
      new Date(p.deadline).getTime() < now
    ) {
      overduePackages += 1;
    }
  }
  const avgCompletion =
    totalAssignments > 0
      ? Math.round((totalCompleted / totalAssignments) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t(locale, "admin.samples.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(locale, "admin.samples.total", { count: String(serialized.length) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TopAdjustMembersButton
            packages={serialized.map((p) => ({
              id: p.id,
              name: p.name,
              taskType: p.taskType,
              currentMembers: p.currentMembers,
            }))}
            availableUsers={availableUsers}
          />
          {scope.kind === "SYSTEM" && (
            <a
              href="/admin/samples/create"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              + {t(locale, "admin.create.newPackage")}
            </a>
          )}
        </div>
      </div>

      {/* Hero strip — compact single-row bar to leave more vertical
          space for the task detail panel below. Each cell shows the
          headline number with a subtle inline subtitle. */}
      <div className="flex shrink-0 flex-wrap items-stretch gap-2 rounded-lg border bg-card/60 px-3 py-2 text-[11px]">
        <HeroStat
          label={locale === "zh" ? "总分配数" : "Total assignments"}
          value={totalAssignments.toLocaleString()}
          sub={
            locale === "zh"
              ? `跨 ${serialized.length} 个任务`
              : `${serialized.length} pkgs`
          }
          tone="primary"
        />
        <span className="self-center text-border">•</span>
        <HeroStat
          label={locale === "zh" ? "平均完成率" : "Avg completion"}
          value={`${avgCompletion}%`}
          sub={`${totalCompleted.toLocaleString()} / ${totalAssignments.toLocaleString()}`}
          tone="emerald"
        />
        <span className="self-center text-border">•</span>
        <HeroStat
          label={locale === "zh" ? "逾期任务" : "Overdue"}
          value={overduePackages.toLocaleString()}
          sub={
            overduePackages > 0
              ? locale === "zh"
                ? "已过 deadline"
                : "past deadline"
              : "—"
          }
          tone={overduePackages > 0 ? "red" : "muted"}
        />
      </div>
      <div className="min-h-0 flex-1">
        <PackageListClient packages={serialized} />
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "primary" | "emerald" | "red" | "muted";
}) {
  const valueClass = {
    primary: "text-primary",
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    muted: "text-foreground",
  }[tone];
  return (
    <div className="flex items-baseline gap-2 px-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono text-base font-semibold tabular-nums ${valueClass}`}>
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground">{sub}</span>
    </div>
  );
}
