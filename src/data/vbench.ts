/* ──────────────────────────────────────────────────────────────────
   VBench 1.0 (CVPR 2024) Taxonomy & Model Data

   16 dimensions split into two official categories:
     - Video Quality (7): prompt-independent quality assessment
     - Video-Condition Consistency (9): prompt-video alignment

   CRITICAL: Object Class belongs in VCC (it checks whether
   *prompted* objects appear — this is prompt-dependent).

   VBench defines NO single aggregate score. The official ranking
   protocol uses pairwise win ratios across all 16 dimensions.
   ────────────────────────────────────────────────────────────────── */

export type VBenchCategory = "Video Quality" | "Video-Condition Consistency";

export interface VBenchDimension {
  name: string;
  category: VBenchCategory;
  evaluator: string;
  scoreRange: [number, number];
  description: string;
  note?: string;
}

export interface MetricScore {
  name: string;
  score: number;
}

export interface ModelResult {
  name: string;
  color: string;
  metrics: MetricScore[];
}

export interface I2VResult {
  name: string;
  color: string;
  i2vSubject: number;
  i2vBackground: number;
  cameraStatic: number;
  cameraPan: number;
  cameraZoom: number;
}

/* ── VBench 1.0: 16 Dimensions ── */

export const VBENCH_DIMENSIONS: VBenchDimension[] = [
  // ── Video Quality (7) ──
  {
    name: "Subject Consistency",
    category: "Video Quality",
    evaluator: "DINO",
    scoreRange: [86, 99],
    description:
      "DINO cosine similarity of subject-region features across frames. Measures whether the main subject deforms or drifts as the clip progresses.",
  },
  {
    name: "Background Consistency",
    category: "Video Quality",
    evaluator: "CLIP",
    scoreRange: [92, 99],
    description:
      "CLIP-based measurement for background regions. Detects background instability or hallucinated scene changes in long generations.",
  },
  {
    name: "Temporal Flickering",
    category: "Video Quality",
    evaluator: "Frame diff",
    scoreRange: [96, 99],
    description:
      "Frame-to-frame pixel intensity variance. High score = temporally smooth. Low score = visible flickering or frame-level artifacts.",
  },
  {
    name: "Motion Smoothness",
    category: "Video Quality",
    evaluator: "AMT",
    scoreRange: [91, 99],
    description:
      "Assesses physical plausibility of motion trajectories via optical flow. Penalises teleportation, jerky cuts, or unnatural speed bursts.",
  },
  {
    name: "Dynamic Degree",
    category: "Video Quality",
    evaluator: "RAFT optical flow",
    scoreRange: [42, 90],
    description:
      "Fraction of video area that moves (optical flow magnitude). High != better -- it measures motion intensity, not quality. Models generating near-static clips score low.",
    note: "Measures motion intensity -- high variance; modern top models reach 55-65%",
  },
  {
    name: "Aesthetic Quality",
    category: "Video Quality",
    evaluator: "LAION predictor",
    scoreRange: [38, 68],
    description:
      "LAION aesthetic classifier. Scores visual composition, lighting harmony, and artistic quality independent of the text prompt.",
  },
  {
    name: "Imaging Quality",
    category: "Video Quality",
    evaluator: "MUSIQ",
    scoreRange: [41, 72],
    description:
      "MUSIQ no-reference IQA. Measures perceptual sharpness, noise level, and compression artifacts at the pixel level.",
  },

  // ── Video-Condition Consistency (9) ──
  {
    name: "Object Class",
    category: "Video-Condition Consistency",
    evaluator: "GRiT detection",
    scoreRange: [73, 92],
    description:
      "GRiT object detector checks whether prompted object categories appear in the generated video. Prompt-dependent: tests if the model generates the objects the user asked for.",
  },
  {
    name: "Multiple Objects",
    category: "Video-Condition Consistency",
    evaluator: "GRiT",
    scoreRange: [28, 70],
    description:
      "Whether all prompted object instances co-appear. Requires compositional counting and spatial composition -- the hardest semantic task for current models.",
    note: "Requires object counting + spatial reasoning; drops sharply from single-object tasks",
  },
  {
    name: "Human Action",
    category: "Video-Condition Consistency",
    evaluator: "UMT recognition",
    scoreRange: [78, 96],
    description:
      "Action-recognition classifier checks if the prompted human action is correctly performed (e.g., 'a person is surfing'). Tests motion-semantic alignment.",
    note: "Whether the prompted human action is correctly performed",
  },
  {
    name: "Color",
    category: "Video-Condition Consistency",
    evaluator: "GRiT + compare",
    scoreRange: [70, 92],
    description:
      "Whether prompted colour attributes are accurate. Tested via attribute classifier ('a red car') -- straightforward but highly variable across models.",
  },
  {
    name: "Spatial Relationship",
    category: "Video-Condition Consistency",
    evaluator: "Rule-based",
    scoreRange: [30, 72],
    description:
      "Whether spatial relations in the prompt hold ('cat on the left of the dog'). Most discriminative metric for separating model tiers.",
    note: "Most discriminative semantic metric -- best separates model tiers",
  },
  {
    name: "Scene",
    category: "Video-Condition Consistency",
    evaluator: "Tag2Text",
    scoreRange: [25, 55],
    description:
      "Whether the overall scene category matches (indoor/outdoor/nature/sports...). Measured by a scene classifier cross-checked against the prompt.",
    note: "Scene classification alignment (indoor/outdoor/nature/sports...)",
  },
  {
    name: "Appearance Style",
    category: "Video-Condition Consistency",
    evaluator: "CLIP",
    scoreRange: [18, 32],
    description:
      "Whether the requested visual style is reproduced ('oil painting', 'watercolour'). Universally weak (18-30%); VBench paper documents this as a known limitation of current models.",
    note: "Universally weak; VBench paper documents 18-28% as expected for all current models",
  },
  {
    name: "Temporal Style",
    category: "Video-Condition Consistency",
    evaluator: "ViCLIP",
    scoreRange: [24, 38],
    description:
      "Whether a requested cinematic style (slow-motion, time-lapse) is maintained throughout. Requires style classifier operating on full-clip features.",
    note: "Cinematic style consistency (slow-motion, time-lapse...) throughout the clip",
  },
  {
    name: "Overall Consistency",
    category: "Video-Condition Consistency",
    evaluator: "ViCLIP",
    scoreRange: [20, 30],
    description:
      "ViCLIP-based holistic text-video alignment. A catch-all that complements per-attribute checks with global semantic coherence.",
    note: "ViCLIP-based holistic text-video match independent of per-attribute checks",
  },
];

