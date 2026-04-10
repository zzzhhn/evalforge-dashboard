"use client";

import type { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "管理员",
  RESEARCHER: "研究员",
  ANNOTATOR: "评测员",
  VENDOR_ANNOTATOR: "外包评测员",
  REVIEWER: "审核员",
  VIEWER: "观察者",
};

export function Topbar({ name, role }: { name: string; role: Role }) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div />
      <div className="flex items-center gap-3">
        <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
        <span className="text-sm text-muted-foreground">{name}</span>
        <form action="/api/auth/logout" method="POST">
          <Button variant="ghost" size="sm" type="submit">
            退出
          </Button>
        </form>
      </div>
    </header>
  );
}
