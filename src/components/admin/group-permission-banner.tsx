"use client";

import { Check, X } from "lucide-react";
import { useLocale } from "@/lib/i18n/context";

export type GroupViewerScope = "SYSTEM_ADMIN" | "GROUP_ADMIN" | "READ_ONLY";

interface Props {
  scope: GroupViewerScope;
  visibleGroupCount: number;
  groupAdminOfCount?: number;
}

// Permission matrix — shows BOTH roles side-by-side so an admin viewing the
// page immediately understands what a Group Admin can and cannot do, without
// needing to log in as one. The "current role" highlight signals who's viewing.
export function GroupPermissionBanner({ scope }: Props) {
  const { locale } = useLocale();

  const sysAdminItems: string[] =
    locale === "zh"
      ? ["全部 Group", "系统设置", "评测员档案", "样本分配", "校准基线"]
      : ["All Groups", "System settings", "Annotator profiles", "Sample assignment", "Calibration baseline"];

  const groupAdminAllow: string[] =
    locale === "zh"
      ? ["本 Group 成员", "本 Group 样本分配", "进度与质量报表"]
      : ["Own-group members", "Own-group sample assignment", "Progress & quality reports"];

  const groupAdminDeny: string[] =
    locale === "zh" ? ["系统设置", "其他 Group"] : ["System settings", "Other groups"];

  // Group Admin perspective: showing the "系统管理员" column is both noise and
  // a confusing tease ("here's what I don't have"). Hide it entirely and let
  // them focus on their own capability set. SYSTEM admins still see both so
  // they understand what delegated Group Admins can do.
  const showSystemColumn = scope === "SYSTEM_ADMIN";

  return (
    <div
      className={`grid grid-cols-1 gap-3 rounded-lg border bg-muted/20 p-4 ${
        showSystemColumn ? "lg:grid-cols-2" : ""
      }`}
    >
      {showSystemColumn && (
        <Column
          heading={locale === "zh" ? "系统管理员" : "System admin"}
          headingTone="neutral"
          active={scope === "SYSTEM_ADMIN"}
        >
          {sysAdminItems.map((label) => (
            <AllowPill key={label} label={label} />
          ))}
        </Column>
      )}

      <Column
        heading={locale === "zh" ? "GROUP 管理员" : "GROUP admin"}
        headingTone="scoped"
        scopeLabel={locale === "zh" ? "本 GROUP 内" : "within own GROUP"}
        active={scope === "GROUP_ADMIN"}
      >
        {groupAdminAllow.map((label) => (
          <AllowPill key={label} label={label} />
        ))}
        {groupAdminDeny.map((label) => (
          <DenyPill key={label} label={label} />
        ))}
      </Column>
    </div>
  );
}

function Column({
  heading,
  headingTone,
  scopeLabel,
  active,
  children,
}: {
  heading: string;
  headingTone: "neutral" | "scoped";
  scopeLabel?: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-md px-3 py-2 transition ${
        active ? "ring-1 ring-primary/40 bg-primary/5" : ""
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {heading}
        </span>
        {scopeLabel && headingTone === "scoped" && (
          <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {scopeLabel}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function AllowPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
      <Check className="h-3 w-3" strokeWidth={2.25} />
      {label}
    </span>
  );
}

function DenyPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-600 line-through decoration-rose-500/60 dark:text-rose-400">
      <X className="h-3 w-3" strokeWidth={2.25} />
      {label}
    </span>
  );
}