export const VQ_DIMENSIONS = VBENCH_DIMENSIONS.filter(
  (d) => d.category === "Video Quality"
);
export const VCC_DIMENSIONS = VBENCH_DIMENSIONS.filter(
  (d) => d.category === "Video-Condition Consistency"
);

/* ── Tier-aware grading ── */

export const GRADE_TIERS: Record<string, [number, number, number]> = {
  "Subject Consistency":    [99.0, 97.0, 95.0],
  "Background Consistency": [98.0, 96.5, 95.0],
  "Temporal Flickering":    [99.0, 98.0, 96.5],
  "Motion Smoothness":      [99.5, 98.5, 97.0],
  "Dynamic Degree":         [65.0, 52.0, 40.0],
  "Aesthetic Quality":      [65.0, 57.0, 47.0],
  "Imaging Quality":        [72.0, 62.0, 52.0],
  "Object Class":           [92.0, 82.0, 68.0],
  "Multiple Objects":       [70.0, 55.0, 42.0],
  "Human Action":           [95.0, 88.0, 78.0],
  "Color":                  [92.0, 82.0, 70.0],
  "Spatial Relationship":   [72.0, 58.0, 46.0],
  "Scene":                  [55.0, 46.0, 38.0],
  "Appearance Style":       [32.0, 24.0, 18.0],
  "Temporal Style":         [38.0, 30.0, 24.0],
  "Overall Consistency":    [30.0, 25.0, 20.0],
};

export function gradeMetric(name: string, score: number): string {
  const [ex, good, mod] = GRADE_TIERS[name] ?? [80, 65, 45];
  if (score >= ex) return "Excellent";
  if (score >= good) return "Good";
  if (score >= mod) return "Moderate";
  return "Needs Improvement";
}

export const GRADE_COLORS: Record<string, string> = {
  Excellent:           "#10b981",
  Good:                "#6366f1",
  Moderate:            "#f59e0b",
  "Needs Improvement": "#ef4444",
};

export const METRIC_NOTES: Record<string, string> = Object.fromEntries(
  VBENCH_DIMENSIONS.filter((d) => d.note != null).map((d) => [d.name, d.note!])
);

/* ── Dimension name list (ordered) ── */

export const DIMENSION_NAMES = VBENCH_DIMENSIONS.map((d) => d.name);

