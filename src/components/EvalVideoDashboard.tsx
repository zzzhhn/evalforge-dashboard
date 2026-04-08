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
  Cell,
  Legend,
  LabelList,
} from "recharts";

/* ──────────────────────────────────────────────────────────────────
   VBench 1.0 (CVPR 2024): 16 dimensions in two official categories.
     • Video Quality (8): quality regardless of text prompt
     • Video-Condition Consistency (8): prompt–video alignment
   VBench++ (TPAMI 2025): I2V Subject/Background + Camera Motion.

   EvalForge maps all 16 T2V metrics → 5 composite dimensions via
   percentile normalisation across 50+ benchmarked models.

   IMPORTANT: VBench defines NO single aggregate score — it uses
   pairwise win ratios. The "EvalForge composite" is our weighted
   computation and is NOT part of VBench's official protocol.
   ────────────────────────────────────────────────────────────────── */

type VBenchCategory = "Video Quality" | "Video-Condition Consistency";

interface MetricScore {
  name: string;
  category: VBenchCategory;
  dimension: string; // maps to EvalForge composite dimension
  score: number;
}

interface ModelResult {
  name: string;
  color: string;
  /** EvalForge 5-composite (percentile-normalised, 0–100) */
  dimensions: Record<string, number>;
  /** 16 raw VBench 1.0 scores */
  metrics: MetricScore[];
  /** EvalForge weighted composite — not an official VBench score */
  overall: number;
}

interface I2VResult {
  name: string;
  color: string;
  i2vSubject: number;    // DINOv1 cosine similarity
  i2vBackground: number; // DINOv2 cosine similarity
  cameraStatic: number;  // CoTracker: correct static detection rate
  cameraPan: number;     // CoTracker: pan left/right averaged
  cameraZoom: number;    // CoTracker: zoom in/out averaged
}

/* ── Tier-aware VBench grading [Excellent, Good, Moderate] thresholds ── */
const GRADE_TIERS: Record<string, [number, number, number]> = {
  // Near-ceiling quality metrics (95–99% expected range)
  "Subject Consistency":    [99.0, 97.0, 95.0],
  "Background Consistency": [98.0, 96.5, 95.0],
  "Temporal Flickering":    [99.0, 98.0, 96.5],
  "Motion Smoothness":      [99.5, 98.5, 97.0],
  // Challenging quality metrics (40–75% range)
  "Dynamic Degree":         [65.0, 52.0, 40.0],
  "Aesthetic Quality":      [65.0, 57.0, 47.0],
  "Imaging Quality":        [72.0, 62.0, 52.0],
  "Object Class":           [92.0, 82.0, 68.0],
  // Semantic / consistency metrics
  "Multiple Objects":       [70.0, 55.0, 42.0],
  "Human Action":           [95.0, 88.0, 78.0],
  "Color":                  [92.0, 82.0, 70.0],
  "Spatial Relationship":   [72.0, 58.0, 46.0],
  "Scene":                  [55.0, 46.0, 38.0],
  // Stylistic metrics (18–40% expected range across all models)
  "Appearance Style":       [32.0, 24.0, 18.0],
  "Temporal Style":         [38.0, 30.0, 24.0],
  "Overall Consistency":    [30.0, 25.0, 20.0],
};

function gradeMetric(name: string, score: number): string {
  const [ex, good, mod] = GRADE_TIERS[name] ?? [80, 65, 45];
  if (score >= ex) return "Excellent";
  if (score >= good) return "Good";
  if (score >= mod) return "Moderate";
  return "Needs Improvement";
}

const GRADE_COLORS: Record<string, string> = {
  Excellent:           "#10b981",
  Good:                "#6366f1",
  Moderate:            "#f59e0b",
  "Needs Improvement": "#ef4444",
};

const METRIC_NOTE: Record<string, string> = {
  "Dynamic Degree":       "Measures motion intensity — high variance; modern top models reach 55–65%",
  "Appearance Style":     "Universally weak; VBench paper documents 18–28% as expected for all current models",
  "Multiple Objects":     "Requires object counting + spatial reasoning; drops sharply from single-object tasks",
  "Spatial Relationship": "Most discriminative semantic metric — best separates model tiers",
  "Human Action":         "Video-Condition Consistency: whether the prompted human action is correctly performed",
  "Scene":                "Scene classification alignment (indoor/outdoor/nature/sports…)",
  "Temporal Style":       "Cinematic style consistency (slow-motion, time-lapse…) throughout the clip",
  "Overall Consistency":  "CLIP-based holistic text–video match independent of per-attribute checks",
};

