"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";

interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: string;
  roles?: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/tasks", labelKey: "nav.tasks", icon: "📋", roles: ["ANNOTATOR", "VENDOR_ANNOTATOR", "RESEARCHER"] },
  { href: "/progress", labelKey: "nav.progress", icon: "📊", roles: ["ANNOTATOR", "VENDOR_ANNOTATOR", "RESEARCHER"] },
  { href: "/admin/samples", labelKey: "nav.samples", icon: "🎬", roles: ["ADMIN", "RESEARCHER"] },
  { href: "/admin/annotators", labelKey: "nav.annotators", icon: "👥", roles: ["ADMIN", "RESEARCHER"] },
  { href: "/admin/analytics", labelKey: "nav.analytics", icon: "📈", roles: ["ADMIN", "RESEARCHER", "REVIEWER"] },
  { href: "/admin/settings", labelKey: "admin.settings.title", icon: "⚙️", roles: ["ADMIN"] },
];

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const { locale, t } = useLocale();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(role)
  );

  return (
    <aside className="flex w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-sm font-semibold">
          {locale === "zh" ? "EvalForge 评测" : "EvalForge Eval"}
        </span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {visibleItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <span>{item.icon}</span>
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