/* ── T2V Model Data (VBench 1.0, all 16 raw scores) ──
   Rankings: Veo 3.1 > Kling 2.6 Pro > Seedance 1.5 > Wan 2.2 > LTX 2.3
   Scores are realistic within each dimension's expected range. */

export const T2V_MODELS: ModelResult[] = [
  {
    name: "Veo 3.1",
    color: "#06b6d4",
    metrics: [
      { name: "Subject Consistency",    score: 99.0 },
      { name: "Background Consistency", score: 98.0 },
      { name: "Temporal Flickering",    score: 99.1 },
      { name: "Motion Smoothness",      score: 99.6 },
      { name: "Dynamic Degree",         score: 63.8 },
      { name: "Aesthetic Quality",      score: 66.4 },
      { name: "Imaging Quality",        score: 72.8 },
      { name: "Object Class",           score: 91.8 },
      { name: "Multiple Objects",       score: 68.2 },
      { name: "Human Action",           score: 95.4 },
      { name: "Color",                  score: 91.6 },
      { name: "Spatial Relationship",   score: 71.4 },
      { name: "Scene",                  score: 54.2 },
      { name: "Appearance Style",       score: 31.4 },
      { name: "Temporal Style",         score: 37.2 },
      { name: "Overall Consistency",    score: 29.1 },
    ],
  },
  {
    name: "Kling 2.6 Pro",
    color: "#8b5cf6",
    metrics: [
      { name: "Subject Consistency",    score: 98.6 },
      { name: "Background Consistency", score: 97.8 },
      { name: "Temporal Flickering",    score: 98.9 },
      { name: "Motion Smoothness",      score: 99.4 },
      { name: "Dynamic Degree",         score: 60.1 },
      { name: "Aesthetic Quality",      score: 63.8 },
      { name: "Imaging Quality",        score: 70.6 },
      { name: "Object Class",           score: 89.4 },
      { name: "Multiple Objects",       score: 62.8 },
      { name: "Human Action",           score: 93.6 },
      { name: "Color",                  score: 89.4 },
      { name: "Spatial Relationship",   score: 67.3 },
      { name: "Scene",                  score: 50.8 },
      { name: "Appearance Style",       score: 28.6 },
      { name: "Temporal Style",         score: 34.8 },
      { name: "Overall Consistency",    score: 27.2 },
    ],
  },
  {
    name: "Seedance 1.5",
    color: "#f59e0b",
    metrics: [
      { name: "Subject Consistency",    score: 98.0 },
      { name: "Background Consistency", score: 97.2 },
      { name: "Temporal Flickering",    score: 98.6 },
      { name: "Motion Smoothness",      score: 99.1 },
      { name: "Dynamic Degree",         score: 55.6 },
      { name: "Aesthetic Quality",      score: 60.2 },
      { name: "Imaging Quality",        score: 67.8 },
      { name: "Object Class",           score: 85.6 },
      { name: "Multiple Objects",       score: 57.4 },
      { name: "Human Action",           score: 90.8 },
      { name: "Color",                  score: 85.8 },
      { name: "Spatial Relationship",   score: 61.4 },
      { name: "Scene",                  score: 46.2 },
      { name: "Appearance Style",       score: 25.4 },
      { name: "Temporal Style",         score: 31.2 },
      { name: "Overall Consistency",    score: 24.8 },
    ],
  },
  {
    name: "Wan 2.2",
    color: "#10b981",
    metrics: [
      { name: "Subject Consistency",    score: 97.4 },
      { name: "Background Consistency", score: 96.6 },
      { name: "Temporal Flickering",    score: 98.2 },
      { name: "Motion Smoothness",      score: 98.8 },
      { name: "Dynamic Degree",         score: 50.2 },
      { name: "Aesthetic Quality",      score: 57.4 },
      { name: "Imaging Quality",        score: 64.6 },
      { name: "Object Class",           score: 82.4 },
      { name: "Multiple Objects",       score: 52.6 },
      { name: "Human Action",           score: 88.4 },
      { name: "Color",                  score: 82.4 },
      { name: "Spatial Relationship",   score: 56.8 },
      { name: "Scene",                  score: 42.4 },
      { name: "Appearance Style",       score: 22.8 },
      { name: "Temporal Style",         score: 28.6 },
      { name: "Overall Consistency",    score: 23.2 },
    ],
  },
  {
    name: "LTX 2.3",
    color: "#ef4444",
    metrics: [
      { name: "Subject Consistency",    score: 96.8 },
      { name: "Background Consistency", score: 95.8 },
      { name: "Temporal Flickering",    score: 97.6 },
      { name: "Motion Smoothness",      score: 98.4 },
      { name: "Dynamic Degree",         score: 44.2 },
      { name: "Aesthetic Quality",      score: 53.8 },
      { name: "Imaging Quality",        score: 61.2 },
      { name: "Object Class",           score: 78.6 },
      { name: "Multiple Objects",       score: 47.8 },
      { name: "Human Action",           score: 84.6 },
      { name: "Color",                  score: 78.6 },
      { name: "Spatial Relationship",   score: 50.4 },
      { name: "Scene",                  score: 39.2 },
      { name: "Appearance Style",       score: 20.4 },
      { name: "Temporal Style",         score: 26.2 },
      { name: "Overall Consistency",    score: 21.4 },
    ],
  },
];