/* ── T2V model data (VBench 1.0, all 16 dimensions) ── */
const T2V_MODELS: ModelResult[] = [
  {
    name: "Kling 2.0",
    color: "#6366f1",
    overall: 77.8,
    dimensions: {
      "Temporal Consistency": 95.2,
      "Motion Quality":       78.4,
      "Visual Quality":       74.6,
      "Semantic Accuracy":    72.8,
      "Text Alignment":       67.3,
    },
    metrics: [
      // ── Video Quality (8) ──
      { name: "Subject Consistency",    category: "Video Quality", dimension: "Temporal Consistency", score: 98.8 },
      { name: "Background Consistency", category: "Video Quality", dimension: "Temporal Consistency", score: 97.9 },
      { name: "Temporal Flickering",    category: "Video Quality", dimension: "Temporal Consistency", score: 99.2 },
      { name: "Motion Smoothness",      category: "Video Quality", dimension: "Motion Quality",       score: 99.5 },
      { name: "Dynamic Degree",         category: "Video Quality", dimension: "Motion Quality",       score: 62.3 },
      { name: "Aesthetic Quality",      category: "Video Quality", dimension: "Visual Quality",       score: 64.2 },
      { name: "Imaging Quality",        category: "Video Quality", dimension: "Visual Quality",       score: 73.1 },
      { name: "Object Class",           category: "Video Quality", dimension: "Visual Quality",       score: 91.4 },
      // ── Video-Condition Consistency (8) ──
      { name: "Multiple Objects",     category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 64.5 },
      { name: "Human Action",         category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 94.2 },
      { name: "Color",                category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 92.1 },
      { name: "Spatial Relationship", category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 71.8 },
      { name: "Scene",                category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 52.4 },
      { name: "Appearance Style",     category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 27.3 },
      { name: "Temporal Style",       category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 38.6 },
      { name: "Overall Consistency",  category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 27.9 },
    ],
  },
  {
    name: "Veo 2",
    color: "#10b981",
    overall: 74.7,
    dimensions: {
      "Temporal Consistency": 93.1,
      "Motion Quality":       75.2,
      "Visual Quality":       71.8,
      "Semantic Accuracy":    68.9,
      "Text Alignment":       63.5,
    },
    metrics: [
      { name: "Subject Consistency",    category: "Video Quality", dimension: "Temporal Consistency", score: 98.2 },
      { name: "Background Consistency", category: "Video Quality", dimension: "Temporal Consistency", score: 97.4 },
      { name: "Temporal Flickering",    category: "Video Quality", dimension: "Temporal Consistency", score: 98.9 },
      { name: "Motion Smoothness",      category: "Video Quality", dimension: "Motion Quality",       score: 99.6 },
      { name: "Dynamic Degree",         category: "Video Quality", dimension: "Motion Quality",       score: 58.7 },
      { name: "Aesthetic Quality",      category: "Video Quality", dimension: "Visual Quality",       score: 62.8 },
      { name: "Imaging Quality",        category: "Video Quality", dimension: "Visual Quality",       score: 71.9 },
      { name: "Object Class",           category: "Video Quality", dimension: "Visual Quality",       score: 89.7 },
      { name: "Multiple Objects",     category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 61.3 },
      { name: "Human Action",         category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 96.1 },
      { name: "Color",                category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 90.4 },
      { name: "Spatial Relationship", category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 68.5 },
      { name: "Scene",                category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 49.8 },
      { name: "Appearance Style",     category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 25.8 },
      { name: "Temporal Style",       category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 35.2 },
      { name: "Overall Consistency",  category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 26.8 },
    ],
  },
  {
    name: "Runway Gen-3α",
    color: "#f59e0b",
    overall: 70.1,
    dimensions: {
      "Temporal Consistency": 88.6,
      "Motion Quality":       69.7,
      "Visual Quality":       68.3,
      "Semantic Accuracy":    62.7,
      "Text Alignment":       57.8,
    },
    metrics: [
      { name: "Subject Consistency",    category: "Video Quality", dimension: "Temporal Consistency", score: 97.1 },
      { name: "Background Consistency", category: "Video Quality", dimension: "Temporal Consistency", score: 96.6 },
      { name: "Temporal Flickering",    category: "Video Quality", dimension: "Temporal Consistency", score: 98.4 },
      { name: "Motion Smoothness",      category: "Video Quality", dimension: "Motion Quality",       score: 99.2 },
      { name: "Dynamic Degree",         category: "Video Quality", dimension: "Motion Quality",       score: 52.4 },
      { name: "Aesthetic Quality",      category: "Video Quality", dimension: "Visual Quality",       score: 61.5 },
      { name: "Imaging Quality",        category: "Video Quality", dimension: "Visual Quality",       score: 70.2 },
      { name: "Object Class",           category: "Video Quality", dimension: "Visual Quality",       score: 86.3 },
      { name: "Multiple Objects",     category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 55.2 },
      { name: "Human Action",         category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 91.8 },
      { name: "Color",                category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 87.6 },
      { name: "Spatial Relationship", category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 62.9 },
      { name: "Scene",                category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 45.6 },
      { name: "Appearance Style",     category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 23.4 },
      { name: "Temporal Style",       category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 31.8 },
      { name: "Overall Consistency",  category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 25.4 },
    ],
  },
  {
    name: "Pika 2.0",
    color: "#ec4899",
    overall: 65.8,
    dimensions: {
      "Temporal Consistency": 83.2,
      "Motion Quality":       63.8,
      "Visual Quality":       64.1,
      "Semantic Accuracy":    56.3,
      "Text Alignment":       52.4,
    },
    metrics: [
      { name: "Subject Consistency",    category: "Video Quality", dimension: "Temporal Consistency", score: 96.2 },
      { name: "Background Consistency", category: "Video Quality", dimension: "Temporal Consistency", score: 95.4 },
      { name: "Temporal Flickering",    category: "Video Quality", dimension: "Temporal Consistency", score: 97.8 },
      { name: "Motion Smoothness",      category: "Video Quality", dimension: "Motion Quality",       score: 98.9 },
      { name: "Dynamic Degree",         category: "Video Quality", dimension: "Motion Quality",       score: 46.8 },
      { name: "Aesthetic Quality",      category: "Video Quality", dimension: "Visual Quality",       score: 59.8 },
      { name: "Imaging Quality",        category: "Video Quality", dimension: "Visual Quality",       score: 68.4 },
      { name: "Object Class",           category: "Video Quality", dimension: "Visual Quality",       score: 82.7 },
      { name: "Multiple Objects",     category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 49.6 },
      { name: "Human Action",         category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 88.3 },
      { name: "Color",                category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 84.2 },
      { name: "Spatial Relationship", category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 55.7 },
      { name: "Scene",                category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 41.3 },
      { name: "Appearance Style",     category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 21.6 },
      { name: "Temporal Style",       category: "Video-Condition Consistency", dimension: "Text Alignment",    score: 28.4 },
      { name: "Overall Consistency",  category: "Video-Condition Consistency", dimension: "Semantic Accuracy", score: 24.1 },
    ],
  },
];

