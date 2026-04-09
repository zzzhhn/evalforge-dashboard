"use client";

import { useState, useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import {
  QUALITY_DIMS,
  DIM_LABELS,
  DIM_DESC,
  DIM_COLORS,
  INTENTS,
  SAMPLES,
  GRADE_COLORS,
  TOTAL_CONVERSATIONS,
  AGENT_GUIDE,
  scoreToColor,
  scoreToBg,
} from "@/data/agent";
import type { QualityDim } from "@/data/agent";

/* ── Component ─────────────────────────────────────────────────── */

export default function EvalAgentDashboard() {
  const [selectedIntent, setSelectedIntent] = useState<string | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [showGuide, setShowGuide] = useState(false);

  /* Global weighted quality scores */
  const globalQuality = useMemo(() => {
    return QUALITY_DIMS.map((dim) => {
      const weighted =
        INTENTS.reduce((s, i) => s + i.quality[dim] * i.count, 0) /
        TOTAL_CONVERSATIONS;
      return {
        dimension: DIM_LABELS[dim],
        dimKey: dim,
        score: Math.round(weighted * 10) / 10,
      };
    });
  }, []);

  /* Radar data for selected intent vs global */
  const intentQualityRadar = useMemo(() => {
    if (!selectedIntent) return null;
    const intent = INTENTS.find((i) => i.name === selectedIntent);
    if (!intent) return null;
    return QUALITY_DIMS.map((dim) => ({
      dimension: DIM_LABELS[dim],
      [intent.name]: intent.quality[dim],
      Global: globalQuality.find((g) => g.dimKey === dim)!.score,
    }));
  }, [selectedIntent, globalQuality]);

  const sample = SAMPLES[sampleIdx];
  const intentColor =
    INTENTS.find((i) => i.name === sample.intent)?.color ?? "#6366f1";

  return (
    <div className="eval-dashboard">
      {/* ── Taxonomy guide toggle ──────────────────────────────── */}
      <button
        className="eval-guide-toggle"
        onClick={() => setShowGuide((v) => !v)}
        aria-expanded={showGuide}
      >
        <span
          className={`eval-guide-toggle-icon ${showGuide ? "eval-guide-toggle-icon--open" : ""}`}
        >
          ▶
        </span>
        Understanding the EvalForge Evaluation Taxonomy
      </button>

      {showGuide && (
        <div className="eval-guide">
          <p className="eval-guide-rationale">{AGENT_GUIDE.rationale}</p>
          <div className="eval-guide-section-label">
            8 Quality Dimensions
          </div>
          <div className="eval-guide-grid">
            {AGENT_GUIDE.dims.map((d) => (
              <div key={d.name} className="eval-guide-item">
                <div
                  className="eval-guide-item-name"
                  style={{ color: d.color }}
                >
                  {d.name}
                </div>
                <div className="eval-guide-item-desc">{d.desc}</div>
                <div
                  className="eval-guide-item-desc"
                  style={{ marginTop: 4, fontStyle: "italic" }}
                >
                  Why: {d.why}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Intent distribution + quality overview ─────────────── */}
      <div className="eval-row">
        <div className="eval-card eval-card--half">
          <h3 className="eval-card-title">Intent Distribution</h3>
          <p className="eval-card-subtitle">
            {TOTAL_CONVERSATIONS} conversations · 7 categories · click to
            drill down
          </p>
          <ResponsiveContainer width="100%" height={260} aria-hidden="true">
            <PieChart>
              <Pie
                data={INTENTS}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={95}
                paddingAngle={2}
                stroke="none"
                onClick={(_, idx) => {
                  const name = INTENTS[idx].name;
                  setSelectedIntent((prev) =>
                    prev === name ? null : name,
                  );
                }}
                style={{ cursor: "pointer" }}
              >
                {INTENTS.map((i) => (
                  <Cell
                    key={i.name}
                    fill={i.color}
                    fillOpacity={
                      selectedIntent && selectedIntent !== i.name
                        ? 0.25
                        : 0.85
                    }
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--color-surface-elevated)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, name: any) =>
                  [
                    `${value} (${((Number(value) / TOTAL_CONVERSATIONS) * 100).toFixed(1)}%)`,
                    String(name),
                  ] as [string, string]
                }
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="eval-pie-legend">
            {INTENTS.map((i) => (
              <button
                key={i.name}
                aria-pressed={selectedIntent === i.name}
                className={`eval-legend-item ${selectedIntent === i.name ? "eval-legend-item--active" : ""}`}
                onClick={() =>
                  setSelectedIntent((p) =>
                    p === i.name ? null : i.name,
                  )
                }
              >
                <span
                  className="eval-legend-dot"
                  style={{ background: i.color }}
                />
                <span className="eval-legend-label">{i.name}</span>
                <span className="eval-legend-count">{i.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="eval-card eval-card--half">
          <h3 className="eval-card-title">
            {selectedIntent
              ? `Quality: ${selectedIntent}`
              : "Global Quality Scores"}
          </h3>
          <p className="eval-card-subtitle">
            8-dimension LLM-judge assessment — Gemma 4 with 5-shot
            calibration
          </p>
          {selectedIntent && intentQualityRadar ? (
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart
                data={intentQualityRadar}
                cx="50%"
                cy="50%"
                outerRadius="62%"
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
                  domain={[50, 100]}
                  tick={{
                    fontSize: 9,
                    fill: "var(--color-text-tertiary)",
                  }}
                />
                <Radar
                  name={selectedIntent}
                  dataKey={selectedIntent}
                  stroke={
                    INTENTS.find((i) => i.name === selectedIntent)
                      ?.color
                  }
                  fill={
                    INTENTS.find((i) => i.name === selectedIntent)
                      ?.color
                  }
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
                <Radar
                  name="Global Avg"
                  dataKey="Global"
                  stroke="var(--color-text-tertiary)"
                  fill="none"
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={globalQuality}
                margin={{ left: 10, right: 20, top: 20, bottom: 10 }}
              >
                <XAxis
                  dataKey="dimension"
                  tick={{
                    fontSize: 10,
                    fill: "var(--color-text-secondary)",
                  }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
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
                <Bar dataKey="score" radius={[4, 4, 0, 0]} barSize={28}>
                  {globalQuality.map((g) => (
                    <Cell
                      key={g.dimKey}
                      fill={DIM_COLORS[g.dimKey]}
                      fillOpacity={0.75}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Intent x Dimension Heatmap ─────────────────────────── */}
      <div className="eval-card">
        <h3 className="eval-card-title">
          Intent × Dimension Heatmap
        </h3>
        <p className="eval-card-subtitle">
          Score matrix across all intent categories and quality dimensions
        </p>
        <div className="eval-heatmap-wrapper">
          <table className="eval-heatmap">
            <thead>
              <tr>
                <th className="eval-heatmap-corner" />
                {QUALITY_DIMS.map((dim) => (
                  <th key={dim} className="eval-heatmap-col-header">
                    {DIM_LABELS[dim]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INTENTS.map((intent) => (
                <tr key={intent.name}>
                  <td className="eval-heatmap-row-header">
                    <span
                      className="eval-heatmap-dot"
                      style={{ background: intent.color }}
                    />
                    {intent.name}
                  </td>
                  {QUALITY_DIMS.map((dim) => {
                    const val = intent.quality[dim];
                    return (
                      <td
                        key={dim}
                        className="eval-heatmap-cell"
                        style={{
                          background: scoreToBg(val),
                          color: scoreToColor(val),
                        }}
                        title={`${intent.name} — ${DIM_LABELS[dim]}: ${val}`}
                      >
                        {val.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Sample conversation evaluation ─────────────────────── */}
      <div className="eval-card">
        <div className="eval-sample-header">
          <h3 className="eval-card-title">Sample Evaluations</h3>
          <div className="eval-sample-nav">
            {SAMPLES.map((s, i) => (
              <button
                key={s.id}
                className={`eval-tab ${sampleIdx === i ? "eval-tab--active" : ""}`}
                onClick={() => setSampleIdx(i)}
              >
                {s.intent}
              </button>
            ))}
          </div>
        </div>

        <div className="eval-sample-meta">
          <span
            className="eval-intent-tag"
            style={{
              background: `${intentColor}20`,
              color: intentColor,
            }}
          >
            {sample.intent}
          </span>
          <span className="eval-meta-id">{sample.id}</span>
          {sample.turns.length > 2 && (
            <span className="eval-meta-turns">
              {sample.turns.length / 2} turns
            </span>
          )}
          <span
            className="eval-grade eval-grade--lg"
            style={{
              color: GRADE_COLORS[sample.overallGrade],
              background: `${GRADE_COLORS[sample.overallGrade]}18`,
            }}
          >
            {sample.overallGrade}
          </span>
        </div>

        <div className="eval-conversation">
          {sample.turns.map((t, i) => {
            const lines = t.text.split("\n");
            return (
              <div
                key={i}
                className={`eval-turn eval-turn--${t.role}`}
              >
                <div className="eval-turn-role">
                  {t.role === "user" ? "User" : "Agent"}
                </div>
                <div
                  className={`eval-turn-text${t.role === "agent" ? " eval-turn-text--mono" : ""}`}
                >
                  {lines.map((line, j) => (
                    <span key={j}>
                      {line}
                      {j < lines.length - 1 && <br />}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="eval-score-grid">
          {QUALITY_DIMS.map((dim) => {
            const score = sample.scores[dim];
            const pct = Math.min(Math.max(score, 0), 100);
            return (
              <div
                key={dim}
                className="eval-score-item"
                title={DIM_DESC[dim]}
              >
                <div className="eval-score-label">
                  {DIM_LABELS[dim]}
                </div>
                <div className="eval-score-bar-track">
                  <div
                    className="eval-score-bar-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="eval-score-value">{score}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Methodology panel ──────────────────────────────────── */}
      <div className="eval-card eval-methodology">
        <h3 className="eval-card-title">Evaluation Methodology</h3>
        <div className="eval-methodology-grid">
          <MethodologyItem
            label="Judge Model"
            value="Gemma 4 (27B, local)"
            detail="OpenAI-compatible API fallback for redundancy"
          />
          <MethodologyItem
            label="Calibration"
            value="5-shot per dimension"
            detail="Handcrafted examples with gold scores to reduce inter-prompt variance"
          />
          <MethodologyItem
            label="Scale"
            value="0 - 100 per dimension"
            detail="Continuous scale, not discrete grades, for fine-grained comparison"
          />
          <MethodologyItem
            label="Aggregation"
            value="Turn → Session → Intent → Global"
            detail="Weighted by conversation count at the intent-category level"
          />
          <MethodologyItem
            label="Taxonomy Basis"
            value="MT-Bench / AlpacaEval / AgentBench"
            detail="8 dimensions capturing helpfulness, safety, and reasoning quality"
          />
          <MethodologyItem
            label="Dataset"
            value={`${TOTAL_CONVERSATIONS} conversations`}
            detail="Internal test set, 7 intent categories, multi-turn included"
          />
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function MethodologyItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="eval-method-item">
      <div className="eval-method-label">{label}</div>
      <div className="eval-method-value">{value}</div>
      <div className="eval-method-detail">{detail}</div>
    </div>
  );
}
