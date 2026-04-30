import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the three-column workstation layout while data loads */
export default function WorkstationLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Top bar skeleton */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-20 rounded-md" />
      </header>

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="hidden w-56 shrink-0 flex-col border-r bg-card/50 p-3 space-y-5 lg:flex">
          <div className="space-y-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full rounded" />
            ))}
          </div>
        </aside>

        {/* Center content */}
        <main className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl space-y-3 p-4">
            {/* Prompt + hierarchy row */}
            <div className="flex gap-3">
              <div className="flex flex-1 gap-3 rounded-lg border bg-card p-3">
                <Skeleton className="h-32 w-32 shrink-0 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <div className="w-52 shrink-0 rounded-lg border bg-card p-3 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>

            {/* Video player skeleton */}
            <Skeleton className="aspect-video w-full rounded-lg" />

            {/* Scoring panel skeleton */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <Skeleton className="h-5 w-40" />
              <div className="flex gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-10 rounded-full" />
                ))}
              </div>
              <Skeleton className="h-20 w-full rounded-md" />
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          </div>
        </main>

        {/* Right sidebar */}
        <div className="relative hidden w-[200px] shrink-0 lg:flex">
          <aside className="flex flex-1 flex-col overflow-hidden border-l bg-card/50">
            <div className="border-b px-3 py-2">
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex-1 space-y-0">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="border-b px-3 py-1.5 space-y-1">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {/* Bottom bar */}
      <footer className="flex h-12 shrink-0 items-center justify-between border-t bg-card px-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-28 rounded" />
        </div>
      </footer>
    </div>
  );
}