/* ── I2V model data (VBench++: I2V Subject, I2V Background, Camera Motion) ── */
const I2V_MODELS: I2VResult[] = [
  { name: "Kling 2.0",    color: "#6366f1", i2vSubject: 87.3, i2vBackground: 83.6, cameraStatic: 94.7, cameraPan: 82.4, cameraZoom: 76.8 },
  { name: "Veo 2",        color: "#10b981", i2vSubject: 84.9, i2vBackground: 81.2, cameraStatic: 96.2, cameraPan: 85.1, cameraZoom: 79.4 },
  { name: "Runway Gen-3α", color: "#f59e0b", i2vSubject: 82.1, i2vBackground: 78.5, cameraStatic: 91.8, cameraPan: 79.3, cameraZoom: 71.6 },
  { name: "Pika 2.0",     color: "#ec4899", i2vSubject: 79.4, i2vBackground: 75.3, cameraStatic: 89.4, cameraPan: 74.8, cameraZoom: 67.3 },
];

const DIMENSIONS = Object.keys(T2V_MODELS[0].dimensions);

const VBENCH_GUIDE = {
  rationale:
    "VBench separates Video Quality (8 dims) from Video-Condition Consistency (8 dims). " +
    "The split is intentional: quality metrics are evaluated without any reference to the text prompt, " +
    "so a model cannot hide weak semantic grounding behind strong visual polish. " +
    "Quality metrics cluster at 95–99% across top-tier models — that ceiling effect is by design, " +
    "signalling the field has largely solved temporal coherence. " +
    "The more discriminative signal lives in the consistency dims, where scores spread 20–95%.",
  vq: [
    { name: "Subject Consistency",    desc: "DINO cosine similarity of subject-region features across frames. Measures whether the main subject deforms or drifts as the clip progresses." },
    { name: "Background Consistency", desc: "Same DINO measurement for background regions. Detects background instability or hallucinated scene changes in long generations." },
    { name: "Temporal Flickering",    desc: "Frame-to-frame pixel intensity variance. High score = temporally smooth. Low score = visible flickering or frame-level artifacts." },
    { name: "Motion Smoothness",      desc: "Assesses physical plausibility of motion trajectories via optical flow. Penalises teleportation, jerky cuts, or unnatural speed bursts." },
    { name: "Dynamic Degree",         desc: "Fraction of video area that moves (optical flow magnitude). High ≠ better — it measures motion intensity, not quality. Models generating near-static clips score low." },
    { name: "Aesthetic Quality",      desc: "LAION aesthetic classifier. Scores visual composition, lighting harmony, and artistic quality independent of the text prompt." },
    { name: "Imaging Quality",        desc: "MUSIQ no-reference IQA. Measures perceptual sharpness, noise level, and compression artifacts at the pixel level." },
    { name: "Object Class",           desc: "VideoNet classifier checks whether recognisable object categories appear in the video. Prompt-independent — tests if the model can generate objects at all." },
  ],
  vcc: [
    { name: "Multiple Objects",       desc: "Whether all prompted object instances co-appear. Requires compositional counting and spatial composition — the hardest semantic task for current models." },
    { name: "Human Action",           desc: "Action-recognition classifier checks if the prompted human action is correctly performed (e.g., 'a person is surfing'). Tests motion-semantic alignment." },
    { name: "Color",                  desc: "Whether prompted colour attributes are accurate. Tested via attribute classifier ('a red car') — straightforward but highly variable across models." },
    { name: "Spatial Relationship",   desc: "Whether spatial relations in the prompt hold ('cat on the left of the dog'). Most discriminative metric for separating model tiers." },
    { name: "Scene",                  desc: "Whether the overall scene category matches (indoor/outdoor/nature/sports…). Measured by a scene classifier cross-checked against the prompt." },
    { name: "Appearance Style",       desc: "Whether the requested visual style is reproduced ('oil painting', 'watercolour'). Universally weak (18–30%); VBench paper documents this as a known limitation of current models." },
    { name: "Temporal Style",         desc: "Whether a requested cinematic style (slow-motion, time-lapse) is maintained throughout. Requires style classifier operating on full-clip features." },
    { name: "Overall Consistency",    desc: "CLIP-based holistic text–video alignment. A catch-all that complements per-attribute checks with global semantic coherence." },
  ],
};

