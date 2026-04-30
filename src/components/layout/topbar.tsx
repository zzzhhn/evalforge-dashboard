"use client";

import { useState, useEffect } from "react";
import type { Role } from "@prisma/client";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";

export function Topbar({
  name,
  role,
  isGroupAdmin = false,
}: {
  name: string;
  role: Role;
  /** True when the user is an annotator with GroupMembership.isAdmin=true
   *  for at least one group. Surfaces a distinct badge so admins know
   *  they're in restricted scope. */
  isGroupAdmin?: boolean;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-card px-6">
      {/* Portal slot: viewer pages inject a horizontal package picker here so
          the boss can jump between models (Vidu Q3 / Pixverse v6 / …) from
          the video detail page without going back to the grid. */}
      <div id="topbar-center-slot" className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-3">
        {/* Language toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
          className="text-xs font-mono"
        >
          {locale === "zh" ? "EN" : "中"}
        </Button>

        {/* Theme toggle — only render after mount to avoid hydration mismatch */}
        {mounted && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="h-8 w-8 p-0"
            aria-label={resolvedTheme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" strokeWidth={1.75} />
            ) : (
              <Moon className="h-4 w-4" strokeWidth={1.75} />
            )}
          </Button>
        )}

        <Badge
          variant={isGroupAdmin ? "default" : "secondary"}
          className={
            isGroupAdmin
              ? "bg-primary/15 text-primary border-primary/30 hover:bg-primary/20"
              : ""
          }
        >
          {isGroupAdmin
            ? locale === "zh"
              ? "GROUP 管理员"
              : "Group Admin"
            : t(`role.${role}` as Parameters<typeof t>[0])}
        </Badge>
        <span className="text-sm text-muted-foreground">{name}</span>
        <form action="/api/auth/logout" method="POST">
          <Button variant="ghost" size="sm" type="submit">
            {t("auth.logout")}
          </Button>
        </form>
      </div>
    </header>
  );
}
