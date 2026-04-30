"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Users as UsersIcon, UserCheck, Package, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";
import {
  GroupPermissionBanner,
  type GroupViewerScope,
} from "@/components/admin/group-permission-banner";
import {
  GroupGridCard,
  type GroupCardData,
  type MemberEnrichment,
} from "@/components/admin/group-grid-card";
import {
  GroupDrawer,
  type AvailableUserLite,
  type GroupMetaDraft,
} from "@/components/admin/group-drawer";
import {
  GroupCreateWizard,
  type WizardCandidate,
} from "@/components/admin/group-create-wizard";
import {
  createGroupWithMembers,
  renameGroup,
  deleteGroup,
  addMember,
  removeMember,
  setGroupAdmin,
  changeGroupAdmin,
} from "@/app/(main)/admin/annotators/group-action";

interface Member {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  isAdmin: boolean;
}

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  organization: string | null;
  monthlyQuota: number | null;
  members: Member[];
}

interface PeopleEnrichmentRow {
  userId: string;
  integrity: number | null;
  riskLevel: string;
  completed: number;
  compositeScore?: number | null;
  avgScore?: number | null;
  suspiciousCount?: number;
  total?: number;
  /** 14-day daily submission histogram. Summed across visible members to
   *  drive the "近 14 天完成" hero cell when no explicit monthlyQuota is
   *  set (which is the common case — admin rarely fills it manually). */
  trend?: number[];
}

// Package-per-group slice: which published packages this group's members
// are assigned to, with aggregate progress. Feeds the "任务分配" section.
export interface GroupPackageAssignment {
  packageId: string;
  packageName: string;
  taskType: string;
  evaluationMode: string;
  deadline: Date | null;
  // Aggregated across THIS group's members only (SYSTEM admins still see
  // this scoped to the cardboxed group, which matches the card's reality).
  memberCount: number;
  completed: number;
  total: number;
}

interface Props {
  groups: GroupRow[];
  availableUsers: AvailableUserLite[];
  peopleRows: PeopleEnrichmentRow[];
  scope?: GroupViewerScope;
  groupAdminOfCount?: number;
  /** Optional — feeds the drawer's 任务分配 & 校准快照 sections. Keyed
   *  groupId → packages. Absent for surfaces that don't pre-compute it. */
  packagesByGroup?: Record<string, GroupPackageAssignment[]>;
  /** Auto-open the drawer for a specific group on mount. Used by Group
   *  Admin landing on /admin/annotators?tab=groups when they own exactly
   *  one group — no click required. */
  autoOpenGroupId?: string | null;
  /** Logged-in user's id — plumbed through to the drawer so the
   *  current user's own row doesn't show a "remove" button. */
  currentUserId?: string | null;
}

type Message = { text: string; type: "ok" | "error" };

function normalizeRisk(raw: string): "LOW" | "MEDIUM" | "HIGH" {
  if (raw === "HIGH" || raw === "MEDIUM") return raw;
  return "LOW";
}

