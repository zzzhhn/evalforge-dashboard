"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";

interface PackageOption {
  id: string;
  name: string;
  status: string;
}

interface Props {
  packages: PackageOption[];
  selectedPkgId: string | null;
}

/**
 * Shared package filter for admin pages.
 * Uses URL search params (?pkg=<id>) so links are shareable and the server
 * component re-fetches scoped data on selection change.
 */
export function PackageFilter({ packages, selectedPkgId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale } = useLocale();

  const handleChange = (pkgId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (pkgId === "ALL") {
      params.delete("pkg");
    } else {
      params.set("pkg", pkgId);
    }
    // Preserve other params (page, tab, etc.) but reset page to 1
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {locale === "zh" ? "任务筛选" : "Package"}
      </span>
      <button
        onClick={() => handleChange("ALL")}
        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          !selectedPkgId
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border text-muted-foreground hover:bg-muted"
        }`}
      >
        {locale === "zh" ? "全部" : "All"}
      </button>
      {packages.map((pkg) => (
        <button
          key={pkg.id}
          onClick={() => handleChange(pkg.id)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            selectedPkgId === pkg.id
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          {pkg.name}
        </button>
      ))}
    </div>
  );
}
