"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Crown,
  MapPin,
  Pencil,
  Trash2,
  UserMinus,
  UserPlus,
  Users as UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLocale } from "@/lib/i18n/context";
import type { GroupCardData } from "@/components/admin/group-grid-card";
import { ChangeAdminPicker, type AdminCandidate } from "@/components/admin/change-admin-picker";

export interface AvailableUserLite {
  id: string;
  name: string;
  email: string;
  accountType: string;
}

export interface GroupMetaDraft {
  location: string | null;
  organization: string | null;
  monthlyQuota: number | null;
}

export interface MemberEnrichmentLite {
  userId: string;
  completed: number;
  total: number;
  riskLevel: string;
  integrity: number | null;
  compositeScore: number | null;
  suspiciousCount: number;
}

export interface DrawerPackageAssignment {
  packageId: string;
  packageName: string;
  taskType: string;
  evaluationMode: string;
  deadline: Date | null;
  memberCount: number;
  completed: number;
  total: number;
}

interface Props {
  group: GroupCardData | null;
  availableUsers: AvailableUserLite[];
  busy: boolean;
  /** If false, hide system-only destructive actions (delete group). */
  canDeleteGroup?: boolean;
  /** If false, hide toggle-admin + change-admin buttons (SYSTEM-only
   *  responsibility — Group Admin can't elevate themselves or swap who
   *  the admin is for their own group). */
  canManageMembership?: boolean;
  /** If false, hide the "添加成员" picker section entirely. Group Admin
   *  add-flow is disabled for MVP because group-scoped availableUsers
   *  only contains current members (empty candidate pool). */
  canAddMember?: boolean;
  /** The logged-in user's id. Used to hide the self-row's "remove"
   *  button — Group Admin mustn't be able to kick themselves out of
   *  their own group. SYSTEM admin, which has canManageMembership=true,
   *  can still remove anyone including themselves via a different UI. */
  currentUserId?: string | null;
  /** Per-member progress/risk/integrity — renders inline badges on each
   *  member row when provided. Silently skipped when absent. */
  memberEnrichment?: MemberEnrichmentLite[];
  /** Packages this group's members are assigned to. Renders a dedicated
   *  "任务分配" section with per-package progress bar + deadline. */
  packageAssignments?: DrawerPackageAssignment[];
  onClose: () => void;
  onRename: (
    name: string,
    description: string | null,
    meta: GroupMetaDraft
  ) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddMember: (userId: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onToggleAdmin: (userId: string, nextIsAdmin: boolean) => Promise<void>;
  onChangeAdmin: (userId: string) => Promise<void>;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const hasCJK = /[\u3400-\u9fff]/.test(trimmed);
  if (hasCJK) return [...trimmed].slice(-2).join("");
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

export function GroupDrawer({
  group,
  availableUsers,
  busy,
  canDeleteGroup = true,
  canManageMembership = true,
  canAddMember = true,
  currentUserId = null,
  memberEnrichment,
  packageAssignments,
  onClose,
  onRename,
  onDelete,
  onAddMember,
  onRemoveMember,
  onToggleAdmin,
  onChangeAdmin,
}: Props) {
  const { locale } = useLocale();
  const [editMeta, setEditMeta] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [draftOrg, setDraftOrg] = useState("");
  const [draftQuota, setDraftQuota] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");
  const [changeAdminOpen, setChangeAdminOpen] = useState(false);

  // Reset local state whenever the drawer switches to a different group.
  useEffect(() => {
    setEditMeta(false);
    setPickerQuery("");
    setChangeAdminOpen(false);
    setDraftName(group?.name ?? "");
    setDraftDesc(group?.description ?? "");
    setDraftLocation(group?.location ?? "");
    setDraftOrg(group?.organization ?? "");
    setDraftQuota(
      group?.monthlyQuota != null ? String(group.monthlyQuota) : ""
    );
  }, [
    group?.id,
    group?.name,
    group?.description,
    group?.location,
    group?.organization,
    group?.monthlyQuota,
  ]);

  if (!group) return null;

  const admin = group.members.find((m) => m.isAdmin) ?? null;
  const memberIds = new Set(group.members.map((m) => m.userId));
  const addable = availableUsers.filter((u) => !memberIds.has(u.id));
  const q = pickerQuery.trim().toLowerCase();
  const filteredAddable = q
    ? addable.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      )
    : addable;

  const candidates: AdminCandidate[] = [
    ...group.members.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      accountType: m.accountType,
      isCurrentAdmin: m.isAdmin,
      isMember: true,
    })),
    ...availableUsers
      .filter((u) => !memberIds.has(u.id))
      .map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        accountType: u.accountType,
        isCurrentAdmin: false,
        isMember: false,
      })),
  ];

  const handleSaveMeta = async () => {
    if (!draftName.trim()) return;
    const trimmedQuota = draftQuota.trim();
    let quotaValue: number | null = null;
    if (trimmedQuota.length > 0) {
      const parsed = Number(trimmedQuota);
      if (!Number.isFinite(parsed) || parsed < 0) {
        // Silently coerce bad input to null rather than blocking — the server
        // will clamp/reject out-of-range values anyway.
        quotaValue = null;
      } else {
        quotaValue = Math.floor(parsed);
      }
    }
    await onRename(
      draftName.trim(),
      draftDesc.trim() || null,
      {
        location: draftLocation.trim() || null,
        organization: draftOrg.trim() || null,
        monthlyQuota: quotaValue,
      }
    );
    setEditMeta(false);
  };

  const handleDelete = async () => {
    const confirmText =
      locale === "zh"
        ? `确定删除组「${group.name}」？该组的所有成员关系将被解除（用户账号不会被删除）。`
        : `Delete group "${group.name}"? All memberships will be removed (user accounts preserved).`;
    if (!window.confirm(confirmText)) return;
    await onDelete();
  };

  const handleRemove = async (userId: string, name: string) => {
    const confirmText =
      locale === "zh"
        ? `将 ${name} 从本组移除？`
        : `Remove ${name} from this group?`;
    if (!window.confirm(confirmText)) return;
    await onRemoveMember(userId);
  };

  return (
    <>
      <Sheet open onOpenChange={(next) => !next && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-6xl">
          <SheetHeader className="border-b">
            {editMeta ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {locale === "zh" ? "组名" : "Name"}
                  </label>
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {locale === "zh" ? "描述" : "Description"}
                  </label>
                  <Input
                    value={draftDesc}
                    onChange={(e) => setDraftDesc(e.target.value)}
                    placeholder={locale === "zh" ? "（可选）" : "(optional)"}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "城市 / 区域" : "Location"}
                    </label>
                    <Input
                      value={draftLocation}
                      onChange={(e) => setDraftLocation(e.target.value)}
                      placeholder={
                        locale === "zh" ? "如 北京·海淀" : "e.g. San Francisco"
                      }
                      maxLength={64}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "月度配额" : "Monthly quota"}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={draftQuota}
                      onChange={(e) => setDraftQuota(e.target.value)}
                      placeholder={locale === "zh" ? "样本数 / 月" : "per month"}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {locale === "zh" ? "组织 / 公司" : "Organization"}
                  </label>
                  <Input
                    value={draftOrg}
                    onChange={(e) => setDraftOrg(e.target.value)}
                    placeholder={
                      locale === "zh"
                        ? "如 朗译科技（北京）"
                        : "e.g. Acme Labs"
                    }
                    maxLength={128}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={busy || !draftName.trim()}
                    onClick={handleSaveMeta}
                  >
                    {locale === "zh" ? "保存" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditMeta(false);
                      setDraftName(group.name);
                      setDraftDesc(group.description ?? "");
                      setDraftLocation(group.location ?? "");
                      setDraftOrg(group.organization ?? "");
                      setDraftQuota(
                        group.monthlyQuota != null
                          ? String(group.monthlyQuota)
                          : ""
                      );
                    }}
                  >
                    {locale === "zh" ? "取消" : "Cancel"}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2 pr-8">
                  <SheetTitle className="truncate text-lg">{group.name}</SheetTitle>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 p-0"
                    onClick={() => setEditMeta(true)}
                    aria-label={locale === "zh" ? "编辑组信息" : "Edit group info"}
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Button>
                </div>
                <SheetDescription>
                  {group.description ? (
                    group.description
                  ) : (
                    <span className="italic text-muted-foreground/70">
                      {locale === "zh" ? "无描述" : "No description"}
                    </span>
                  )}
                </SheetDescription>
                {/* Meta chips: only render what's set. Keeps empty groups clean. */}
                {(group.location || group.organization || group.monthlyQuota != null) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {group.location && (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
                        <MapPin className="h-3 w-3" strokeWidth={1.75} />
                        {group.location}
                      </span>
                    )}
                    {group.organization && (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {group.organization}
                      </span>
                    )}
                    {group.monthlyQuota != null && (
                      <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                        {locale === "zh" ? "配额" : "Quota"}{" "}
                        {group.monthlyQuota.toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <UsersIcon className="h-3 w-3" strokeWidth={1.75} />
                  {locale === "zh"
                    ? `${group.members.length} 位成员`
                    : `${group.members.length} member${group.members.length === 1 ? "" : "s"}`}
                </div>
              </>
            )}
          </SheetHeader>

          {/* Admin section */}
          <section className="space-y-2 px-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {locale === "zh" ? "组管理员" : "Group admin"}
              </h3>
              {canManageMembership && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => setChangeAdminOpen(true)}
                  disabled={busy}
                >
                  <Crown className="mr-1 h-3 w-3" strokeWidth={1.75} />
                  {locale === "zh" ? "更换" : "Change"}
                </Button>
              )}
            </div>
            {admin ? (
              <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15 text-sm font-medium text-amber-700 dark:text-amber-300">
                  {initials(admin.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{admin.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {admin.email}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
                {locale === "zh"
                  ? "该组尚未指定管理员"
                  : "No admin assigned to this group"}
              </div>
            )}
          </section>

          {/* Members list */}
          <section className="space-y-2 px-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {locale === "zh"
                ? `成员（${group.members.length}）`
                : `Members (${group.members.length})`}
            </h3>
            {group.members.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                {locale === "zh" ? "该组暂无成员" : "No members yet"}
              </div>
            ) : (
              <ul className="divide-y rounded-md border">
                {group.members.map((m) => {
                  const enr = memberEnrichment?.find(
                    (e) => e.userId === m.userId,
                  );
                  const pct =
                    enr && enr.total > 0
                      ? Math.round((enr.completed / enr.total) * 100)
                      : null;
                  const riskColor =
                    enr?.riskLevel === "HIGH_RISK"
                      ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                      : enr?.riskLevel === "MEDIUM_RISK"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
                  const riskLabelZh =
                    enr?.riskLevel === "HIGH_RISK"
                      ? "高"
                      : enr?.riskLevel === "MEDIUM_RISK"
                        ? "中"
                        : "低";
                  const riskLabelEn =
                    enr?.riskLevel === "HIGH_RISK"
                      ? "High"
                      : enr?.riskLevel === "MEDIUM_RISK"
                        ? "Med"
                        : "Low";
                  return (
                  <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {initials(m.name)}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{m.name}</span>
                        {m.isAdmin && (
                          <Crown
                            className="h-3 w-3 shrink-0 text-amber-500"
                            strokeWidth={1.75}
                          />
                        )}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {m.email}
                      </div>
                      {enr && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                          {/* Progress bar + pct */}
                          <div className="flex items-center gap-1.5">
                            <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full ${
                                  (pct ?? 0) >= 100
                                    ? "bg-emerald-500"
                                    : (pct ?? 0) >= 67
                                      ? "bg-emerald-500/80"
                                      : (pct ?? 0) >= 34
                                        ? "bg-primary"
                                        : "bg-muted-foreground/40"
                                }`}
                                style={{
                                  width: `${Math.min(100, Math.max(0, pct ?? 0))}%`,
                                }}
                              />
                            </div>
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {enr.completed}/{enr.total} · {pct ?? 0}%
                            </span>
                          </div>
                          {/* Risk pill */}
                          <span className={`rounded-sm border px-1 py-0.5 ${riskColor}`}>
                            {locale === "zh" ? `风险 ${riskLabelZh}` : `Risk ${riskLabelEn}`}
                          </span>
                          {/* Integrity */}
                          {enr.integrity != null && (
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {locale === "zh" ? "诚信" : "Integrity"} {enr.integrity}
                            </span>
                          )}
                          {/* Suspicious */}
                          {enr.suspiciousCount > 0 && (
                            <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400">
                              {enr.suspiciousCount} {locale === "zh" ? "可疑" : "susp."}
                            </span>
                          )}
                          {/* Composite capability */}
                          {enr.compositeScore != null && (
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {locale === "zh" ? "能力" : "Capability"}{" "}
                              {enr.compositeScore.toFixed(1)}/10
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {canManageMembership && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          disabled={busy}
                          onClick={() => onToggleAdmin(m.userId, !m.isAdmin)}
                          title={
                            m.isAdmin
                              ? locale === "zh"
                                ? "取消 Admin"
                                : "Remove admin"
                              : locale === "zh"
                                ? "设为 Admin"
                                : "Set as admin"
                          }
                        >
                          {m.isAdmin
                            ? locale === "zh" ? "取消 Admin" : "Unset"
                            : locale === "zh" ? "设为 Admin" : "Set admin"}
                        </Button>
                      )}
                      {m.userId !== currentUserId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                          disabled={busy}
                          onClick={() => handleRemove(m.userId, m.name)}
                          aria-label={
                            locale === "zh" ? "移除成员" : "Remove member"
                          }
                        >
                          <UserMinus className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </Button>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 任务分配 (packages the group's members are assigned to) */}
          {packageAssignments && packageAssignments.length > 0 && (
            <section className="space-y-2 px-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {locale === "zh"
                  ? `任务分配（${packageAssignments.length}）`
                  : `Package Assignments (${packageAssignments.length})`}
              </h3>
              <ul className="divide-y rounded-md border">
                {packageAssignments.map((pa) => {
                  const pct =
                    pa.total > 0 ? Math.round((pa.completed / pa.total) * 100) : 0;
                  const now = Date.now();
                  const overdue =
                    pa.deadline != null &&
                    pa.deadline.getTime() < now &&
                    pa.completed < pa.total;
                  const dlStr = pa.deadline
                    ? pa.deadline.toISOString().slice(0, 10)
                    : locale === "zh"
                      ? "无截止"
                      : "No deadline";
                  return (
                    <li key={pa.packageId} className="space-y-1.5 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">
                              {pa.packageName}
                            </span>
                            <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                              {pa.taskType}
                            </span>
                            {pa.evaluationMode === "ARENA" && (
                              <span className="shrink-0 rounded-sm border border-fuchsia-500/40 bg-fuchsia-500/10 px-1 py-0.5 text-[9px] uppercase text-fuchsia-600 dark:text-fuchsia-400">
                                Arena
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className={overdue ? "text-red-600 dark:text-red-400" : ""}>
                              {overdue
                                ? locale === "zh"
                                  ? `已逾期 · ${dlStr}`
                                  : `Overdue · ${dlStr}`
                                : dlStr}
                            </span>
                            <span className="font-mono tabular-nums">
                              {pa.memberCount} {locale === "zh" ? "人" : "members"}
                            </span>
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {pa.completed}/{pa.total} · {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${
                            pct >= 100
                              ? "bg-emerald-500"
                              : pct >= 67
                                ? "bg-emerald-500/80"
                                : pct >= 34
                                  ? "bg-primary"
                                  : "bg-muted-foreground/40"
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Add member picker — SYSTEM only. Hidden for Group Admin
              because (a) search pool is empty for them by scope, and
              (b) product decision: Group Admin can't expand their own
              group's headcount. */}
          {canAddMember && (
          <section className="space-y-2 px-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <UserPlus className="h-3 w-3" strokeWidth={1.75} />
              {locale === "zh" ? "添加成员" : "Add members"}
            </h3>
            <Input
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder={
                locale === "zh" ? "搜索姓名或邮箱…" : "Search name or email…"
              }
              className="text-sm"
            />
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {filteredAddable.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {q
                    ? locale === "zh" ? "无匹配用户" : "No matches"
                    : locale === "zh"
                      ? "暂无可添加的用户"
                      : "No users available"}
                </div>
              ) : (
                <ul className="divide-y">
                  {filteredAddable.slice(0, 50).map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{u.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {u.email}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        disabled={busy}
                        onClick={() => onAddMember(u.id)}
                      >
                        {locale === "zh" ? "加入" : "Add"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          )}

          {/* Danger zone */}
          <section className="mt-auto border-t p-4">
            {canDeleteGroup && (
              <Button
                size="sm"
                variant="destructive"
                className="w-full"
                disabled={busy}
                onClick={handleDelete}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.75} />
                {locale === "zh" ? "删除组" : "Delete group"}
              </Button>
            )}
          </section>
        </SheetContent>
      </Sheet>

      <ChangeAdminPicker
        open={changeAdminOpen}
        onOpenChange={setChangeAdminOpen}
        groupName={group.name}
        candidates={candidates}
        currentAdminId={admin?.userId ?? null}
        busy={busy}
        onConfirm={async (userId) => {
          await onChangeAdmin(userId);
          setChangeAdminOpen(false);
        }}
      />
    </>
  );
}
