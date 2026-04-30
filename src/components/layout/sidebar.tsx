"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  LineChart,
  Clapperboard,
  Package,
  Users,
  User,
  Target,
  Tag,
  Ruler,
  KeyRound,
  Activity,
  Eye,
  Film,
  Settings,
  type LucideIcon,
} from "lucide-react";

interface NavChild {
  tab: string;
  labelKey: TranslationKey;
  Icon: LucideIcon;
  roles?: Role[];
  /** If true, the child is also visible to Group Admins (annotators with
   *  GroupMembership.isAdmin=true). Their view is automatically scoped to
   *  own-group members by the server pages. */
  includeGroupAdmin?: boolean;
}

interface NavItem {
  href: string;
  labelKey: TranslationKey;
  Icon: LucideIcon;
  roles?: Role[];
  /** Same semantics as NavChild.includeGroupAdmin. Apply only to surfaces
   *  that have been wired through `getAdminScope` on the server side. */
  includeGroupAdmin?: boolean;
  children?: NavChild[];
  defaultTab?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/tasks", labelKey: "nav.tasks", Icon: ListTodo, roles: ["ANNOTATOR", "VENDOR_ANNOTATOR", "RESEARCHER"] },
  { href: "/progress", labelKey: "nav.progress", Icon: LineChart, roles: ["ANNOTATOR", "VENDOR_ANNOTATOR", "RESEARCHER"] },
  // Group Admin dedicated entry. roles: [] means nobody matches by role;
  // `includeGroupAdmin: true` unlocks it solely for annotators with
  // GroupMembership.isAdmin=true. Routes to the consolidated "My Group"
  // dashboard under /admin/annotators?tab=groups, which auto-scopes to
  // their own groups and renders a full 3-panel view.
  {
    href: "/admin/annotators?tab=groups",
    labelKey: "nav.myGroup",
    Icon: Tag,
    roles: [],
    includeGroupAdmin: true,
  },
  { href: "/admin/samples", labelKey: "nav.samples", Icon: Clapperboard, roles: ["ADMIN", "RESEARCHER"] },
  { href: "/admin/datasets", labelKey: "nav.datasets", Icon: Package, roles: ["ADMIN", "RESEARCHER"] },
  {
    href: "/admin/annotators",
    labelKey: "nav.annotators",
    Icon: Users,
    roles: ["ADMIN", "RESEARCHER"],
    defaultTab: "people",
    children: [
      { tab: "people", labelKey: "nav.annotators.people", Icon: User },
      { tab: "assignment", labelKey: "nav.annotators.assignment", Icon: Target },
      { tab: "groups", labelKey: "nav.annotators.groups", Icon: Tag, roles: ["ADMIN"] },
      { tab: "calibration", labelKey: "nav.annotators.calibration", Icon: Ruler },
      { tab: "credentials", labelKey: "nav.annotators.credentials", Icon: KeyRound, roles: ["ADMIN"] },
    ],
  },
  { href: "/admin/analytics", labelKey: "nav.analytics", Icon: Activity, roles: ["ADMIN", "RESEARCHER", "REVIEWER"] },
  { href: "/admin/viewers", labelKey: "nav.viewers", Icon: Eye, roles: ["ADMIN"] },
  { href: "/viewer", labelKey: "nav.viewerFeed", Icon: Film, roles: ["VIEWER"] },
  { href: "/admin/settings", labelKey: "admin.settings.title", Icon: Settings, roles: ["ADMIN"] },
];

