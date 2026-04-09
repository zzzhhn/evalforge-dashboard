"use client";

import { useState, useMemo } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

import {
  T2V_MODELS,
  CATEGORIES,
  CATEGORY_COLORS,
  dimsByCategory,
  VBENCH_DIMENSIONS,
  DIMENSION_NAMES,
  VBENCH_GUIDE,
  GRADE_COLORS,
  METRIC_NOTES,
  gradeMetric,
  getScore,
  pairwiseWins,
  totalPairwiseWins,
  metricNormalized,
} from "@/data/vbench";

/* ──────────────────────────────────────────────────────────────────
   EvalForge Video Evaluation Dashboard

   Based on VBench 2.0 (arXiv 2503.21755, Mar 2025):
     - 18 dimensions across 5 categories:
       Human Fidelity (3), Creativity (2), Controllability (7),
       Physics (4), Commonsense (2)
     - Official ranking via pairwise win ratios (no aggregate score)
   ────────────────────────────────────────────────────────────────── */

export default function EvalVideoDashboard() {
  const [showGuide, setShowGuide] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set(["Sora-480p", "Kling 1.6"])
  );
  const [detailModel, setDetailModel] = useState<string>("Sora-480p");

  const toggleModel = (name: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        if (next.size > 1) next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  /* ── Pairwise Win-Rate Matrix ── */
  const winMatrix = useMemo(() => {
    return T2V_MODELS.map((a) => ({
      model: a,
      wins: T2V_MODELS.map((b) =>
        a.name === b.name ? null : pairwiseWins(a, b)
      ),
      total: totalPairwiseWins(a, T2V_MODELS),
    }));
  }, []);

  const winRanking = useMemo(
    () => [...winMatrix].sort((a, b) => b.total - a.total),
    [winMatrix]
  );

  /* ── Per-Metric Percentile Radar ── */
  const radarData = useMemo(
    () =>
      DIMENSION_NAMES.map((dim) => {
        const entry: Record<string, string | number> = { dimension: dim };
        T2V_MODELS.forEach((m) => {
          if (selectedModels.has(m.name)) {
            entry[m.name] = Math.round(
              metricNormalized(m, dim, T2V_MODELS)
            );
          }
        });
        return entry;
      }),
    [selectedModels]
  );

  /* ── Detail view: raw scores grouped by 5 categories ── */
  const detail =
    T2V_MODELS.find((m) => m.name === detailModel) ?? T2V_MODELS[0];

  const categoryMetrics = useMemo(
    () =>
      CATEGORIES.map((cat) => ({
        category: cat,
        color: CATEGORY_COLORS[cat],
        dims: dimsByCategory(cat).map((d) => ({
          dim: d,
          score: getScore(detail, d.name),
        })),
      })),
    [detail]
  );

  return (
    <div className="eval-dashboard">
      {/* VBench taxonomy guide */}
      <button
        className="eval-guide-toggle"
        onClick={() => setShowGuide((v) => !v)}
        aria-expanded={showGuide}
      >
        <span
          className={`eval-guide-toggle-icon ${showGuide ? "eval-guide-toggle-icon--open" : ""}`}
        >
          {"\u25b6"}
        </span>
        Understanding the VBench 2.0 Taxonomy
      </button>
      {showGuide && <GuideSection />}

      {/* Model selector chips */}
      <div className="eval-model-selector">
        {T2V_MODELS.map((m) => (
          <button
            key={m.name}
            aria-pressed={selectedModels.has(m.name)}
            className={`eval-chip ${selectedModels.has(m.name) ? "eval-chip--active" : ""}`}
            onClick={() => toggleModel(m.name)}
            style={
              selectedModels.has(m.name)
                ? { borderColor: m.color, background: `${m.color}18` }
                : undefined
            }
          >
            <span
              className="eval-chip-dot"
              style={{ background: m.color }}
            />
            {m.name}
          </button>
        ))}
      </div>

      {/* Pairwise Win-Rate Matrix */}
      <WinRateMatrix
        winMatrix={winMatrix}
        winRanking={winRanking}
      />

      {/* Per-Metric Percentile Radar */}
      <div className="eval-card">
        <h3 className="eval-card-title">
          Per-Metric Normalized Radar
        </h3>
        <p className="eval-card-subtitle">
          Min-max normalized scores per dimension (best model = 100,
          worst = 0). Since raw score ranges vary widely across the
          18 dimensions (e.g. Dynamic Attribute ~8% to Human Clothes
          ~98%), normalization lets you compare relative spread at a
          glance.
        </p>
        <ResponsiveContainer width="100%" height={420}>
          <RadarChart
            data={radarData}
            cx="50%"
            cy="50%"
            outerRadius="68%"
          >
            <PolarGrid stroke="var(--color-border-subtle)" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{
                fill: "var(--color-text-secondary)",
                fontSize: 10,
              }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{
                fill: "var(--color-text-tertiary)",
                fontSize: 9,
              }}
              tickCount={5}
            />
            {T2V_MODELS.filter((m) => selectedModels.has(m.name)).map(
              (m) => (
                <Radar
                  key={m.name}
                  name={m.name}
                  dataKey={m.name}
                  stroke={m.color}
                  fill={m.color}
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
              )
            )}
            <Legend
              wrapperStyle={{
                fontSize: 12,
                color: "var(--color-text-secondary)",
              }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: unknown) =>
                [`${Math.round(Number(value))}/100`, "Normalized"] as [string, string]
              }
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Full 18-metric table */}
      <div className="eval-card">
        <h3 className="eval-card-title">
          Raw VBench 2.0 Scores (18 Dimensions)
        </h3>
        <p className="eval-card-subtitle">
          Grades are relative to the empirical distribution across all
          evaluated models. Score ranges vary widely — from ~8% (Dynamic
          Attribute) to ~98% (Human Clothes) — reflecting the diverse
          difficulty of intrinsic faithfulness dimensions.
        </p>
        <div className="eval-detail-tabs">
          {T2V_MODELS.map((m) => (
            <button
              key={m.name}
              className={`eval-tab ${detailModel === m.name ? "eval-tab--active" : ""}`}
              onClick={() => setDetailModel(m.name)}
            >
              {m.name}
              <span className="eval-tab-info">
                {m.resolution} · {m.videoLength} · {m.fps}fps
              </span>
            </button>
          ))}
        </div>
        <div className="eval-table-wrap">
          <table className="eval-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Evaluator</th>
                <th>Score (%)</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {categoryMetrics.map(({ category, color, dims }) => (
                <CategorySection
                  key={category}
                  category={category}
                  color={color}
                  dims={dims}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Sub-components (extracted for file-size control)
   ──────────────────────────────────────────────── */

function CategorySection({
  category,
  color,
  dims,
}: {
  category: string;
  color: string;
  dims: ReadonlyArray<{ dim: { name: string; evaluator: string }; score: number }>;
}) {
  return (
    <>
      <tr className="eval-table-section-header">
        <td colSpan={4}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: color,
              marginRight: 8,
              verticalAlign: "middle",
            }}
          />
          {category} — {dims.length} dimension{dims.length !== 1 ? "s" : ""}
        </td>
      </tr>
      {dims.map(({ dim, score }) => (
        <MetricRow
          key={dim.name}
          name={dim.name}
          evaluator={dim.evaluator}
          score={score}
        />
      ))}
    </>
  );
}

function MetricRow({
  name,
  evaluator,
  score,
}: {
  name: string;
  evaluator: string;
  score: number;
}) {
  const grade = gradeMetric(name, score);
  const note = METRIC_NOTES[name];
  return (
    <tr title={note ?? ""}>
      <td className="eval-metric-name">
        {name}
        {note && <span className="eval-metric-hint"> {"\u24d8"}</span>}
      </td>
      <td className="eval-metric-dim">{evaluator}</td>
      <td className="eval-metric-score">{score.toFixed(1)}</td>
      <td>
        <span
          className="eval-grade"
          style={{
            color: GRADE_COLORS[grade],
            background: `${GRADE_COLORS[grade]}18`,
          }}
        >
          {grade}
        </span>
      </td>
    </tr>
  );
}

interface WinMatrixEntry {
  model: { name: string; color: string };
  wins: (number | null)[];
  total: number;
}

function WinRateMatrix({
  winMatrix,
  winRanking,
}: {
  winMatrix: WinMatrixEntry[];
  winRanking: WinMatrixEntry[];
}) {
  return (
    <div className="eval-card">
      <h3 className="eval-card-title">Pairwise Win-Rate Matrix</h3>
      <p className="eval-card-subtitle">
        VBench 2.0 ranking protocol: for each model pair, count how
        many of the 18 dimensions model A beats model B. Cell value =
        number of dimensions won by the row model against the column
        model (out of 18).
      </p>
      <div className="eval-table-wrap">
        <table className="eval-table eval-table--matrix">
          <caption className="sr-only">
            Pairwise win-rate matrix: rows are challenger models, columns are
            opponent models. Each cell shows how many of the 18 VBench 2.0
            dimensions the row model beats the column model.
          </caption>
          <thead>
            <tr>
              <th scope="col">vs.</th>
              {T2V_MODELS.map((m) => (
                <th key={m.name} scope="col" style={{ color: m.color }}>
                  {m.name}
                </th>
              ))}
              <th scope="col">Total Wins</th>
            </tr>
          </thead>
          <tbody>
            {winMatrix.map((row) => (
              <tr key={row.model.name}>
                <th
                  scope="row"
                  className="eval-metric-name"
                  style={{ color: row.model.color }}
                >
                  {row.model.name}
                </th>
                {row.wins.map((w, ci) => (
                  <td
                    key={T2V_MODELS[ci].name}
                    className={`eval-matrix-cell ${
                      w === null
                        ? "eval-matrix-cell--self"
                        : w > 9
                          ? "eval-matrix-cell--win"
                          : w < 9
                            ? "eval-matrix-cell--loss"
                            : "eval-matrix-cell--tie"
                    }`}
                  >
                    {w === null ? "\u2014" : w}
                  </td>
                ))}
                <td className="eval-metric-score eval-matrix-total">
                  {row.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="eval-winrate-ranking">
        <span className="eval-winrate-ranking-label">
          Pairwise ranking:
        </span>
        {winRanking.map((entry, i) => (
          <span key={entry.model.name} className="eval-winrate-rank-item">
            <span className="eval-winrate-rank-pos">#{i + 1}</span>
            <span
              className="eval-chip-dot"
              style={{
                background: entry.model.color,
                display: "inline-block",
                marginRight: 4,
                verticalAlign: "middle",
              }}
            />
            {entry.model.name}
            <span className="eval-winrate-rank-score">
              ({entry.total} wins)
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function GuideSection() {
  return (
    <div className="eval-guide">
      <p className="eval-guide-rationale">{VBENCH_GUIDE.rationale}</p>
      {VBENCH_GUIDE.categories.map((cat) => (
        <div key={cat.name}>
          <div
            className="eval-guide-section-label"
            style={{ borderLeftColor: cat.color }}
          >
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: cat.color,
                marginRight: 8,
                verticalAlign: "middle",
              }}
            />
            {cat.name} — {cat.dims.length} dimension{cat.dims.length !== 1 ? "s" : ""}
          </div>
          <div className="eval-guide-grid">
            {cat.dims.map((m) => (
              <div key={m.name} className="eval-guide-item">
                <div className="eval-guide-item-name">
                  {m.name}
                  <span className="eval-guide-evaluator">
                    {m.evaluator}
                  </span>
                </div>
                <div className="eval-guide-item-desc">{m.desc}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
