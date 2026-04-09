/* ──────────────────────────────────────────────────────────────────
   VBench 2.0 (arXiv 2503.21755, Mar 2025) — Intrinsic Faithfulness

   18 dimensions across 5 broad categories:
     1. Human Fidelity  (3): anatomy, clothes, identity
     2. Creativity      (2): diversity, composition
     3. Controllability (7): spatial, attribute, motion order,
                             human interaction, landscape, plot, camera
     4. Physics         (4): mechanics, thermotics, material, multi-view
     5. Commonsense     (2): motion rationality, instance preservation

   All scores are REAL, taken directly from Table 2 of the paper.
   Models evaluated: HunyuanVideo, CogVideoX-1.5, Sora-480p, Kling 1.6.

   VBench 2.0 complements VBench 1.0 (superficial faithfulness) by
   evaluating intrinsic faithfulness — physics, commonsense, creativity.
   Ranking uses pairwise win ratios, not a single aggregate score.
   ────────────────────────────────────────────────────────────────── */

export type VBench2Category =
  | "Human Fidelity"
  | "Creativity"
  | "Controllability"
  | "Physics"
  | "Commonsense";

export interface VBenchDimension {
  name: string;
  category: VBench2Category;
  evaluator: string;
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
  videoLength: string;
  resolution: string;
  fps: number;
  metrics: MetricScore[];
}

/* ── 18 VBench 2.0 Dimensions ── */

