import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getLocale, t } from "@/lib/i18n/server";

export default async function AnnotatorsPage() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const annotators = await prisma.user.findMany({
    where: {
      role: { in: ["ANNOTATOR", "VENDOR_ANNOTATOR"] },
      deletedAt: null,
    },
    include: {
      evaluationItems: {
        select: { status: true },
      },
      scores: {
        select: { value: true, validity: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t(locale, "admin.annotators.title")}</h1>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "admin.annotators.name")}</TableHead>
              <TableHead>{t(locale, "admin.annotators.email")}</TableHead>
              <TableHead>{t(locale, "admin.annotators.type")}</TableHead>
              <TableHead>{t(locale, "admin.annotators.completed")}</TableHead>
              <TableHead>{t(locale, "admin.annotators.avgScore")}</TableHead>
              <TableHead>{t(locale, "admin.annotators.risk")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {annotators.map((user) => {
              const completed = user.evaluationItems.filter((i) => i.status === "COMPLETED").length;
              const total = user.evaluationItems.length;
              const validScores = user.scores.filter((s) => s.validity === "VALID");
              const avgScore = validScores.length > 0
                ? (validScores.reduce((s, sc) => s + sc.value, 0) / validScores.length).toFixed(2)
                : "-";
              const suspiciousCount = user.scores.filter((s) => s.validity === "SUSPICIOUS").length;

              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.role !== "VENDOR_ANNOTATOR" ? "default" : "secondary"}>
                      {user.role !== "VENDOR_ANNOTATOR"
                        ? t(locale, "admin.annotators.internal")
                        : t(locale, "admin.annotators.vendor")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{completed}/{total}</span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{avgScore}</TableCell>
                  <TableCell>
                    {suspiciousCount > 0 ? (
                      <Badge variant="destructive" className="text-xs">
                        {suspiciousCount} suspicious
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        {user.riskLevel === "NORMAL" ? "Normal" : user.riskLevel}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/admin/annotators/${user.id}`}>
                      <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                        {t(locale, "admin.annotators.detail")} →
                      </Badge>
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