export function Sidebar({
  role,
  isGroupAdmin = false,
}: {
  role: Role;
  /** Annotator with GroupMembership.isAdmin=true for ≥1 group. Unlocks
   *  admin nav entries flagged `includeGroupAdmin`. Server pages still
   *  enforce scope via `getAdminScope`. */
  isGroupAdmin?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab");
  const { locale, t } = useLocale();
  const isWorkstation = pathname.startsWith("/workstation");
  const [navOpen, setNavOpen] = useState(true);
  // Default-expanded everywhere — including workstation — because the
  // workstation uses the sidebar as its video-list scroller and package
  // picker. Collapsed by default meant annotators didn't realize they
  // could scroll through videos without opening/closing the drawer.
  // Users can still manually collapse via the chevron if they want more
  // room.
  const [collapsed, setCollapsed] = useState(false);
  void isWorkstation; // retained for potential future routing-aware UX

  // A nav item is visible if: its role list is empty (public), the user's
  // role matches, or it's flagged includeGroupAdmin and the user is one.
  const isAllowed = (roles: Role[] | undefined, groupAdminOk: boolean) =>
    !roles || roles.includes(role) || (isGroupAdmin && groupAdminOk);
  const visibleItems = NAV_ITEMS.filter((item) =>
    isAllowed(item.roles, item.includeGroupAdmin === true),
  );

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r bg-card transition-[width] duration-300 ease-in-out",
        collapsed ? "w-10" : "w-56"
      )}
    >
      {/* Header — matches topbar's h-14 so the two align flush at the top */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b",
          collapsed ? "justify-center px-1" : "justify-between px-3"
        )}
      >
        {!collapsed && (
          <span className="text-sm font-semibold truncate">
            {locale === "zh" ? "EvalForge 评测" : "EvalForge"}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          {!collapsed && (
            <button
              onClick={() => setNavOpen((o) => !o)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={locale === "zh" ? "菜单" : "Menu"}
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  navOpen && "rotate-180"
                )}
              />
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={
              collapsed
                ? locale === "zh" ? "展开侧边栏" : "Expand sidebar"
                : locale === "zh" ? "收起侧边栏" : "Collapse sidebar"
            }
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible nav dropdown */}
      <div
        className={cn(
          "overflow-hidden border-b transition-[max-height,opacity] duration-300 ease-in-out",
          !collapsed && navOpen
            ? "max-h-[32rem] opacity-100"
            : "max-h-0 opacity-0 border-b-0"
        )}
      >
        <nav className="space-y-0.5 p-2">
          {visibleItems.map((item) => {
            // Strip any query string from `item.href` before pathname
            // comparison — our Group-Admin entry uses `?tab=groups` inline,
            // and `pathname.startsWith("/admin/annotators?tab=groups")`
            // would never match because pathname drops the query string.
            const itemPath = item.href.split("?")[0];
            const itemQueryTab = new URLSearchParams(
              item.href.split("?")[1] ?? "",
            ).get("tab");
            const active =
              pathname.startsWith(itemPath) &&
              (itemQueryTab == null || activeTab === itemQueryTab);
            const parentHref = item.defaultTab
              ? `${item.href}?tab=${item.defaultTab}`
              : item.href;
            const visibleChildren = item.children?.filter((c) =>
              isAllowed(c.roles, c.includeGroupAdmin === true),
            );
            return (
              <div key={item.href}>
                <Link
                  href={parentHref}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <item.Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {t(item.labelKey)}
                </Link>
                {/* Always render sub-tree so new users can discover the
                    sub-pages without having to first navigate to the parent.
                    Active highlight is still driven by `pathname + tab`, so
                    only the truly-current child renders in the primary color. */}
                {visibleChildren && visibleChildren.length > 0 && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                    {visibleChildren.map((child) => {
                      const childActive =
                        active &&
                        (activeTab === child.tab ||
                          (!activeTab && child.tab === item.defaultTab));
                      return (
                        <Link
                          key={child.tab}
                          href={`${item.href}?tab=${child.tab}`}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-3 py-1 text-xs transition-colors",
                            childActive
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          )}
                        >
                          <child.Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                          {t(child.labelKey)}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Portal targets — keep mounted when collapsed (display:none) so
          workstation's document.getElementById lookup still resolves. */}
      <div
        id="sidebar-package-select"
        className={cn("overflow-y-auto", collapsed && "hidden")}
      />
      <div
        id="sidebar-video-list"
        className={cn("flex-1 overflow-hidden", collapsed && "hidden")}
      />
    </aside>
  );
}
