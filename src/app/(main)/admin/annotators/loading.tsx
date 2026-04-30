import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton for annotator list table while user data loads */
export default function AnnotatorsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="rounded-md border">
        <div className="border-b px-4 py-3 flex gap-6">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-16" />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 border-b px-4 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-10 font-mono" />
            <Skeleton className="h-5 w-8 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
