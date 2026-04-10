"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";

interface TaskItem {
  id: string;
  status: string;
  promptZh: string;
  promptEn: string;
  modelName: string;
  taskType: string;
}

interface Props {
  items: TaskItem[];
}

const STATUS_KEYS: Record<string, { labelKey: TranslationKey; variant: "default" | "secondary" | "outline" }> = {
  PENDING: { labelKey: "common.pending", variant: "outline" },
  IN_PROGRESS: { labelKey: "common.inProgress", variant: "secondary" },
  COMPLETED: { labelKey: "common.completed", variant: "default" },
  EXPIRED: { labelKey: "common.expired", variant: "outline" },
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100, 200];

export function TaskListClient({ items }: Props) {
  const { locale, t } = useLocale();
  const [hideCompleted, setHideCompleted] = useState(true);
  const [filterType, setFilterType] = useState<string>("ALL");
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let result = items;
    if (hideCompleted) {
      result = result.filter((i) => i.status !== "COMPLETED");
    }
    if (filterType !== "ALL") {
      result = result.filter((i) => i.taskType === filterType);
    }
    return result;
  }, [items, hideCompleted, filterType]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  const handleFilterChange = (type: string) => {
    setFilterType(type);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["ALL", "T2V", "I2V"].map((type) => (
          <Button
            key={type}
            variant={filterType === type ? "default" : "outline"}
            size="sm"
            onClick={() => handleFilterChange(type)}
          >
            {type === "ALL" ? t("common.all") : (
              <span className="flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-full ${type === "T2V" ? "bg-blue-500" : "bg-emerald-500"}`} />
                {type}
              </span>
            )}
          </Button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={hideCompleted ? "default" : "outline"}
            size="sm"
            onClick={() => { setHideCompleted((prev) => !prev); setPage(1); }}
          >
            {hideCompleted ? t("common.showCompleted") : t("common.hideCompleted")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3">
        {paged.map((item) => {
          const badge = STATUS_KEYS[item.status] ?? STATUS_KEYS.PENDING;
          return (
            <Card key={item.id}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium">
                    {locale === "zh" ? item.promptZh : item.promptEn}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {item.modelName} · {locale === "zh" ? item.promptEn : item.promptZh}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      item.taskType === "T2V"
                        ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                        : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                    }
                  >
                    {item.taskType}
                  </Badge>
                  <Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>
                  {item.status !== "COMPLETED" && (
                    <Link href={`/workstation/${item.id}`}>
                      <Button size="sm">{t("tasks.startEval")}</Button>
                    </Link>
                  )}
                </div>
              </CardHeader>
            </Card>
          );
        })}

        {paged.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t("tasks.noTasks")}
            </CardContent>
          </Card>
        )}
      </div>

      {filtered.length > 0 && (
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

          <span className="text-sm text-muted-foreground">
            {safePage}/{totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              {t("common.prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
            >
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
