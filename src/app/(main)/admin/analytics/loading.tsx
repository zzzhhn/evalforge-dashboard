import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton for the analytics dashboard while scores + charts load */
export default function AnalyticsLoading() {
  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-6 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>

      {/* Filter bar skeleton */}
      <div className="rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-12" />
          <div className="flex gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 rounded-full" />
            ))}
          </div>
        </div>
      </div>

      {/* Chart grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-[max(250px,30vh)] w-full rounded" />
        </div>
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-[max(250px,30vh)] w-full rounded" />
        </div>
        <div className="rounded-lg border bg-card p-6 space-y-4 lg:col-span-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-[max(300px,35vh)] w-full rounded" />
        </div>
      </div>
    </div>
  );
}
