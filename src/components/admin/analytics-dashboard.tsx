"use client";

import { useState, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";
import { buildModelColorMap } from "@/lib/color-palette";

// ── Types ──

interface DimNode {
  code: string;
  nameZh: string;
  nameEn: string;
  children: DimNode[];
}

type AggEntry = { avg: number; count: number; sd: number; dist: number[] };
type AggData = Record<string, Record<string, AggEntry>>;

interface Props {
  dimensionTree: DimNode[];
  aggregated: AggData;
  models: string[];
  totalScores: number;
  totalCompleted: number;
}

// ── Helpers ──

function dimLabel(node: DimNode, locale: string) {
  return locale === "zh" ? node.nameZh : (node.nameEn || node.code);
}

function scoreColor(avg: number): string {
  if (avg >= 4.0) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (avg >= 3.0) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  if (avg >= 2.0) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  if (avg > 0) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  return "text-muted-foreground";
}

// ── Custom Tooltip ──

function StatTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  const { t } = useLocale();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-xs max-w-[240px]">
      <div className="font-semibold mb-1.5 text-popover-foreground">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-1.5 mb-0.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="font-medium">{entry.name}:</span>
          <span>{entry.value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──

export function AnalyticsDashboard({ dimensionTree, aggregated, models, totalScores, totalCompleted }: Props) {
  const { locale, t } = useLocale();
  const colorMap = useMemo(() => buildModelColorMap(models), [models]);

  // Model filter
  const [selectedModels, setSelectedModels] = useState<Set<string>>(() => new Set(models));
  const toggleModel = useCallback((m: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(m)) { if (next.size > 1) next.delete(m); }
      else next.add(m);
      return next;
    });
  }, []);
  const activeModels = useMemo(() => models.filter((m) => selectedModels.has(m)), [models, selectedModels]);

  // Drill-down path: array of dim codes [D1, D1.1, ...]
  const [drillPath, setDrillPath] = useState<string[]>([]);

  // Resolve current level nodes
  const currentNodes = useMemo(() => {
    let nodes = dimensionTree;
    for (const code of drillPath) {
      const found = nodes.find((n) => n.code === code);
      if (found) nodes = found.children;
      else break;
    }
    return nodes;
  }, [dimensionTree, drillPath]);

  // Breadcrumb items
  const breadcrumbs = useMemo(() => {
    const items: { label: string; path: string[] }[] = [
      { label: locale === "zh" ? "全部维度" : "All Dimensions", path: [] },
    ];
    let nodes = dimensionTree;
    for (let i = 0; i < drillPath.length; i++) {
      const found = nodes.find((n) => n.code === drillPath[i]);
      if (found) {
        items.push({ label: dimLabel(found, locale), path: drillPath.slice(0, i + 1) });
        nodes = found.children;
      }
    }
    return items;
  }, [dimensionTree, drillPath, locale]);

  // Chart data for current level
  const chartData = useMemo(() => {
    return currentNodes.map((node) => {
      const entry: Record<string, string | number> = {
        code: node.code,
        name: dimLabel(node, locale),
        hasChildren: node.children.length > 0 ? 1 : 0,
      };
      for (const m of activeModels) {
        const agg = aggregated[node.code]?.[m];
        entry[m] = agg?.avg ?? 0;
        entry[`__n__${m}`] = agg?.count ?? 0;
        entry[`__sd__${m}`] = agg?.sd ?? 0;
      }
      return entry;
    });
  }, [currentNodes, activeModels, aggregated, locale]);

  // Radar data (only at L1 level)
  const radarData = useMemo(() => {
    return dimensionTree.map((node) => {
      const entry: Record<string, string | number> = {
        dimension: node.code,
        name: dimLabel(node, locale),
      };
      for (const m of activeModels) {
        entry[m] = aggregated[node.code]?.[m]?.avg ?? 0;
      }
      return entry;
    });
  }, [dimensionTree, activeModels, aggregated, locale]);

  // Model overall stats
  const modelOverall = useMemo(() => {
    return activeModels.map((m) => {
      // Weighted average across L1 dimensions
      let totalWeight = 0;
      let totalCount = 0;
      for (const node of dimensionTree) {
        const agg = aggregated[node.code]?.[m];
        if (agg) {
          totalWeight += agg.avg * agg.count;
          totalCount += agg.count;
        }
      }
      return {
        model: m,
        avg: totalCount > 0 ? Math.round((totalWeight / totalCount) * 100) / 100 : 0,
        count: totalCount,
      };
    });
  }, [activeModels, dimensionTree, aggregated]);

  // Drill-down handler
  const drillInto = useCallback((code: string) => {
    const node = currentNodes.find((n) => n.code === code);
    if (node && node.children.length > 0) {
      setDrillPath((prev) => [...prev, code]);
    }
  }, [currentNodes]);

  // Flatten the full dimension tree into rows with L1/L2/L3 columns
  const flattenedRows = useMemo(() => {
    const rows: { l1: string; l2: string; l3: string; code: string }[] = [];
    const label = (n: DimNode) => dimLabel(n, locale);
    for (const l1 of dimensionTree) {
      if (l1.children.length === 0) {
        // L1 is a leaf
        rows.push({ l1: label(l1), l2: "", l3: "", code: l1.code });
      } else {
        for (const l2 of l1.children) {
          if (l2.children.length === 0) {
            // L2 is a leaf
            rows.push({ l1: label(l1), l2: label(l2), l3: "", code: l2.code });
          } else {
            for (const l3 of l2.children) {
              rows.push({ l1: label(l1), l2: label(l2), l3: label(l3), code: l3.code });
            }
          }
        }
      }
    }
    return rows;
  }, [dimensionTree, locale]);

  // Export CSV with L1/L2/L3 columns
  const exportCsv = useCallback(() => {
    const l1H = locale === "zh" ? "一级维度" : "L1 Dimension";
    const l2H = locale === "zh" ? "二级维度" : "L2 Dimension";
    const l3H = locale === "zh" ? "三级维度" : "L3 Dimension";
    const header = [l1H, l2H, l3H, ...activeModels.flatMap((m) => [`${m}_Avg`, `${m}_N`, `${m}_SD`])];
    const rows = flattenedRows.map((r) => [
      r.l1, r.l2, r.l3,
      ...activeModels.flatMap((m) => {
        const agg = aggregated[r.code]?.[m];
        return [
          String(agg?.avg ?? ""),
          String(agg?.count ?? ""),
          String(agg?.sd ?? ""),
        ];
      }),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_full_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [flattenedRows, activeModels, aggregated, locale]);

  // Export XLSX with L1/L2/L3 columns and styling
  const exportXlsx = useCallback(async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Analytics");

    const l1H = locale === "zh" ? "一级维度" : "L1 Dimension";
    const l2H = locale === "zh" ? "二级维度" : "L2 Dimension";
    const l3H = locale === "zh" ? "三级维度" : "L3 Dimension";
    const header = [l1H, l2H, l3H, ...activeModels.flatMap((m) => [`${m}_Avg`, `${m}_N`, `${m}_SD`])];
    const headerRow = ws.addRow(header);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.border = { bottom: { style: "thin" } };
    });

    for (const r of flattenedRows) {
      const values: (string | number)[] = [r.l1, r.l2, r.l3];
      for (const m of activeModels) {
        const agg = aggregated[r.code]?.[m];
        values.push(agg?.avg ?? 0, agg?.count ?? 0, agg?.sd ?? 0);
      }
      ws.addRow(values);
    }

    // Auto-fit column widths
    ws.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 30);
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_full_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [flattenedRows, activeModels, aggregated, locale]);

  // Score distribution for selected dimension (drill-down leaf level)
  const distData = useMemo(() => {
    if (currentNodes.length === 0) return null;
    // If we're at a specific node, show its distribution
    const targetCode = drillPath.length > 0 ? drillPath[drillPath.length - 1] : null;
    if (!targetCode) return null;
    const data = aggregated[targetCode];
    if (!data) return null;
    return [1, 2, 3, 4, 5].map((score) => {
      const entry: Record<string, string | number> = { score: String(score) };
      for (const m of activeModels) {
        entry[m] = data[m]?.dist?.[score - 1] ?? 0;
      }
      return entry;
    });
  }, [drillPath, aggregated, activeModels, currentNodes]);

  return (
    <div className="space-y-4">
      {/* ── Summary Cards ── */}
      <div className="grid gap-3 sm:grid-cols-4">
        {modelOverall.map((mo) => (
          <Card key={mo.model}>
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{mo.model}</p>
                  <p className="text-2xl font-bold" style={{ color: colorMap[mo.model] }}>
                    {mo.avg.toFixed(2)}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{mo.count} {locale === "zh" ? "条评分" : "scores"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">{t("admin.analytics.completedEvals")}</p>
            <p className="text-2xl font-bold">{totalCompleted}</p>
            <p className="text-xs text-muted-foreground">{totalScores} {locale === "zh" ? "条有效评分" : "valid scores"}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Model Filter + Export ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("admin.analytics.filterModels")}
        </span>
        {models.map((m) => {
          const sel = selectedModels.has(m);
          return (
            <button
              key={m}
              onClick={() => toggleModel(m)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                sel ? "border-transparent text-white" : "border-border text-muted-foreground hover:bg-muted"
              }`}
              style={sel ? { backgroundColor: colorMap[m] } : undefined}
            >
              {m}
            </button>
          );
        })}
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={exportCsv}>
            CSV
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={exportXlsx}>
            XLSX
          </Button>
        </div>
      </div>

      {/* ── Radar (L1 overview, always visible) ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{locale === "zh" ? "维度能力雷达图" : "Dimension Radar"}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 9 }} />
                {activeModels.map((m) => (
                  <Radar key={m} name={m} dataKey={m}
                    stroke={colorMap[m]} fill={colorMap[m]} fillOpacity={0.12} />
                ))}
                <Tooltip content={<StatTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Score distribution (when drilled into a specific dimension) */}
        {distData ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {breadcrumbs[breadcrumbs.length - 1]?.label} {locale === "zh" ? "分数分布" : "Score Distribution"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={distData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="score" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {activeModels.map((m) => (
                    <Bar key={m} dataKey={m} fill={colorMap[m]} radius={[3, 3, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{locale === "zh" ? "模型综合得分" : "Model Overall Scores"}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={modelOverall} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="model" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip />
                  <Bar dataKey="avg" radius={[0, 4, 4, 0]}>
                    {modelOverall.map((entry) => (
                      <Cell key={entry.model} fill={colorMap[entry.model] ?? "#6366f1"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Breadcrumb Navigation ── */}
      <nav className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((bc, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground">/</span>}
            {i < breadcrumbs.length - 1 ? (
              <button
                onClick={() => setDrillPath(bc.path)}
                className="text-primary hover:underline"
              >
                {bc.label}
              </button>
            ) : (
              <span className="font-medium">{bc.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* ── Drill-down Bar Chart ── */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {breadcrumbs[breadcrumbs.length - 1]?.label} {locale === "zh" ? "各维度得分对比" : "Dimension Score Comparison"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 36)}>
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={180} />
                <Tooltip content={<StatTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {activeModels.map((m) => (
                  <Bar key={m} dataKey={m} fill={colorMap[m]} radius={[0, 3, 3, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Heatmap Table with drill-down ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {locale === "zh" ? "维度得分明细" : "Dimension Score Detail"}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {locale === "zh" ? "点击维度名称可下钻" : "Click dimension to drill down"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {locale === "zh" ? "维度" : "Dimension"}
                  </th>
                  {activeModels.map((m) => (
                    <th key={m} className="px-3 py-2 text-center text-xs font-medium" style={{ color: colorMap[m] }}>
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentNodes.map((node) => {
                  const hasKids = node.children.length > 0;
                  return (
                    <tr key={node.code} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-3 py-2">
                        {hasKids ? (
                          <button
                            onClick={() => drillInto(node.code)}
                            className="text-left font-medium text-primary hover:underline flex items-center gap-1"
                          >
                            {dimLabel(node, locale)}
                            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        ) : (
                          <span className="font-medium">{dimLabel(node, locale)}</span>
                        )}
                        <span className="ml-1.5 text-[10px] text-muted-foreground">{node.code}</span>
                      </td>
                      {activeModels.map((m) => {
                        const agg = aggregated[node.code]?.[m];
                        if (!agg || agg.count === 0) {
                          return <td key={m} className="px-3 py-2 text-center text-muted-foreground">-</td>;
                        }
                        return (
                          <td key={m} className="px-3 py-2 text-center">
                            <span className={`inline-block rounded px-2 py-0.5 text-xs font-mono tabular-nums font-medium ${scoreColor(agg.avg)}`}>
                              {agg.avg.toFixed(2)}
                            </span>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              N={agg.count} σ={agg.sd.toFixed(2)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
