"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/context";

interface AssetData {
  id: string;
  promptZh: string;
  promptEn: string;
  externalId: string; // prompt.id used as display identifier
  modelName: string;
  taskType: string;
  durationSec: number | null;
  completedItems: number;
  totalItems: number;
}

interface Props {
  assets: AssetData[];
}

const PER_PAGE_OPTIONS = [10, 20, 50, 100, 200];

export function PackageDetailClient({ assets }: Props) {
  const { locale, t } = useLocale();
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(assets.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paged = assets.slice((safePage - 1) * perPage, safePage * perPage);

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead>{t("admin.samples.prompt")}</TableHead>
              <TableHead>{t("admin.samples.model")}</TableHead>
              <TableHead>{t("admin.samples.duration")}</TableHead>
              <TableHead>{t("admin.samples.evalProgress")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((asset) => {
              const primary = locale === "zh" ? asset.promptZh : asset.promptEn;
              const secondary = locale === "zh" ? asset.promptEn : asset.promptZh;
              return (
                <TableRow key={asset.id} className="cursor-pointer hover:bg-accent/50">
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {asset.externalId}
                  </TableCell>
                  <TableCell className="max-w-sm">
                    <Link href={`/admin/samples/${asset.id}`} className="block">
                      <p className="text-sm font-medium truncate">{primary}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{secondary}</p>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{asset.modelName}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {asset.durationSec ? `${asset.durationSec}s` : "-"}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {asset.completedItems}/{asset.totalItems}
                    </span>
                    {asset.completedItems === asset.totalItems && asset.totalItems > 0 && (
                      <Badge variant="default" className="ml-2">
                        {t("admin.samples.done")}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {assets.length > 0 && (
        <div className="flex items-center justify-end gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("common.perPage")}</span>
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="rounded-md border bg-card px-2 py-1 text-sm"
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} {t("common.items")}</option>
              ))}
            </select>
          </div>
          <span className="text-sm text-muted-foreground">{safePage}/{totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
              {t("common.prev")}
            </Button>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
