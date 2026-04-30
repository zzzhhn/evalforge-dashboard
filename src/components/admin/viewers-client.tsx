"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/context";
import {
  createViewerAccount,
  assignPackageToViewer,
  unassignPackageFromViewer,
  assignPackagesToViewerBatch,
  unassignPackagesFromViewerBatch,
  bulkAssignViewersToPackages,
  resetViewerPassword,
  deleteViewerAccount,
} from "@/app/(main)/admin/viewers/actions";

interface ViewerAssignment {
  packageId: string;
  packageName: string;
  taskType: "T2V" | "I2V";
  evaluationMode: "SCORING" | "ARENA";
  videoCount: number;
  assignedAt: string;
}

interface Viewer {
  id: string;
  name: string;
  email: string;
  accountType: "INTERNAL" | "VENDOR";
  createdAt: string;
  assignments: ViewerAssignment[];
}

interface PackageSummary {
  id: string;
  name: string;
  taskType: "T2V" | "I2V";
  evaluationMode: "SCORING" | "ARENA";
  videoCount: number;
  status: string;
}

interface Props {
  viewers: Viewer[];
  packages: PackageSummary[];
}

type CredentialToast =
  | { kind: "created"; email: string; password: string }
  | { kind: "reset"; email: string; password: string }
  | null;