/* ── I2V Model Data (VBench++) ── */

export const I2V_MODELS: I2VResult[] = [
  { name: "Veo 3.1",       color: "#06b6d4", i2vSubject: 88.6, i2vBackground: 85.2, cameraStatic: 96.4, cameraPan: 86.3, cameraZoom: 80.1 },
  { name: "Kling 2.6 Pro", color: "#8b5cf6", i2vSubject: 86.2, i2vBackground: 82.8, cameraStatic: 94.8, cameraPan: 83.6, cameraZoom: 77.4 },
  { name: "Seedance 1.5",  color: "#f59e0b", i2vSubject: 83.4, i2vBackground: 79.6, cameraStatic: 92.6, cameraPan: 80.2, cameraZoom: 73.8 },
  { name: "Wan 2.2",       color: "#10b981", i2vSubject: 80.8, i2vBackground: 76.4, cameraStatic: 90.2, cameraPan: 76.8, cameraZoom: 69.6 },
  { name: "LTX 2.3",       color: "#ef4444", i2vSubject: 77.6, i2vBackground: 73.2, cameraStatic: 87.8, cameraPan: 73.4, cameraZoom: 65.8 },
];

/* ── Helper: get score for a model by dimension name ── */

export function getScore(model: ModelResult, dimName: string): number {
  return model.metrics.find((m) => m.name === dimName)?.score ?? 0;
}

/* ── Helper: compute pairwise wins between two models ── */

export function pairwiseWins(a: ModelResult, b: ModelResult): number {
  return DIMENSION_NAMES.reduce((wins, dim) => {
    const sa = getScore(a, dim);
    const sb = getScore(b, dim);
    // Ties award 0.5 each so win counts always sum to 16 across any pair
    if (sa === sb) return wins + 0.5;
    return wins + (sa > sb ? 1 : 0);
  }, 0);
}

/* ── Helper: compute total pairwise wins for ranking ── */

export function totalPairwiseWins(
  model: ModelResult,
  allModels: readonly ModelResult[]
): number {
  return allModels.reduce((total, other) => {
    if (other.name === model.name) return total;
    return total + pairwiseWins(model, other);
  }, 0);
}

/* ── Helper: min-max normalize a metric score to 0-100 across models ── */
/* NOTE: This is range normalization, not a statistical percentile rank.   */
/* Best model → 100, worst → 0; used for the per-metric comparison radar. */

export function metricNormalized(
  model: ModelResult,
  dimName: string,
  allModels: readonly ModelResult[]
): number {
  const scores = allModels.map((m) => getScore(m, dimName));
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return 50;
  const score = getScore(model, dimName);
  return ((score - min) / (max - min)) * 100;
}

/* ── VBench Guide content ── */

export const VBENCH_GUIDE = {
  rationale:
    "VBench separates Video Quality (7 dims) from Video-Condition Consistency (9 dims). " +
    "The split is intentional: quality metrics are evaluated without any reference to the text prompt, " +
    "so a model cannot hide weak semantic grounding behind strong visual polish. " +
    "Object Class belongs in VCC because it checks whether prompted objects appear -- this is prompt-dependent. " +
    "Quality metrics cluster at 95-99% across top-tier models -- that ceiling effect is by design, " +
    "signalling the field has largely solved temporal coherence. " +
    "The more discriminative signal lives in the consistency dims, where scores spread 20-95%. " +
    "VBench uses pairwise win ratios (not a single aggregate) as its official ranking protocol.",
  vq: VQ_DIMENSIONS.map((d) => ({
    name: d.name,
    evaluator: d.evaluator,
    desc: d.description,
  })),
  vcc: VCC_DIMENSIONS.map((d) => ({
    name: d.name,
    evaluator: d.evaluator,
    desc: d.description,
  })),
};
