import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProgressClient } from "@/components/progress/progress-client";

export default async function ProgressPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Fetch all items with package and score info
  const items = await prisma.evaluationItem.findMany({
    where: {
      assignedToId: session.userId,
      // EvaluationItem.packageId is authoritative; legacy fallback dropped
      // 2026-04-29 (see tasks/page.tsx for context).
      package: { status: "PUBLISHED", deletedAt: null },
    },
    select: {
      id: true,
      status: true,
      // Use the authoritative item.package directly; videoAsset.package is
      // the legacy 1:1 relation that has drifted.
      package: { select: { id: true, name: true, deadline: true } },
    },
  });

  const scores = await prisma.score.findMany({
    where: { userId: session.userId },
    select: {
      value: true,
      evaluationItem: {
        // Authoritative packageId on the item itself; legacy
        // videoAsset.packageId has drifted (5 conflict groups in prod).
        select: { packageId: true },
      },
    },
  });

  // Build per-package summaries
  const pkgMap = new Map<string, {
    id: string;
    name: string;
    deadline: string | null;
    total: number;
    completed: number;
  }>();
  for (const item of items) {
    const pkg = item.package;
    if (!pkg) continue;
    const entry = pkgMap.get(pkg.id) ?? {
      id: pkg.id,
      name: pkg.name,
      deadline: pkg.deadline?.toISOString() ?? null,
      total: 0,
      completed: 0,
    };
    entry.total += 1;
    if (item.status === "COMPLETED") entry.completed += 1;
    pkgMap.set(pkg.id, entry);
  }
  const packageSummaries = [...pkgMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );

  // Build per-package score distributions
  const pkgScoreMap = new Map<string, [number, number, number, number, number]>();
  for (const s of scores) {
    const pkgId = s.evaluationItem.packageId;
    if (!pkgId) continue;
    const dist = pkgScoreMap.get(pkgId) ?? [0, 0, 0, 0, 0];
    dist[s.value - 1]++;
    pkgScoreMap.set(pkgId, dist);
  }

  const packageStats = packageSummaries.map((pkg) => ({
    packageId: pkg.id,
    total: pkg.total,
    completed: pkg.completed,
    scoreDistribution: pkgScoreMap.get(pkg.id) ?? [0, 0, 0, 0, 0] as [number, number, number, number, number],
  }));

  // Global stats
  const globalTotal = items.length;
  const globalCompleted = items.filter((i) => i.status === "COMPLETED").length;
  const globalDist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const s of scores) {
    globalDist[s.value - 1]++;
  }

  return (
    <ProgressClient
      packageSummaries={packageSummaries}
      packageStats={packageStats}
      globalStats={{
        total: globalTotal,
        completed: globalCompleted,
        scoreDistribution: globalDist,
      }}
    />
  );
}