export function ViewersClient({ viewers, packages }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const [_, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Viewer | null>(null);
  const [credentialToast, setCredentialToast] = useState<CredentialToast>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);

  // Per-viewer dialog: selected packages for batch add/remove. Stored as Sets
  // so toggles are O(1) and "select all" is a single replacement.
  const [selectedAdd, setSelectedAdd] = useState<Set<string>>(new Set());
  const [selectedRemove, setSelectedRemove] = useState<Set<string>>(new Set());

  // Bulk dialog (N viewers × M packages).
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkViewers, setBulkViewers] = useState<Set<string>>(new Set());
  const [bulkPackages, setBulkPackages] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<
    { added: number; skipped: number } | null
  >(null);

  const refresh = () => startTransition(() => router.refresh());

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    const res = await createViewerAccount(newEmail, newName);
    setBusy(false);
    if (res.status === "error") {
      setError(res.message);
      return;
    }
    if (res.data) {
      setCredentialToast({ kind: "created", email: res.data.email, password: res.data.password });
    }
    setNewName("");
    setNewEmail("");
    setCreateOpen(false);
    refresh();
  };

  const handleReset = async (viewer: Viewer) => {
    if (!confirm(locale === "zh" ? `确认重置 ${viewer.name} 的密码？旧密码立即失效。` : `Reset password for ${viewer.name}? Old password becomes invalid.`)) {
      return;
    }
    const res = await resetViewerPassword(viewer.id);
    if (res.status === "error") {
      setError(res.message);
      return;
    }
    if (res.data) {
      setCredentialToast({ kind: "reset", email: res.data.email, password: res.data.password });
    }
  };

  const handleDelete = async (viewer: Viewer) => {
    if (!confirm(locale === "zh" ? `确认删除 ${viewer.name}？该账号将无法登录。` : `Delete ${viewer.name}? Account will be disabled.`)) {
      return;
    }
    const res = await deleteViewerAccount(viewer.id);
    if (res.status === "error") {
      setError(res.message);
      return;
    }
    refresh();
  };

  const handleAssign = async (packageId: string) => {
    if (!assignTarget) return;
    const res = await assignPackageToViewer(assignTarget.id, packageId);
    if (res.status === "error") {
      setError(res.message);
      return;
    }
    refresh();
    const pkg = packages.find((p) => p.id === packageId);
    if (pkg) {
      setAssignTarget({
        ...assignTarget,
        assignments: [
          ...assignTarget.assignments,
          {
            packageId: pkg.id,
            packageName: pkg.name,
            taskType: pkg.taskType,
            evaluationMode: pkg.evaluationMode,
            videoCount: pkg.videoCount,
            assignedAt: new Date().toISOString(),
          },
        ],
      });
    }
  };

  const handleUnassign = async (packageId: string) => {
    if (!assignTarget) return;
    const res = await unassignPackageFromViewer(assignTarget.id, packageId);
    if (res.status === "error") {
      setError(res.message);
      return;
    }
    refresh();
    setAssignTarget({
      ...assignTarget,
      assignments: assignTarget.assignments.filter((a) => a.packageId !== packageId),
    });
  };

  const openAssign = (v: Viewer) => {
    setError(null);
    setSelectedAdd(new Set());
    setSelectedRemove(new Set());
    setAssignTarget(v);
  };

  const handleBatchAdd = async () => {
    if (!assignTarget || selectedAdd.size === 0) return;
    const ids = [...selectedAdd];
    const res = await assignPackagesToViewerBatch(assignTarget.id, ids);
    if (res.status === "error") {
      setError(res.message);
      return;
    }
    refresh();
    const newAssignments = ids
      .map((pid) => packages.find((p) => p.id === pid))
      .filter((p): p is PackageSummary => !!p)
      .map((p) => ({
        packageId: p.id,
        packageName: p.name,
        taskType: p.taskType,
        evaluationMode: p.evaluationMode,
        videoCount: p.videoCount,
        assignedAt: new Date().toISOString(),
      }));
    setAssignTarget({
      ...assignTarget,
      assignments: [
        ...assignTarget.assignments,
        ...newAssignments.filter(
          (na) => !assignTarget.assignments.some((a) => a.packageId === na.packageId),
        ),
      ],
    });
    setSelectedAdd(new Set());
  };

  const handleBatchRemove = async () => {
    if (!assignTarget || selectedRemove.size === 0) return;
    const ids = [...selectedRemove];
    const res = await unassignPackagesFromViewerBatch(assignTarget.id, ids);
    if (res.status === "error") {
      setError(res.message);
      return;
    }
    refresh();
    setAssignTarget({
      ...assignTarget,
      assignments: assignTarget.assignments.filter(
        (a) => !ids.includes(a.packageId),
      ),
    });
    setSelectedRemove(new Set());
  };

  const openBulk = () => {
    setError(null);
    setBulkViewers(new Set());
    setBulkPackages(new Set());
    setBulkResult(null);
    setBulkOpen(true);
  };

  const handleBulkAssign = async () => {
    if (bulkViewers.size === 0 || bulkPackages.size === 0) return;
    setBulkBusy(true);
    setError(null);
    setBulkResult(null);
    try {
      const res = await bulkAssignViewersToPackages(
        [...bulkViewers],
        [...bulkPackages],
      );
      if (res.status === "error") {
        setError(res.message);
      } else if (res.data) {
        setBulkResult(res.data);
        refresh();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  // Helpers to toggle a value in a Set without mutating it (immutability rule).
  const toggleSet = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const zh = locale === "zh";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {zh ? `共 ${viewers.length} 位 viewer` : `${viewers.length} viewer${viewers.length === 1 ? "" : "s"}`}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={openBulk}
            disabled={viewers.length === 0 || packages.length === 0}
          >
            {zh ? "批量分配" : "Bulk Assign"}
          </Button>
          <Button onClick={() => { setError(null); setCreateOpen(true); }}>
            {zh ? "+ 新建 viewer" : "+ New Viewer"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {viewers.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          {zh ? "暂无 viewer 账号。" : "No viewer accounts yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{zh ? "姓名" : "Name"}</th>
                <th className="px-4 py-2 text-left font-medium">{zh ? "邮箱" : "Email"}</th>
                <th className="px-4 py-2 text-left font-medium">{zh ? "已分配任务" : "Assigned"}</th>
                <th className="px-4 py-2 text-left font-medium">{zh ? "创建时间" : "Created"}</th>
                <th className="px-4 py-2 text-right font-medium">{zh ? "操作" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {viewers.map((v) => (
                <tr key={v.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{v.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{v.email}</td>
                  <td className="px-4 py-3">
                    {v.assignments.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {zh ? "无" : "None"}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {v.assignments.slice(0, 3).map((a) => (
                          <Badge key={a.packageId} variant="secondary" className="text-xs">
                            {a.packageName}
                          </Badge>
                        ))}
                        {v.assignments.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{v.assignments.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(v.createdAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openAssign(v)}
                      >
                        {zh ? "管理分配" : "Assignments"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleReset(v)}>
                        {zh ? "重置密码" : "Reset"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700 dark:text-red-400"
                        onClick={() => handleDelete(v)}
                      >
                        {zh ? "删除" : "Delete"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create viewer dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!busy) setCreateOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{zh ? "新建 viewer" : "New Viewer"}</DialogTitle>
            <DialogDescription>
              {zh
                ? "系统将自动生成随机密码，仅在创建后一次性显示。"
                : "A random password will be generated and shown once."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{zh ? "姓名" : "Name"}</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={zh ? "张老板" : "e.g. Jane Chen"}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{zh ? "邮箱" : "Email"}</label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="viewer@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
              {zh ? "取消" : "Cancel"}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={busy || !newName.trim() || !newEmail.trim()}
            >
              {busy ? (zh ? "创建中…" : "Creating…") : (zh ? "创建" : "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assignment management dialog */}
      <Dialog open={!!assignTarget} onOpenChange={(v) => { if (!v) setAssignTarget(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {zh ? `管理分配 — ${assignTarget?.name}` : `Assignments — ${assignTarget?.name}`}
            </DialogTitle>
            <DialogDescription>
              {zh
                ? "Viewer 仅能查看已分配的任务中的视频，不能评分。"
                : "Viewers can browse videos in assigned packages; no scoring permissions."}
            </DialogDescription>
          </DialogHeader>
          {assignTarget && (() => {
            const available = packages.filter(
              (p) => !assignTarget.assignments.some((a) => a.packageId === p.id),
            );
            const allAssignedSelected =
              assignTarget.assignments.length > 0 &&
              assignTarget.assignments.every((a) => selectedRemove.has(a.packageId));
            const allAvailableSelected =
              available.length > 0 && available.every((p) => selectedAdd.has(p.id));
            return (
              <div className="space-y-4 py-2">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-medium text-muted-foreground">
                      {zh ? `已分配（${assignTarget.assignments.length}）` : `Assigned (${assignTarget.assignments.length})`}
                    </div>
                    <div className="flex items-center gap-2">
                      {assignTarget.assignments.length > 0 && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setSelectedRemove(
                              allAssignedSelected
                                ? new Set()
                                : new Set(assignTarget.assignments.map((a) => a.packageId)),
                            );
                          }}
                        >
                          {allAssignedSelected
                            ? (zh ? "取消全选" : "Deselect all")
                            : (zh ? "全选" : "Select all")}
                        </button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 dark:text-red-400"
                        disabled={selectedRemove.size === 0}
                        onClick={handleBatchRemove}
                      >
                        {zh
                          ? `批量移除 (${selectedRemove.size})`
                          : `Remove (${selectedRemove.size})`}
                      </Button>
                    </div>
                  </div>
                  {assignTarget.assignments.length === 0 ? (
                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      {zh ? "暂无分配。" : "None assigned."}
                    </div>
                  ) : (
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                      {assignTarget.assignments.map((a) => (
                        <label
                          key={a.packageId}
                          className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={selectedRemove.has(a.packageId)}
                              onChange={() =>
                                setSelectedRemove((prev) => toggleSet(prev, a.packageId))
                              }
                            />
                            <Badge variant="secondary" className="text-xs">{a.taskType}</Badge>
                            <span className="text-sm">{a.packageName}</span>
                            <span className="text-xs text-muted-foreground">{a.videoCount} {zh ? "个视频" : "videos"}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 dark:text-red-400"
                            onClick={(e) => {
                              e.preventDefault();
                              handleUnassign(a.packageId);
                            }}
                          >
                            {zh ? "移除" : "Remove"}
                          </Button>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-medium text-muted-foreground">
                      {zh ? "可添加任务" : "Available packages"}
                    </div>
                    <div className="flex items-center gap-2">
                      {available.length > 0 && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setSelectedAdd(
                              allAvailableSelected
                                ? new Set()
                                : new Set(available.map((p) => p.id)),
                            );
                          }}
                        >
                          {allAvailableSelected
                            ? (zh ? "取消全选" : "Deselect all")
                            : (zh ? "全选" : "Select all")}
                        </button>
                      )}
                      <Button
                        size="sm"
                        disabled={selectedAdd.size === 0}
                        onClick={handleBatchAdd}
                      >
                        {zh
                          ? `批量添加 (${selectedAdd.size})`
                          : `Add (${selectedAdd.size})`}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
                    {available.map((p) => (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selectedAdd.has(p.id)}
                            onChange={() =>
                              setSelectedAdd((prev) => toggleSet(prev, p.id))
                            }
                          />
                          <Badge variant="secondary" className="text-xs">{p.taskType}</Badge>
                          <Badge variant="outline" className="text-xs">{p.evaluationMode}</Badge>
                          <span className="text-sm">{p.name}</span>
                          <span className="text-xs text-muted-foreground">{p.videoCount} {zh ? "个视频" : "videos"}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.preventDefault();
                            handleAssign(p.id);
                          }}
                        >
                          {zh ? "添加" : "Add"}
                        </Button>
                      </label>
                    ))}
                    {available.length === 0 && (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        {zh ? "所有任务均已分配。" : "All packages already assigned."}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button onClick={() => setAssignTarget(null)}>{zh ? "关闭" : "Close"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credential toast dialog */}
      <Dialog open={!!credentialToast} onOpenChange={(v) => { if (!v) setCredentialToast(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {credentialToast?.kind === "created"
                ? (zh ? "Viewer 创建成功" : "Viewer Created")
                : (zh ? "密码已重置" : "Password Reset")}
            </DialogTitle>
            <DialogDescription>
              {zh
                ? "密码仅显示这一次，请立即复制并同步到 CREDENTIALS.md。"
                : "This password is shown only once. Copy it now and record in CREDENTIALS.md."}
            </DialogDescription>
          </DialogHeader>
          {credentialToast && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{zh ? "邮箱" : "Email"}</div>
                <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
                  {credentialToast.email}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{zh ? "密码" : "Password"}</div>
                <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all">
                  {credentialToast.password}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (credentialToast) {
                  navigator.clipboard.writeText(`${credentialToast.email} / ${credentialToast.password}`);
                }
              }}
            >
              {zh ? "复制" : "Copy"}
            </Button>
            <Button onClick={() => setCredentialToast(null)}>{zh ? "我已记录" : "I've Recorded"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk N viewers × M packages dialog. The action skips already-assigned
          combinations server-side via skipDuplicates — admins don't need to
          deduplicate manually, and the result toast shows added vs skipped. */}
      <Dialog open={bulkOpen} onOpenChange={(v) => { if (!bulkBusy) setBulkOpen(v); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{zh ? "批量分配任务给 viewer" : "Bulk Assign Packages to Viewers"}</DialogTitle>
            <DialogDescription>
              {zh
                ? "勾选 viewer 与任务，提交后已分配的组合会自动跳过。"
                : "Select viewers and packages. Existing assignments are skipped automatically."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">
                  {zh ? `Viewer（${bulkViewers.size} / ${viewers.length}）` : `Viewers (${bulkViewers.size} / ${viewers.length})`}
                </div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    if (bulkViewers.size === viewers.length) {
                      setBulkViewers(new Set());
                    } else {
                      setBulkViewers(new Set(viewers.map((v) => v.id)));
                    }
                  }}
                >
                  {bulkViewers.size === viewers.length
                    ? (zh ? "取消全选" : "Deselect all")
                    : (zh ? "全选" : "Select all")}
                </button>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
                {viewers.map((v) => (
                  <label
                    key={v.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={bulkViewers.has(v.id)}
                      onChange={() => setBulkViewers((prev) => toggleSet(prev, v.id))}
                    />
                    <span className="text-sm font-medium">{v.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{v.email}</span>
                  </label>
                ))}
                {viewers.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {zh ? "暂无 viewer" : "No viewers"}
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">
                  {zh ? `任务（${bulkPackages.size} / ${packages.length}）` : `Packages (${bulkPackages.size} / ${packages.length})`}
                </div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    if (bulkPackages.size === packages.length) {
                      setBulkPackages(new Set());
                    } else {
                      setBulkPackages(new Set(packages.map((p) => p.id)));
                    }
                  }}
                >
                  {bulkPackages.size === packages.length
                    ? (zh ? "取消全选" : "Deselect all")
                    : (zh ? "全选" : "Select all")}
                </button>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
                {packages.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={bulkPackages.has(p.id)}
                      onChange={() => setBulkPackages((prev) => toggleSet(prev, p.id))}
                    />
                    <Badge variant="secondary" className="text-xs">{p.taskType}</Badge>
                    <Badge variant="outline" className="text-xs">{p.evaluationMode}</Badge>
                    <span className="text-sm">{p.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{p.videoCount}</span>
                  </label>
                ))}
                {packages.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {zh ? "暂无任务" : "No packages"}
                  </div>
                )}
              </div>
            </div>
          </div>
          {bulkResult && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              {zh
                ? `已添加 ${bulkResult.added} 条分配，跳过 ${bulkResult.skipped} 条已存在的。`
                : `Added ${bulkResult.added}, skipped ${bulkResult.skipped} (already assigned).`}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>
              {zh ? "关闭" : "Close"}
            </Button>
            <Button
              disabled={bulkBusy || bulkViewers.size === 0 || bulkPackages.size === 0}
              onClick={handleBulkAssign}
            >
              {bulkBusy
                ? (zh ? "提交中…" : "Submitting…")
                : zh
                  ? `分配 ${bulkViewers.size} × ${bulkPackages.size}`
                  : `Assign ${bulkViewers.size} × ${bulkPackages.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
