import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getLocale, t } from "@/lib/i18n/server";

export default async function ViewerHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "VIEWER" && session.role !== "ADMIN") {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const assignments =
    session.role === "ADMIN"
      ? await prisma.evaluationPackage.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            taskType: true,
            evaluationMode: true,
            videoCount: true,
            createdAt: true,
            _count: { select: { videoAssets: true } },
          },
        })
      : (
          await prisma.viewerAssignment.findMany({
            where: { viewerId: session.userId },
            orderBy: { assignedAt: "desc" },
            select: {
              assignedAt: true,
              package: {
                select: {
                  id: true,
                  name: true,
                  taskType: true,
                  evaluationMode: true,
                  videoCount: true,
                  createdAt: true,
                  deletedAt: true,
                  _count: { select: { videoAssets: true } },
                },
              },
            },
          })
        )
          .filter((a) => a.package.deletedAt === null)
          .map((a) => a.package);

  // VIEWERs land directly on the first viewable video. The package-grid
  // surface stays available for ADMIN overview and as fallback when the
  // viewer has no assignments yet.
  if (session.role === "VIEWER" && assignments.length > 0) {
    const firstPkgWithAsset = await prisma.evaluationPackage.findFirst({
      where: {
        id: { in: assignments.map((p) => p.id) },
        videoAssets: { some: {} },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (firstPkgWithAsset) {
      redirect(`/viewer/package/${firstPkgWithAsset.id}`);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">{t(locale, "viewer.home.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(locale, "viewer.home.subtitle")}
          </p>
        </div>

        {assignments.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="text-4xl">🎞️</div>
              <p className="text-sm text-muted-foreground">
                {t(locale, "viewer.home.empty")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {assignments.map((pkg) => (
              <Link
                key={pkg.id}
                href={`/viewer/package/${pkg.id}`}
                className="group"
              >
                <Card className="h-full transition-colors hover:border-primary">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium group-hover:text-primary">
                        {pkg.name}
                      </h3>
                      <Badge
                        variant="outline"
                        className={
                          pkg.taskType === "T2V"
                            ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                            : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                        }
                      >
                        {pkg.taskType}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {pkg._count.videoAssets} {t(locale, "viewer.home.videos")}
                      </span>
                      <span>·</span>
                      <span>
                        {new Date(pkg.createdAt).toLocaleDateString(
                          locale === "zh" ? "zh-CN" : "en-US"
                        )}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
