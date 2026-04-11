import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLocale, t } from "@/lib/i18n/server";
import { PackageDetailClient } from "@/components/admin/package-detail-client";

interface Props {
  params: Promise<{ packageId: string }>;
}

export default async function PackageDetailPage({ params }: Props) {
  const { packageId } = await params;
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    include: {
      videoAssets: {
        include: {
          model: true,
          prompt: true,
          evaluationItems: {
            select: { status: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!pkg) notFound();

  const assets = pkg.videoAssets.map((va) => {
    const completed = va.evaluationItems.filter((i) => i.status === "COMPLETED").length;
    return {
      id: va.id,
      promptZh: va.prompt.textZh,
      promptEn: va.prompt.textEn,
      externalId: va.prompt.externalId,
      modelName: va.model.name,
      taskType: va.model.taskType,
      durationSec: va.durationSec,
      completedItems: completed,
      totalItems: va.evaluationItems.length,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/samples">
          <Button variant="ghost" size="sm">
            ← {t(locale, "admin.samples.title")}
          </Button>
        </Link>
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
        <span className="text-lg font-semibold">{pkg.name}</span>
      </div>

      <PackageDetailClient assets={assets} />
    </div>
  );
}
