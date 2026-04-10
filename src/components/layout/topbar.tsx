"use client";

import { useState, useEffect } from "react";
import type { Role } from "@prisma/client";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";

export function Topbar({ name, role }: { name: string; role: Role }) {
  const { resolvedTheme, setTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div />
      <div className="flex items-center gap-3">
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
            className="text-xs"
          >
            {resolvedTheme === "dark" ? "☀️" : "🌙"}
          </Button>
        )}

        <Badge variant="secondary">
          {t(`role.${role}` as Parameters<typeof t>[0])}
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