export const VBENCH_DIMENSIONS: VBenchDimension[] = [
  /* ── Human Fidelity (3) ── */
  {
    name: "Human Anatomy",
    category: "Human Fidelity",
    evaluator: "ViT anomaly detector (150K real+generated frames)",
    description:
      "Structural correctness of human figures — identifies unnatural deformations in hands, faces, and bodies using anomaly detection models trained on curated real and AI-generated human frames.",
  },
  {
    name: "Human Clothes",
    category: "Human Fidelity",
    evaluator: "Video-based multi-question answering (VQA)",
    description:
      "Temporal consistency of clothing — ensures outfits remain stable throughout the video, evaluated via video-based multi-question answering pipeline.",
    note: "Temporal consistency of clothing appearance across frames",
  },
  {
    name: "Human Identity",
    category: "Human Fidelity",
    evaluator: "ArcFace + RetinaFace",
    description:
      "Temporal consistency of human identity — measured by facial feature similarity using ArcFace embeddings, with face detection by RetinaFace.",
    note: "Face ID consistency tracked frame-by-frame",
  },

  /* ── Creativity (2) ── */
  {
    name: "Diversity",
    category: "Creativity",
    evaluator: "VGG-19 feature representations",
    description:
      "Inter-sample variation for the same prompt — measures style and content diversity across 20 sampled videos using pre-trained VGG-19 feature representations.",
  },
  {
    name: "Composition",
    category: "Creativity",
    evaluator: "Structured VQA pipeline",
    description:
      "Ability to compose species combinations, single-entity actions, and multi-entity interactions. Assesses whether the model can generate novel and uncommon compositions.",
  },

  /* ── Controllability (7) ── */
  {
    name: "Dynamic Spatial Relationship",
    category: "Controllability",
    evaluator: "Video-based multi-question answering",
    description:
      "Whether models accurately reposition objects in response to spatial instructions (e.g., 'A dog is on the left of a sofa, then the dog runs to the front'). Single-entity disentangled prompts.",
    note: "Entity sub-dimension — spatial repositioning accuracy",
  },
  {
    name: "Dynamic Attribute",
    category: "Controllability",
    evaluator: "Video-based multi-question answering",
    description:
      "Whether models can modify entity attributes (color, size, texture) mid-video as instructed. Tested with disentangled single-attribute-change prompts.",
    note: "Entity sub-dimension — mid-video attribute changes",
  },
  {
    name: "Motion Order Understanding",
    category: "Controllability",
    evaluator: "Text description alignment (VLM + LLM)",
    description:
      "Whether models generate several actions or motions in the specified order. Uses text description alignment pipeline to verify motion sequence matches the prompt.",
    note: "Event sub-dimension — action sequence ordering",
  },
  {
    name: "Human Interaction",
    category: "Controllability",
    evaluator: "Text description alignment (VLM + LLM)",
    description:
      "Whether two humans can interact as prompted (e.g., 'One person hands an object to another'). Prompts require physical contact interactions, not ambiguous social scenarios.",
    note: "Event sub-dimension — physical contact interactions",
  },
  {
    name: "Complex Landscape",
    category: "Controllability",
    evaluator: "Text description alignment",
    description:
      "Whether models faithfully follow long-form landscape descriptions (150+ words) including multiple scene transitions driven by camera movements.",
    note: "Content sub-dimension — long-form landscape adherence",
  },
  {
    name: "Complex Plot",
    category: "Controllability",
    evaluator: "Text description alignment",
    description:
      "Ability to construct multi-scene narratives from prompts describing multi-stage events (e.g., a four-act story with 150+ words). Tests plot consistency.",
    note: "Content sub-dimension — multi-scene narrative fidelity",
  },
  {
    name: "Camera Motion",
    category: "Controllability",
    evaluator: "CoTracker-v2 + heuristics",
    description:
      "Whether specified camera movements are generated. Extends VBench++ taxonomy to 9 types including 'Orbit' and 'Oblique shot'. Assessed via point tracking with CoTracker-v2.",
  },

  /* ── Physics (4) ── */
  {
    name: "Mechanics",
    category: "Physics",
    evaluator: "Video-based multi-question answering",
    description:
      "Whether models simulate basic mechanical physics — gravity, buoyancy, and stress. Uses GPT-4o-generated visual descriptions of expected physical behavior as reference.",
    note: "State Change sub-dimension — gravity, buoyancy, stress",
  },
  {
    name: "Thermotics",
    category: "Physics",
    evaluator: "Video-based multi-question answering",
    description:
      "Whether models simulate state transitions such as vaporization, liquefaction, and sublimation. Temperature-specific prompts (e.g., dry ice at -90°C).",
    note: "State Change sub-dimension — thermal state transitions",
  },
  {
    name: "Material",
    category: "Physics",
    evaluator: "Video-based multi-question answering",
    description:
      "Whether models correctly depict color mixing, hardness, combustion, and solubility. Tests material property adherence via structured questioning.",
    note: "State Change sub-dimension — material property behavior",
  },
  {
    name: "Multi-View Consistency",
    category: "Physics",
    evaluator: "SIFT + FLANN + RANSAC + RAFT",
    description:
      "3D geometric consistency — ensures objects retain structural consistency across different angles using feature matching stability and camera motion speed compensation.",
    note: "Geometry sub-dimension — structural consistency across viewpoints",
  },

  /* ── Commonsense (2) ── */
  {
    name: "Motion Rationality",
    category: "Commonsense",
    evaluator: "Video-based multi-question answering",
    description:
      "Whether generated motion leads to correct real-world consequences. Detects 'fake' motions: fake eating (food unchanged), fake walking (not moving forward), fake cutting (object intact).",
  },
  {
    name: "Instance Preservation",
    category: "Commonsense",
    evaluator: "YOLO-World frame-by-frame",
    description:
      "Whether object counts remain stable throughout the video. Detects unnatural merging, duplication, or disappearance using YOLO-World open-vocabulary detection frame-by-frame.",
  },
];

/* ── Category exports ── */

export const CATEGORIES: VBench2Category[] = [
  "Human Fidelity",
  "Creativity",
  "Controllability",
  "Physics",
  "Commonsense",
];

export const CATEGORY_COLORS: Record<VBench2Category, string> = {
  "Human Fidelity":  "#ec4899",
  "Creativity":      "#8b5cf6",
  "Controllability": "#06b6d4",
  "Physics":         "#f59e0b",
  "Commonsense":     "#10b981",
};