export function GroupManagement({
  groups,
  availableUsers,
  peopleRows,
  scope = "SYSTEM_ADMIN",
  groupAdminOfCount,
  packagesByGroup,
  autoOpenGroupId,
  currentUserId = null,
}: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    autoOpenGroupId ?? null,
  );
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  // Enrichment map: userId → { integrity, riskLevel, completed }. Built once
  // from peopleRows and reused across every card. Annotators that exist in a
  // group but don't appear in peopleRows (edge case — user with zero tasks)
  // simply won't have enrichment; the card degrades gracefully to "—".
  const enrichment = useMemo<Map<string, MemberEnrichment>>(() => {
    const m = new Map<string, MemberEnrichment>();
    for (const p of peopleRows) {
      m.set(p.userId, {
        integrity: p.integrity,
        riskLevel: normalizeRisk(p.riskLevel),
        completed: p.completed,
      });
    }
    return m;
  }, [peopleRows]);

  const selectedGroup = selectedGroupId
    ? (groups.find((g) => g.id === selectedGroupId) ?? null)
    : null;

  // Hero metrics — mirror the design mockup: four cells, each with a
  // descriptive subtitle. "internal vs vendor" is derived per-group via
  // majority rule so the count matches the chip rendered on each card.
  const totalGroups = groups.length;
  const totalMembers = groups.reduce((acc, g) => acc + g.members.length, 0);
  const coveredGroupCount = groups.filter((g) => g.members.length > 0).length;
  const groupsWithAdminCount = groups.filter((g) =>
    g.members.some((m) => m.isAdmin)
  ).length;
  const totalMonthlyQuota = groups.reduce(
    (acc, g) => acc + (g.monthlyQuota ?? 0),
    0
  );
  // Fallback metric: when no group has an explicit monthlyQuota, surface
  // the actual recent throughput (sum of 14-day trend across all members
  // of visible groups). Shows admins "is this group active?" without
  // requiring them to manually fill in quotas.
  const memberIdToTrend = new Map<string, number>();
  for (const p of peopleRows) {
    const t = p.trend;
    if (!t || t.length === 0) continue;
    memberIdToTrend.set(
      p.userId,
      t.reduce((a, b) => a + b, 0),
    );
  }
  const totalRecentCompleted = groups.reduce((acc, g) => {
    for (const m of g.members) acc += memberIdToTrend.get(m.userId) ?? 0;
    return acc;
  }, 0);

  let internalGroupCount = 0;
  let vendorGroupCount = 0;
  for (const g of groups) {
    if (g.members.length === 0) {
      internalGroupCount++; // empty groups default to INTERNAL in card logic
      continue;
    }
    let internal = 0;
    let vendor = 0;
    for (const m of g.members) {
      if (m.accountType === "INTERNAL") internal++;
      else vendor++;
    }
    if (internal > vendor) internalGroupCount++;
    else vendorGroupCount++;
  }

  const wizardCandidates: WizardCandidate[] = useMemo(() => {
    return availableUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      accountType: u.accountType,
    }));
  }, [availableUsers]);

  // Bridge the drawer's card shape to the underlying group row. Converting
  // here (rather than in the drawer) keeps the drawer a pure presentation
  // component.
  const selectedCard: GroupCardData | null = selectedGroup
    ? {
        id: selectedGroup.id,
        name: selectedGroup.name,
        description: selectedGroup.description,
        location: selectedGroup.location,
        organization: selectedGroup.organization,
        monthlyQuota: selectedGroup.monthlyQuota,
        members: selectedGroup.members,
      }
    : null;

  const handleWizardSubmit = async (args: {
    name: string;
    description: string | null;
    adminId: string;
    memberIds: string[];
  }) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await createGroupWithMembers(
        args.name,
        args.description,
        args.adminId,
        args.memberIds
      );
      if (res.status === "ok") {
        setWizardOpen(false);
        setMessage({
          text: t("admin.annotators.groups.createSuccess"),
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (
    name: string,
    description: string | null,
    meta: GroupMetaDraft
  ) => {
    if (!selectedGroup) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await renameGroup(selectedGroup.id, name, description, {
        location: meta.location,
        organization: meta.organization,
        monthlyQuota: meta.monthlyQuota,
      });
      if (res.status === "ok") {
        setMessage({
          text: t("admin.annotators.groups.renameSuccess"),
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedGroup) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await deleteGroup(selectedGroup.id);
      if (res.status === "ok") {
        setSelectedGroupId(null);
        setMessage({
          text: t("admin.annotators.groups.deleteSuccess"),
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAddMember = async (userId: string) => {
    if (!selectedGroup) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await addMember(selectedGroup.id, userId, false);
      if (res.status === "ok") {
        setMessage({
          text: t("admin.annotators.groups.addMemberSuccess"),
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedGroup) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await removeMember(selectedGroup.id, userId);
      if (res.status === "ok") {
        setMessage({
          text: t("admin.annotators.groups.removeMemberSuccess"),
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAdmin = async (userId: string, nextIsAdmin: boolean) => {
    if (!selectedGroup) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await setGroupAdmin(selectedGroup.id, userId, nextIsAdmin);
      if (res.status === "ok") {
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleChangeAdmin = async (userId: string) => {
    if (!selectedGroup) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await changeGroupAdmin(selectedGroup.id, userId);
      if (res.status === "ok") {
        setMessage({
          text:
            locale === "zh"
              ? "组管理员已更换"
              : "Group admin changed",
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const canMutate = scope === "SYSTEM_ADMIN";

  return (
    <div className="space-y-5">
      <GroupPermissionBanner
        scope={scope}
        visibleGroupCount={totalGroups}
        groupAdminOfCount={groupAdminOfCount}
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t("admin.annotators.tab.groups")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {locale === "zh"
              ? "按组织单元管理评测员，可视化诚信分、风险与负载分布"
              : "Organize annotators into groups with integrity, risk, and workload at a glance"}
          </p>
        </div>
        {canMutate && (
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
            {t("admin.annotators.groups.create")}
          </Button>
        )}
      </div>

      {/* Hero 4 cells — design-aligned with per-cell subtitles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HeroCell
          Icon={UsersIcon}
          label={locale === "zh" ? "GROUP 总数" : "Total groups"}
          value={String(totalGroups)}
          subtitle={
            locale === "zh"
              ? `内部 ${internalGroupCount} · 外包 ${vendorGroupCount}`
              : `Internal ${internalGroupCount} · Vendor ${vendorGroupCount}`
          }
          tone="primary"
        />
        <HeroCell
          Icon={UserCheck}
          label={locale === "zh" ? "评测员总数" : "Total annotators"}
          value={String(totalMembers)}
          subtitle={
            locale === "zh"
              ? `覆盖 ${coveredGroupCount} 个 Group`
              : `Across ${coveredGroupCount} groups`
          }
          tone="emerald"
        />
        {totalMonthlyQuota > 0 ? (
          <HeroCell
            Icon={Package}
            label={locale === "zh" ? "月度配额总额" : "Monthly quota total"}
            value={totalMonthlyQuota.toLocaleString()}
            subtitle={locale === "zh" ? "样本 / 月（admin 手动设置）" : "samples / month"}
            tone="amber"
          />
        ) : (
          <HeroCell
            Icon={Package}
            label={locale === "zh" ? "近 14 天完成" : "Recent 14 d"}
            value={totalRecentCompleted.toLocaleString()}
            subtitle={
              locale === "zh" ? "全组成员已完成任务项" : "items completed across all members"
            }
            tone="amber"
          />
        )}
        <HeroCell
          Icon={Crown}
          label={locale === "zh" ? "GROUP 管理员" : "Group admins"}
          value={String(groupsWithAdminCount)}
          subtitle={
            locale === "zh"
              ? "每个 Group 一位负责人"
              : "One per group"
          }
          tone="muted"
        />
      </div>

      {/* Message toast */}
      {message && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            message.type === "ok"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Grid */}
      {groups.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
          {t("admin.annotators.groups.empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <GroupGridCard
              key={g.id}
              group={{
                id: g.id,
                name: g.name,
                description: g.description,
                location: g.location,
                organization: g.organization,
                monthlyQuota: g.monthlyQuota,
                members: g.members,
              }}
              enrichment={enrichment}
              onClick={() => setSelectedGroupId(g.id)}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      <GroupDrawer
        group={selectedCard}
        availableUsers={availableUsers}
        busy={busy}
        canDeleteGroup={canMutate}
        canManageMembership={canMutate}
        canAddMember={canMutate}
        currentUserId={currentUserId}
        memberEnrichment={
          selectedCard
            ? selectedCard.members.map((m) => {
                const p = peopleRows.find((r) => r.userId === m.userId);
                return {
                  userId: m.userId,
                  completed: p?.completed ?? 0,
                  total: p?.total ?? 0,
                  riskLevel: p?.riskLevel ?? "LOW_RISK",
                  integrity: p?.integrity ?? null,
                  compositeScore: p?.compositeScore ?? null,
                  suspiciousCount: p?.suspiciousCount ?? 0,
                };
              })
            : undefined
        }
        packageAssignments={
          selectedCard && packagesByGroup
            ? packagesByGroup[selectedCard.id] ?? []
            : undefined
        }
        onClose={() => setSelectedGroupId(null)}
        onRename={handleRename}
        onDelete={handleDelete}
        onAddMember={handleAddMember}
        onRemoveMember={handleRemoveMember}
        onToggleAdmin={handleToggleAdmin}
        onChangeAdmin={handleChangeAdmin}
      />

      {/* Create wizard */}
      <GroupCreateWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        candidates={wizardCandidates}
        busy={busy}
        onSubmit={handleWizardSubmit}
      />
    </div>
  );
}

function HeroCell({
  Icon,
  label,
  value,
  subtitle,
  tone,
}: {
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  subtitle?: string;
  tone: "primary" | "emerald" | "amber" | "muted";
}) {
  const palette =
    tone === "primary"
      ? "bg-primary/5 text-primary border-primary/20"
      : tone === "emerald"
        ? "bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
        : tone === "amber"
          ? "bg-amber-500/5 text-amber-700 dark:text-amber-400 border-amber-500/20"
          : "bg-muted/30 text-foreground border-border";
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${palette}`}
    >
      <Icon
        className="mt-0.5 h-5 w-5 shrink-0 opacity-80"
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide opacity-70">
          {label}
        </div>
        <div className="mt-0.5 text-2xl font-semibold leading-none tabular-nums">
          {value}
        </div>
        {subtitle && (
          <div className="mt-1 truncate text-[11px] opacity-70">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
