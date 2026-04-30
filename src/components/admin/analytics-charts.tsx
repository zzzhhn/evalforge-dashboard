"use client";

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";
import { buildModelColorMap } from "@/lib/color-palette";
import type { Locale } from "@/lib/i18n/translations";

interface Props {
  chartData: Record<string, string | number>[];
  modelOverall: { model: string; avg: number; count: number }[];
  models: string[];
  scoreDistribution?: Record<string, string | number>[];
  trendData?: Record<string, string | number>[];
  locale?: Locale;
}

/** Custom tooltip showing Avg, N, σ, 95% CI for each model series */
function StatTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; payload: Record<string, string | number> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-xs max-w-[220px]">
      <div className="font-semibold mb-1.5 text-popover-foreground">{label}</div>
      {payload.map((entry) => {
        const n = Number(entry.payload[`__n__${entry.name}`] ?? 0);
        const sd = Number(entry.payload[`__sd__${entry.name}`] ?? 0);
        const ci = n > 1 ? 1.96 * sd / Math.sqrt(n) : 0;
        const avg = entry.value;
        return (
          <div key={entry.name} className="mb-1 last:mb-0">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="font-medium text-popover-foreground">{entry.name}</span>
            </div>
            <div className="ml-3.5 text-muted-foreground leading-relaxed">
              Avg: {avg.toFixed(2)} (N={n}, σ={sd.toFixed(2)})
              {n > 1 && (
                <div>CI: [{(avg - ci).toFixed(2)}, {(avg + ci).toFixed(2)}]</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AnalyticsCharts({ chartData, modelOverall, models, scoreDistribution, trendData }: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Color map is stable across all models (selected or not) to keep colors consistent
  const colorMap = useMemo(() => buildModelColorMap(models), [models]);

  // Parse selected models from URL params (default: all selected)
  const selectedModels = useMemo(() => {
    const param = searchParams.get("models");
    if (!param) return new Set(models);
    const parsed = param.split(",").filter((m) => models.includes(m));
    return parsed.length > 0 ? new Set(parsed) : new Set(models);
  }, [searchParams, models]);

  const toggleModel = useCallback(
    (model: string) => {
      const next = new Set(selectedModels);
      if (next.has(model)) {
        if (next.size > 1) next.delete(model); // don't allow empty selection
      } else {
        next.add(model);
      }
      const params = new URLSearchParams(searchParams.toString());
      if (next.size === models.length) {
        params.delete("models"); // all selected = default
      } else {
        params.set("models", [...next].join(","));
      }
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [selectedModels, models, router, searchParams]
  );

  const selectAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("models");
    router.push(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Filtered data
  const activeModels = useMemo(
    () => models.filter((m) => selectedModels.has(m)),
    [models, selectedModels]
  );

  const filteredOverall = useMemo(
    () => modelOverall.filter((m) => selectedModels.has(m.model)),
    [modelOverall, selectedModels]
  );

  // Sortable dimension breakdown table state
  const [sortCol, setSortCol] = useState<string>("dimension");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sortedChartData = useMemo(() => {
    const rows = [...chartData];
    rows.sort((a, b) => {
      const aVal = sortCol === "dimension" ? String(a.name ?? a.dimension) : Number(a[sortCol] ?? 0);
      const bVal = sortCol === "dimension" ? String(b.name ?? b.dimension) : Number(b[sortCol] ?? 0);
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal, undefined, { numeric: true })
          : bVal.localeCompare(aVal, undefined, { numeric: true });
      }
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return rows;
  }, [chartData, sortCol, sortDir]);

  const toggleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => d === "asc" ? "desc" : "asc");
        return col;
      }
      setSortDir(col === "dimension" ? "asc" : "desc");
      return col;
    });
  }, []);

  // Chart container ref for PNG export
  const chartsRef = useRef<HTMLDivElement>(null);

  const exportCsv = useCallback(() => {
    const header = [t("admin.analytics.dimensionLabel"), ...activeModels];
    const rows = chartData.map((row) => [
      String(row.name ?? row.dimension),
      ...activeModels.map((m) => String(row[m] ?? "")),
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_${activeModels.join("-")}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chartData, activeModels, t]);

  const exportPng = useCallback(() => {
    const container = chartsRef.current;
    if (!container) return;
    const svg = container.querySelector("svg");
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const rect = svg.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(2, 2);

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `chart_${activeModels.join("-")}_${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  }, [activeModels]);

  if (models.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("admin.analytics.noData")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
              {t("admin.analytics.filterModels")}
            </span>
            <div className="flex gap-1.5 flex-wrap">
              {models.map((model) => {
                const isSelected = selectedModels.has(model);
                return (
                  <button
                    key={model}
                    onClick={() => toggleModel(model)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      isSelected
                        ? "border-transparent text-white"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                    style={isSelected ? { backgroundColor: colorMap[model] } : undefined}
                  >
                    {!isSelected && (
                      <span
                        className="inline-block h-2 w-2 rounded-full opacity-40"
                        style={{ backgroundColor: colorMap[model] }}
                      />
                    )}
                    {model}
                  </button>
                );
              })}
            </div>
            {selectedModels.size < models.length && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={selectAll}>
                {t("admin.analytics.selectAll")}
              </Button>
            )}
            <div className="ml-auto flex gap-1.5">
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={exportCsv}>
                {t("admin.analytics.exportCsv")}
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={exportPng}>
                {t("admin.analytics.exportPng")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div ref={chartsRef} className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.analytics.modelRanking")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height="100%" minHeight={200} className="!h-[max(250px,30vh)]">
              <BarChart data={filteredOverall}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="model" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 5]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                  {filteredOverall.map((entry) => (
                    <Cell key={entry.model} fill={colorMap[entry.model] ?? "#6366f1"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.analytics.radarChart")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height="100%" minHeight={200} className="!h-[max(250px,30vh)]">
              <RadarChart data={chartData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 10 }} />
                {activeModels.map((model) => (
                  <Radar
                    key={model}
                    name={model}
                    dataKey={model}
                    stroke={colorMap[model]}
                    fill={colorMap[model]}
                    fillOpacity={0.15}
                  />
                ))}
                <Tooltip content={<StatTooltip />} />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("admin.analytics.dimensionCompare")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height="100%" minHeight={250} className="!h-[max(300px,35vh)]">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 5]} tick={{ fontSize: 12 }} />
                <Tooltip content={<StatTooltip />} />
                <Legend />
                {activeModels.map((model) => (
                  <Bar
                    key={model}
                    dataKey={model}
                    fill={colorMap[model]}
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {scoreDistribution && scoreDistribution.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{t("admin.analytics.scoreDistribution")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height="100%" minHeight={250} className="!h-[max(300px,35vh)]">
                <BarChart data={scoreDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="score"
                    tick={{ fontSize: 12 }}
                    label={{ value: t("admin.analytics.scoreLabel"), position: "insideBottom", offset: -2, fontSize: 11 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} label={{ value: t("admin.analytics.countLabel"), angle: -90, position: "insideLeft", fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  {activeModels.map((model) => (
                    <Bar
                      key={model}
                      dataKey={model}
                      fill={colorMap[model]}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {trendData && trendData.length > 1 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{t("admin.analytics.trendChart")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height="100%" minHeight={250} className="!h-[max(300px,35vh)]">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 5]} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  {activeModels.map((model) => (
                    <Line
                      key={model}
                      type="monotone"
                      dataKey={model}
                      stroke={colorMap[model]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dimension Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("admin.analytics.dimensionBreakdown")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th
                    className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort("dimension")}
                  >
                    {t("admin.analytics.dimensionLabel")}
                    {sortCol === "dimension" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </th>
                  {activeModels.map((model) => (
                    <th
                      key={model}
                      className="px-3 py-2 text-right text-xs font-medium cursor-pointer hover:text-foreground"
                      style={{ color: colorMap[model] }}
                      onClick={() => toggleSort(model)}
                    >
                      {model}
                      {sortCol === model && (sortDir === "asc" ? " ↑" : " ↓")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedChartData.map((row) => (
                  <tr key={String(row.dimension)} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2 font-medium">{String(row.name ?? row.dimension)}</td>
                    {activeModels.map((model) => {
                      const val = Number(row[model] ?? 0);
                      return (
                        <td key={model} className="px-3 py-2 text-right font-mono tabular-nums">
                          <span
                            className="inline-block rounded px-1.5 py-0.5 text-xs"
                            style={{
                              backgroundColor: val > 0 ? `${colorMap[model]}15` : undefined,
                              color: val > 0 ? colorMap[model] : undefined,
                            }}
                          >
                            {val > 0 ? val.toFixed(2) : "-"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