export function dimsByCategory(cat: VBench2Category): VBenchDimension[] {
  return VBENCH_DIMENSIONS.filter((d) => d.category === cat);
}

/* ── Grading (adapted for VBench 2.0 score ranges) ── */

export const GRADE_COLORS: Record<string, string> = {
  Excellent:           "#10b981",
  Good:                "#6366f1",
  Moderate:            "#f59e0b",
  "Needs Improvement": "#ef4444",
};

export function gradeMetric(name: string, score: number): string {
  /* VBench 2.0 scores span very wide ranges; grade relative to
     the dimension's empirical distribution from Table 2 */
  const dimScores = T2V_MODELS.map((m) => getScore(m, name));
  const max = Math.max(...dimScores);
  const min = Math.min(...dimScores);
  const range = max - min || 1;
  const pct = (score - min) / range;
  if (pct >= 0.85) return "Excellent";
  if (pct >= 0.5) return "Good";
  if (pct >= 0.2) return "Moderate";
  return "Needs Improvement";
}

export const METRIC_NOTES: Record<string, string> = Object.fromEntries(
  VBENCH_DIMENSIONS.filter((d) => d.note != null).map((d) => [d.name, d.note!])
);

/* ── Dimension name list (ordered) ── */

export const DIMENSION_NAMES = VBENCH_DIMENSIONS.map((d) => d.name);

/* ══════════════════════════════════════════════════════════════════
   T2V Model Data — ALL scores from Table 2 of VBench 2.0 paper
   (arXiv 2503.21755, Zheng et al., Mar 2025)

   Scores are percentages (0-100). These are REAL published values.
   ══════════════════════════════════════════════════════════════════ */

