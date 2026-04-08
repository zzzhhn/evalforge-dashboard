"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Video, Bot, Info, ExternalLink } from "lucide-react";

const NAV_LINKS = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/video", label: "Video", icon: Video },
  { href: "/agent", label: "Agent", icon: Bot },
  { href: "/about", label: "About", icon: Info },
] as const;

export function Navigation() {
  const pathname = usePathname();

  return (
    <header className="nav-glass sticky top-0 z-50">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold text-text-primary hover:text-accent-cyan transition-colors"
          >
            <span className="text-accent-blue">Eval</span>
            <span>Forge</span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => {
              const isActive =
                href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(href);

              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent-blue/15 text-accent-blue"
                      : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <a
          href="https://github.com/BobbyZhong/evalforge"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
        >
          <ExternalLink size={16} />
          <span className="hidden sm:inline">View on GitHub</span>
        </a>
      </div>
    </header>
  );
}
