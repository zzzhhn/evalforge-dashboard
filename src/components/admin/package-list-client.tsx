"use client";

import { useState, useMemo, useEffect } from "react";
import { useLocale } from "@/lib/i18n/context";
import { PackageSidebar, type SidebarPackage } from "./package-sidebar";
import { PackageDetailPanel, type DetailPackage } from "./package-detail-panel";
import {
  PackageFiltersBar,
  DEFAULT_FILTERS,
  type FilterState,
} from "./package-filters-bar";

interface AnnotatorProgress {
  name: string;
  accountType: "INTERNAL" | "VENDOR";
  completed: number;
  total: number;
}

interface PackageData {
  id: string;
  name: string;
  taskType: string;
  evaluationMode: "SCORING" | "ARENA";
  videoCount: number;
  annotatorCount: number;
  completedItems: number;
  totalItems: number;
  status: string;
  publishedAt: string | null;
  startAt: string | null;
  deadline: string | null;
  deadlineStatus: "ok" | "near" | "overdue" | null;
  modelCheckpoint: string | null;
  description: string | null;
  modelNames: string[];
  annotatorTypeMix: "INTERNAL" | "VENDOR" | "MIXED" | "NONE";
  maxRiskLevel: "HIGH_RISK" | "MEDIUM_RISK" | "LOW_RISK" | "NONE";
  annotatorProgress: AnnotatorProgress[];
  currentMembers: Array<{
    id: string;
    name: string;
    email: string;
    accountType: string;
    completed: number;
    total: number;
  }>;
  createdAt: string;
}

interface Props {
  packages: PackageData[];
}

function matchesFilters(pkg: PackageData, filters: FilterState): boolean {
  if (filters.taskType !== "ALL" && pkg.taskType !== filters.taskType) {
    return false;
  }
  if (filters.evaluationMode !== "ALL" && pkg.evaluationMode !== filters.evaluationMode) {
    return false;
  }
  if (
    filters.annotatorType !== "ALL" &&
    pkg.annotatorTypeMix !== filters.annotatorType
  ) {
    return false;
  }

  if (filters.startFrom || filters.startTo) {
    // Filter by the package's time window (startAt ~ deadline). Include the
    // package if its window intersects the selected range. Packages without
    // startAt fall back to createdAt.
    const windowStart = new Date(pkg.startAt ?? pkg.createdAt).getTime();
    const windowEnd = pkg.deadline ? new Date(pkg.deadline).getTime() : Infinity;
    const fromTs = filters.startFrom ? new Date(filters.startFrom).getTime() : -Infinity;
    const toTs = filters.startTo
      ? new Date(filters.startTo + "T23:59:59+08:00").getTime()
      : Infinity;
    if (windowEnd < fromTs || windowStart > toTs) return false;
  }

  return true;
}

export function PackageListClient({ packages }: Props) {
  const { t } = useLocale();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(
    packages[0]?.id ?? null
  );

  const filtered = useMemo(
    () => packages.filter((p) => matchesFilters(p, filters)),
    [packages, filters]
  );

  // Keep selection valid against filter changes.
  useEffect(() => {
    if (!selectedId || !filtered.find((p) => p.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  const sidebarPackages: SidebarPackage[] = filtered.map((p) => ({
    id: p.id,
    name: p.name,
    taskType: p.taskType,
    evaluationMode: p.evaluationMode,
    status: p.status,
    completedItems: p.completedItems,
    totalItems: p.totalItems,
    maxRiskLevel: p.maxRiskLevel,
  }));

  const selected: DetailPackage | null =
    filtered.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="shrink-0 space-y-2">
        <PackageFiltersBar value={filters} onChange={setFilters} />
        <div className="text-xs text-muted-foreground">
          {t("admin.samples.total", { count: String(filtered.length) })}
        </div>
      </div>

      {/* Master-detail: 30% sidebar / 70% detail; both fill remaining height with independent scroll */}
      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(240px,30%)_1fr]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border bg-card p-2">
          <PackageSidebar
            packages={sidebarPackages}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>
        <section className="flex min-h-0 flex-col overflow-hidden">
          <PackageDetailPanel pkg={selected} />
        </section>
      </div>
    </div>
  );
}