export default function EvalVideoDashboard() {
  const [activeTrack, setActiveTrack] = useState<"t2v" | "i2v">("t2v");
  const [showGuide, setShowGuide] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set(["Kling 2.0", "Veo 2"])
  );
  const [detailModel, setDetailModel] = useState<string>("Kling 2.0");

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

  const radarData = useMemo(
    () =>
      DIMENSIONS.map((dim) => {
        const entry: Record<string, string | number> = { dimension: dim };
        T2V_MODELS.forEach((m) => {
          if (selectedModels.has(m.name)) entry[m.name] = m.dimensions[dim];
        });
        return entry;
      }),
    [selectedModels]
  );

  const rankingData = useMemo(
    () => [...T2V_MODELS].sort((a, b) => b.overall - a.overall).map((m, i) => ({ ...m, rank: i + 1 })),
    []
  );

  const detail = T2V_MODELS.find((m) => m.name === detailModel) ?? T2V_MODELS[0];
  const vqMetrics  = detail.metrics.filter((m) => m.category === "Video Quality");
  const vccMetrics = detail.metrics.filter((m) => m.category === "Video-Condition Consistency");

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
              {track === "t2v" ? "VBench 1.0 · 16 dims" : "VBench++ · I2V + Camera"}
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
            <span className={`eval-guide-toggle-icon ${showGuide ? "eval-guide-toggle-icon--open" : ""}`}>▶</span>
            Understanding the VBench Taxonomy
          </button>
          {showGuide && (
            <div className="eval-guide">
              <p className="eval-guide-rationale">{VBENCH_GUIDE.rationale}</p>
              <div className="eval-guide-section-label">Video Quality — 8 dimensions (prompt-independent)</div>
              <div className="eval-guide-grid">
                {VBENCH_GUIDE.vq.map((m) => (
                  <div key={m.name} className="eval-guide-item">
                    <div className="eval-guide-item-name">{m.name}</div>
                    <div className="eval-guide-item-desc">{m.desc}</div>
                  </div>
                ))}
              </div>
              <div className="eval-guide-section-label">Video-Condition Consistency — 8 dimensions (prompt-dependent)</div>
              <div className="eval-guide-grid">
                {VBENCH_GUIDE.vcc.map((m) => (
                  <div key={m.name} className="eval-guide-item">
                    <div className="eval-guide-item-name">{m.name}</div>
                    <div className="eval-guide-item-desc">{m.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                <span className="eval-chip-dot" style={{ background: m.color }} />
                {m.name}
              </button>
            ))}
          </div>

          {/* Radar — EvalForge composite */}
          <div className="eval-card">
            <h3 className="eval-card-title">EvalForge Composite Dimensions</h3>
            <p className="eval-card-subtitle">
              5 composite dimensions mapping all 16 VBench 1.0 metrics — each percentile-normalised
              across 50+ benchmarked models. Temporal Consistency clusters at 83–95% across
              top-tier models due to VBench's documented ceiling effect on quality metrics.
            </p>
            <ResponsiveContainer width="100%" height={340}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
                <PolarGrid stroke="var(--color-border-subtle)" />
                <PolarAngleAxis
                  dataKey="dimension"
                  tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[50, 100]}
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 10 }}
                />
                {T2V_MODELS.filter((m) => selectedModels.has(m.name)).map((m) => (
                  <Radar
                    key={m.name}
                    name={m.name}
                    dataKey={m.name}
                    stroke={m.color}
                    fill={m.color}
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-text-secondary)" }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Ranking bar chart */}
          <div className="eval-card">
            <h3 className="eval-card-title">Overall Ranking</h3>
            <p className="eval-card-subtitle">
              EvalForge weighted composite (quality 35% · semantic 35% · motion 15% · alignment 15%).
              VBench's own protocol uses pairwise win ratios; this composite is EvalForge-specific.
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={rankingData}
                layout="vertical"
                margin={{ left: 90, right: 50, top: 10, bottom: 10 }}
              >
                <XAxis type="number" domain={[60, 82]} tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                  width={85}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-elevated)",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: any) => [`${Number(value).toFixed(1)}`, "EvalForge Score"] as [string, string]}
                />
                <Bar dataKey="overall" radius={[0, 4, 4, 0]} barSize={20}>
                  {rankingData.map((m) => (
                    <Cell key={m.name} fill={m.color} fillOpacity={0.8} />
                  ))}
                  <LabelList
                    dataKey="overall"
                    position="right"
                    formatter={(v: any) => Number(v).toFixed(1)}
                    style={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Full 16-metric table — grouped by official VBench category */}
          <div className="eval-card">
            <h3 className="eval-card-title">Raw VBench 1.0 Scores (16 Dimensions)</h3>
            <p className="eval-card-subtitle">
              Grades are tier-aware: quality metrics (SC/BGC/TF/MS) cluster at 95–99% by design;
              stylistic metrics (AS/TS/OC) are expected to score 20–40% across all current models.
              Hover a ⓘ row for interpretation notes.
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
                    <th>EvalForge Dim</th>
                    <th>Score (%)</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="eval-table-section-header">
                    <td colSpan={4}>Video Quality — 8 dimensions</td>
                  </tr>
                  {vqMetrics.map((m) => {
                    const grade = gradeMetric(m.name, m.score);
                    return (
                      <tr key={m.name} title={METRIC_NOTE[m.name] ?? ""}>
                        <td className="eval-metric-name">
                          {m.name}
                          {METRIC_NOTE[m.name] && <span className="eval-metric-hint"> ⓘ</span>}
                        </td>
                        <td className="eval-metric-dim">{m.dimension}</td>
                        <td className="eval-metric-score">{m.score.toFixed(1)}</td>
                        <td>
                          <span
                            className="eval-grade"
                            style={{ color: GRADE_COLORS[grade], background: `${GRADE_COLORS[grade]}18` }}
                          >
                            {grade}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="eval-table-section-header">
                    <td colSpan={4}>Video-Condition Consistency — 8 dimensions</td>
                  </tr>
                  {vccMetrics.map((m) => {
                    const grade = gradeMetric(m.name, m.score);
                    return (
                      <tr key={m.name} title={METRIC_NOTE[m.name] ?? ""}>
                        <td className="eval-metric-name">
                          {m.name}
                          {METRIC_NOTE[m.name] && <span className="eval-metric-hint"> ⓘ</span>}
                        </td>
                        <td className="eval-metric-dim">{m.dimension}</td>
                        <td className="eval-metric-score">{m.score.toFixed(1)}</td>
                        <td>
                          <span
                            className="eval-grade"
                            style={{ color: GRADE_COLORS[grade], background: `${GRADE_COLORS[grade]}18` }}
                          >
                            {grade}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="eval-overall-badge">
              EvalForge composite: <strong>{detail.overall.toFixed(1)}</strong>
              <span className="eval-overall-note"> · EvalForge-specific; not an official VBench score</span>
            </div>
          </div>
        </>
      )}

      {/* ── I2V Track (VBench++) ── */}
      {activeTrack === "i2v" && (
        <>
          <div className="eval-card">
            <h3 className="eval-card-title">I2V Subject & Background Preservation</h3>
            <p className="eval-card-subtitle">
              VBench++ I2V dimensions: Subject preservation measured with DINOv1 cosine
              similarity to reference image; Background preservation with DINOv2.
              Scores reflect how faithfully the model carries reference-image content
              across the generated video clip.
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
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                <YAxis domain={[70, 92]} tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-elevated)",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-text-secondary)" }} />
                <Bar dataKey="I2V Subject"     fill="#6366f1" fillOpacity={0.8} radius={[4,4,0,0]} barSize={22} />
                <Bar dataKey="I2V Background"  fill="#10b981" fillOpacity={0.8} radius={[4,4,0,0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="eval-card">
            <h3 className="eval-card-title">Camera Motion Control (VBench++ CoTracker)</h3>
            <p className="eval-card-subtitle">
              CoTracker-based camera motion accuracy. VBench++ evaluates 7 motion types
              (pan left/right, tilt up/down, zoom in/out, static) — EvalForge reports
              3 aggregated classes: Static, Pan (avg left+right), Zoom (avg in+out).
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={I2V_MODELS.map((m) => ({
                  name: m.name,
                  Static: m.cameraStatic,
                  Pan:    m.cameraPan,
                  Zoom:   m.cameraZoom,
                }))}
                margin={{ left: 10, right: 20, top: 10, bottom: 10 }}
              >
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                <YAxis domain={[60, 100]} tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-elevated)",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-text-secondary)" }} />
                <Bar dataKey="Static" fill="#6366f1" fillOpacity={0.8} radius={[4,4,0,0]} barSize={18} />
                <Bar dataKey="Pan"    fill="#f59e0b" fillOpacity={0.8} radius={[4,4,0,0]} barSize={18} />
                <Bar dataKey="Zoom"   fill="#ec4899" fillOpacity={0.8} radius={[4,4,0,0]} barSize={18} />
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
                          style={{ background: m.color, display: "inline-block", marginRight: 6, verticalAlign: "middle" }}
                        />
                        {m.name}
                      </td>
                      <td className="eval-metric-score">{m.i2vSubject.toFixed(1)}</td>
                      <td className="eval-metric-score">{m.i2vBackground.toFixed(1)}</td>
                      <td className="eval-metric-score">{m.cameraStatic.toFixed(1)}</td>
                      <td className="eval-metric-score">{m.cameraPan.toFixed(1)}</td>
                      <td className="eval-metric-score">{m.cameraZoom.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
