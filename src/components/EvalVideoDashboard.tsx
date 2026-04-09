"use client";

import { useState, useMemo } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

import {
  T2V_MODELS,
  I2V_MODELS,
  VBENCH_DIMENSIONS,
  VQ_DIMENSIONS,
  VCC_DIMENSIONS,
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

   Based on VBench 1.0 (CVPR 2024):
     - 16 dimensions: 7 Video Quality + 9 Video-Condition Consistency
     - Official ranking via pairwise win ratios (no aggregate score)
   VBench++ (TPAMI 2025): I2V + Camera Motion track.
   ────────────────────────────────────────────────────────────────── */

export default function EvalVideoDashboard() {
  const [activeTrack, setActiveTrack] = useState<"t2v" | "i2v">("t2v");
  const [showGuide, setShowGuide] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set(["Veo 3.1", "Kling 2.6 Pro"])
  );
  const [detailModel, setDetailModel] = useState<string>("Veo 3.1");

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

  /* ── Detail view: raw scores by category ── */
  const detail =
    T2V_MODELS.find((m) => m.name === detailModel) ?? T2V_MODELS[0];

  const vqMetrics = useMemo(
    () => VQ_DIMENSIONS.map((d) => ({ dim: d, score: getScore(detail, d.name) })),
    [detail]
  );
  const vccMetrics = useMemo(
    () => VCC_DIMENSIONS.map((d) => ({ dim: d, score: getScore(detail, d.name) })),
    [detail]
  );

  return (
    <div className="eval-dashboard">
      {/* Track selector */}
      <div className="eval-track-selector">
        {(["t2v", "i2v"] as const).map((track) => (
          <button
            key={track}
            className={`eval-track-btn ${activeTrack === track ? "eval-track-btn--active" : ""}`}
            onClick={() => setActiveTrack(track)}
          >
            {track === "t2v" ? "T2V Evaluation" : "I2V Evaluation"}
            <span className="eval-track-badge">
              {track === "t2v"
                ? "VBench 1.0 \u00b7 16 dims"
                : "VBench++ \u00b7 I2V + Camera"}
            </span>
          </button>
        ))}
      </div>

      {/* ── T2V Track ── */}
      {activeTrack === "t2v" && (
        <>
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
            Understanding the VBench Taxonomy
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
              worst = 0). Since raw score ranges vary widely (quality
              95-99%, stylistic 18-40%), normalization lets you compare
              relative spread across all 16 dimensions at a glance.
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

          {/* Full 16-metric table */}
          <div className="eval-card">
            <h3 className="eval-card-title">
              Raw VBench 1.0 Scores (16 Dimensions)
            </h3>
            <p className="eval-card-subtitle">
              Grades are tier-aware: quality metrics (SC/BGC/TF/MS) cluster
              at 95-99% by design; stylistic metrics (AS/TS/OC) are
              expected to score 20-40% across all current models. Hover a
              row for interpretation notes.
            </p>
            <div className="eval-detail-tabs">
              {T2V_MODELS.map((m) => (
                <button
                  key={m.name}
                  className={`eval-tab ${detailModel === m.name ? "eval-tab--active" : ""}`}
                  onClick={() => setDetailModel(m.name)}
                >
                  {m.name}
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
                  <tr className="eval-table-section-header">
                    <td colSpan={4}>
                      Video Quality — 7 dimensions (prompt-independent)
                    </td>
                  </tr>
                  {vqMetrics.map(({ dim, score }) => (
                    <MetricRow
                      key={dim.name}
                      name={dim.name}
                      evaluator={dim.evaluator}
                      score={score}
                    />
                  ))}
                  <tr className="eval-table-section-header">
                    <td colSpan={4}>
                      Video-Condition Consistency — 9 dimensions
                      (prompt-dependent)
                    </td>
                  </tr>
                  {vccMetrics.map(({ dim, score }) => (
                    <MetricRow
                      key={dim.name}
                      name={dim.name}
                      evaluator={dim.evaluator}
                      score={score}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── I2V Track (VBench++) ── */}
      {activeTrack === "i2v" && <I2VTrack />}
    </div>
  );
}

/* ────────────────────────────────────────────────
   Sub-components (extracted for file-size control)
   ──────────────────────────────────────────────── */

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
        {note && <span className="eval-metric-hint"> \u24d8</span>}
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
        VBench official ranking protocol: for each model pair, count
        how many of the 16 dimensions model A beats model B. Cell
        value = number of dimensions won by the row model against the
        column model (out of 16).
      </p>
      <div className="eval-table-wrap">
        <table className="eval-table eval-table--matrix">
          <caption className="sr-only">
            Pairwise win-rate matrix: rows are challenger models, columns are
            opponent models. Each cell shows how many of the 16 VBench
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
            {winMatrix.map((row, ri) => (
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
                        : w > 8
                          ? "eval-matrix-cell--win"
                          : w < 8
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
      <div className="eval-guide-section-label">
        Video Quality — 7 dimensions (prompt-independent)
      </div>
      <div className="eval-guide-grid">
        {VBENCH_GUIDE.vq.map((m) => (
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
      <div className="eval-guide-section-label">
        Video-Condition Consistency — 9 dimensions (prompt-dependent)
      </div>
      <div className="eval-guide-grid">
        {VBENCH_GUIDE.vcc.map((m) => (
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
  );
}

function I2VTrack() {
  return (
    <>
      <div className="eval-card">
        <h3 className="eval-card-title">
          I2V Subject & Background Preservation
        </h3>
        <p className="eval-card-subtitle">
          VBench++ I2V dimensions: Subject preservation measured with
          DINOv1 cosine similarity to reference image; Background
          preservation with DINOv2. Scores reflect how faithfully the
          model carries reference-image content across the generated
          video clip.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={I2V_MODELS.map((m) => ({
              name: m.name,
              "I2V Subject": m.i2vSubject,
              "I2V Background": m.i2vBackground,
            }))}
            margin={{ left: 10, right: 20, top: 10, bottom: 10 }}
          >
            <XAxis
              dataKey="name"
              tick={{
                fontSize: 11,
                fill: "var(--color-text-secondary)",
              }}
            />
            <YAxis
              domain={[70, 92]}
              tick={{
                fontSize: 10,
                fill: "var(--color-text-tertiary)",
              }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend
              wrapperStyle={{
                fontSize: 12,
                color: "var(--color-text-secondary)",
              }}
            />
            <Bar
              dataKey="I2V Subject"
              fill="#6366f1"
              fillOpacity={0.8}
              radius={[4, 4, 0, 0]}
              barSize={22}
            />
            <Bar
              dataKey="I2V Background"
              fill="#10b981"
              fillOpacity={0.8}
              radius={[4, 4, 0, 0]}
              barSize={22}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="eval-card">
        <h3 className="eval-card-title">
          Camera Motion Control (VBench++ CoTracker)
        </h3>
        <p className="eval-card-subtitle">
          CoTracker-based camera motion accuracy. VBench++ evaluates 7
          motion types (pan left/right, tilt up/down, zoom in/out,
          static) — EvalForge reports 3 aggregated classes: Static, Pan
          (avg left+right), Zoom (avg in+out).
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={I2V_MODELS.map((m) => ({
              name: m.name,
              Static: m.cameraStatic,
              Pan: m.cameraPan,
              Zoom: m.cameraZoom,
            }))}
            margin={{ left: 10, right: 20, top: 10, bottom: 10 }}
          >
            <XAxis
              dataKey="name"
              tick={{
                fontSize: 11,
                fill: "var(--color-text-secondary)",
              }}
            />
            <YAxis
              domain={[60, 100]}
              tick={{
                fontSize: 10,
                fill: "var(--color-text-tertiary)",
              }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend
              wrapperStyle={{
                fontSize: 12,
                color: "var(--color-text-secondary)",
              }}
            />
            <Bar
              dataKey="Static"
              fill="#6366f1"
              fillOpacity={0.8}
              radius={[4, 4, 0, 0]}
              barSize={18}
            />
            <Bar
              dataKey="Pan"
              fill="#f59e0b"
              fillOpacity={0.8}
              radius={[4, 4, 0, 0]}
              barSize={18}
            />
            <Bar
              dataKey="Zoom"
              fill="#ec4899"
              fillOpacity={0.8}
              radius={[4, 4, 0, 0]}
              barSize={18}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="eval-card">
        <h3 className="eval-card-title">I2V Full Score Table</h3>
        <div className="eval-table-wrap">
          <table className="eval-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>I2V Subject</th>
                <th>I2V Background</th>
                <th>Camera Static</th>
                <th>Camera Pan</th>
                <th>Camera Zoom</th>
              </tr>
            </thead>
            <tbody>
              {I2V_MODELS.map((m) => (
                <tr key={m.name}>
                  <td className="eval-metric-name">
                    <span
                      className="eval-chip-dot"
                      style={{
                        background: m.color,
                        display: "inline-block",
                        marginRight: 6,
                        verticalAlign: "middle",
                      }}
                    />
                    {m.name}
                  </td>
                  <td className="eval-metric-score">
                    {m.i2vSubject.toFixed(1)}
                  </td>
                  <td className="eval-metric-score">
                    {m.i2vBackground.toFixed(1)}
                  </td>
                  <td className="eval-metric-score">
                    {m.cameraStatic.toFixed(1)}
                  </td>
                  <td className="eval-metric-score">
                    {m.cameraPan.toFixed(1)}
                  </td>
                  <td className="eval-metric-score">
                    {m.cameraZoom.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
