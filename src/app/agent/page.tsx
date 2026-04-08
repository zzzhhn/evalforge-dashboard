import { promises as fs } from "fs";
import path from "path";
import AgentCharts from "./AgentCharts";

interface IntentEntry {
  count: number;
  percentage: number;
}

interface QualityScores {
  overall: Record<string, number>;
  by_intent: Record<string, Record<string, number>>;
}

interface AgentData {
  metadata: {
    pipeline: string;
    total_conversations: number;
    total_turns: number;
    evaluation_date: string;
  };
  intent_distribution: Record<string, IntentEntry>;
  quality_scores: QualityScores;
  output_format_distribution: Record<string, number>;
  negative_feedback: {
    rate: number;
    causes: Record<string, number>;
  };
}

function formatIntentLabel(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function loadAgentData(): Promise<AgentData> {
  const filePath = path.join(process.cwd(), "public/data/agent_results.json");
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as AgentData;
}

export default async function AgentPage() {
  const data = await loadAgentData();

  const intentData = Object.entries(data.intent_distribution).map(
    ([key, val]) => ({
      name: formatIntentLabel(key),
      count: val.count,
      percentage: val.percentage,
    })
  );

  const qualityDimensions = Object.entries(data.quality_scores.overall).map(
    ([key, val]) => ({
      dimension: key.charAt(0).toUpperCase() + key.slice(1),
      score: val * 100,
    })
  );

  const qualityByIntent = Object.entries(data.quality_scores.by_intent).map(
    ([intent, scores]) => ({
      intent: formatIntentLabel(intent),
      coverage: scores.coverage * 100,
      relevance: scores.relevance * 100,
      executability: scores.executability * 100,
      practicality: scores.practicality * 100,
    })
  );

  const formatData = Object.entries(data.output_format_distribution).map(
    ([format, percentage]) => ({ format, percentage })
  );

  const causesTotal = Object.values(data.negative_feedback.causes).reduce(
    (sum, v) => sum + v,
    0
  );
  const feedbackCauses = Object.entries(data.negative_feedback.causes).map(
    ([cause, count]) => ({
      cause,
      percentage: causesTotal > 0 ? (count / causesTotal) * 100 : 0,
    })
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-text-primary">
          Agent Evaluation Dashboard
        </h1>
        <p className="mt-2 text-text-secondary">
          {data.metadata.pipeline} &middot;{" "}
          {data.metadata.total_conversations} conversations &middot;{" "}
          {data.metadata.total_turns} turns &middot; Evaluated{" "}
          {data.metadata.evaluation_date}
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {qualityDimensions.map((dim) => (
          <div key={dim.dimension} className="glass-card p-4">
            <p className="text-sm text-text-secondary">{dim.dimension}</p>
            <p className="mt-1 score-display text-2xl font-bold text-violet-400">
              {dim.score.toFixed(1)}%
            </p>
          </div>
        ))}
      </div>

      {/* Client-side charts */}
      <AgentCharts
        intentData={intentData}
        qualityDimensions={qualityDimensions}
        qualityByIntent={qualityByIntent}
        formatData={formatData}
        feedbackRate={data.negative_feedback.rate}
        feedbackCauses={feedbackCauses}
      />
    </div>
  );
}