export const T2V_MODELS: ModelResult[] = [
  {
    name: "HunyuanVideo",
    color: "#ec4899",
    videoLength: "5.3s",
    resolution: "720×1280",
    fps: 24,
    metrics: [
      /* Human Fidelity */
      { name: "Human Anatomy",              score: 88.58 },
      { name: "Human Clothes",              score: 82.97 },
      { name: "Human Identity",             score: 75.67 },
      /* Creativity */
      { name: "Diversity",                  score: 39.73 },
      { name: "Composition",                score: 43.96 },
      /* Controllability */
      { name: "Dynamic Spatial Relationship", score: 21.26 },
      { name: "Dynamic Attribute",          score: 22.71 },
      { name: "Motion Order Understanding", score: 26.60 },
      { name: "Human Interaction",          score: 67.67 },
      { name: "Complex Landscape",          score: 19.56 },
      { name: "Complex Plot",               score: 10.11 },
      { name: "Camera Motion",              score: 33.95 },
      /* Physics */
      { name: "Mechanics",                  score: 76.09 },
      { name: "Thermotics",                 score: 56.52 },
      { name: "Material",                   score: 64.37 },
      { name: "Multi-View Consistency",     score: 43.80 },
      /* Commonsense */
      { name: "Motion Rationality",         score: 34.48 },
      { name: "Instance Preservation",      score: 73.79 },
    ],
  },
  {
    name: "CogVideoX-1.5",
    color: "#8b5cf6",
    videoLength: "10.1s",
    resolution: "768×1360",
    fps: 16,
    metrics: [
      { name: "Human Anatomy",              score: 59.72 },
      { name: "Human Clothes",              score: 87.18 },
      { name: "Human Identity",             score: 69.51 },
      { name: "Diversity",                  score: 42.61 },
      { name: "Composition",                score: 44.70 },
      { name: "Dynamic Spatial Relationship", score: 19.32 },
      { name: "Dynamic Attribute",          score: 24.18 },
      { name: "Motion Order Understanding", score: 26.94 },
      { name: "Human Interaction",          score: 73.00 },
      { name: "Complex Landscape",          score: 23.11 },
      { name: "Complex Plot",               score: 12.42 },
      { name: "Camera Motion",              score: 33.33 },
      { name: "Mechanics",                  score: 80.80 },
      { name: "Thermotics",                 score: 67.13 },
      { name: "Material",                   score: 83.19 },
      { name: "Multi-View Consistency",     score: 21.79 },
      { name: "Motion Rationality",         score: 33.91 },
      { name: "Instance Preservation",      score: 71.03 },
    ],
  },
  {
    name: "Sora-480p",
    color: "#06b6d4",
    videoLength: "5.0s",
    resolution: "480×854",
    fps: 30,
    metrics: [
      { name: "Human Anatomy",              score: 86.45 },
      { name: "Human Clothes",              score: 98.15 },
      { name: "Human Identity",             score: 78.57 },
      { name: "Diversity",                  score: 67.48 },
      { name: "Composition",                score: 53.65 },
      { name: "Dynamic Spatial Relationship", score: 19.81 },
      { name: "Dynamic Attribute",          score: 8.06 },
      { name: "Motion Order Understanding", score: 14.81 },
      { name: "Human Interaction",          score: 59.00 },
      { name: "Complex Landscape",          score: 14.67 },
      { name: "Complex Plot",               score: 11.67 },
      { name: "Camera Motion",              score: 27.16 },
      { name: "Mechanics",                  score: 62.22 },
      { name: "Thermotics",                 score: 43.36 },
      { name: "Material",                   score: 64.94 },
      { name: "Multi-View Consistency",     score: 58.22 },
      { name: "Motion Rationality",         score: 34.48 },
      { name: "Instance Preservation",      score: 74.60 },
    ],
  },
  {
    name: "Kling 1.6",
    color: "#f59e0b",
    videoLength: "10.0s",
    resolution: "720×1280",
    fps: 24,
    metrics: [
      { name: "Human Anatomy",              score: 86.99 },
      { name: "Human Clothes",              score: 91.75 },
      { name: "Human Identity",             score: 71.95 },
      { name: "Diversity",                  score: 53.26 },
      { name: "Composition",                score: 43.89 },
      { name: "Dynamic Spatial Relationship", score: 20.77 },
      { name: "Dynamic Attribute",          score: 19.41 },
      { name: "Motion Order Understanding", score: 29.29 },
      { name: "Human Interaction",          score: 72.67 },
      { name: "Complex Landscape",          score: 18.44 },
      { name: "Complex Plot",               score: 11.83 },
      { name: "Camera Motion",              score: 61.73 },
      { name: "Mechanics",                  score: 65.55 },
      { name: "Thermotics",                 score: 59.46 },
      { name: "Material",                   score: 68.00 },
      { name: "Multi-View Consistency",     score: 64.38 },
      { name: "Motion Rationality",         score: 38.51 },
      { name: "Instance Preservation",      score: 76.10 },
    ],
  },
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

/* ── VBench 2.0 Guide content ── */

export const VBENCH_GUIDE = {
  rationale:
    "VBench 2.0 evaluates intrinsic faithfulness — whether generated videos adhere to " +
    "physical laws, commonsense reasoning, anatomical correctness, and compositional integrity. " +
    "It complements VBench 1.0 (superficial faithfulness: per-frame aesthetics, temporal consistency) " +
    "by probing deeper capabilities across 5 broad categories and 18 fine-grained dimensions. " +
    "Evaluation combines generalist VLM/LLM reasoning with specialist detectors (anomaly detection, " +
    "point tracking, object detection). Rankings use pairwise win ratios, not a single aggregate score. " +
    "All scores below are from Table 2 of the VBench 2.0 paper (arXiv 2503.21755, Mar 2025).",
  categories: CATEGORIES.map((cat) => ({
    name: cat,
    color: CATEGORY_COLORS[cat],
    dims: dimsByCategory(cat).map((d) => ({
      name: d.name,
      evaluator: d.evaluator,
      desc: d.description,
    })),
  })),
};
