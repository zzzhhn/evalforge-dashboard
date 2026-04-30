import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";

interface Props {
  params: Promise<{ packageId: string }>;
}

export default async function ViewerPackageEntryPage({ params }: Props) {
  const { packageId } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "VIEWER" && session.role !== "ADMIN") {
    redirect("/tasks");
  }

  if (session.role === "VIEWER") {
    const assignment = await prisma.viewerAssignment.findUnique({
      where: { viewerId_packageId: { viewerId: session.userId, packageId } },
      select: { id: true },
    });
    if (!assignment) notFound();
  }

  const first = await prisma.videoAsset.findFirst({
    where: { packageId },
    orderBy: { prompt: { externalId: "asc" } },
    select: { id: true },
  });

  if (!first) {
    redirect("/viewer");
  }

  redirect(`/viewer/sample/${first.id}?pkg=${packageId}`);
}
