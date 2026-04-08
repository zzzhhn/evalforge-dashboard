import { promises as fs } from "fs";
import path from "path";
import { GradeChip } from "@/components/GradeChip";
import VideoCharts from "./VideoCharts";

interface MetricData {
  mean: number;
  std: number;
  baseline: number;
  delta: number;
}

interface CategoryBreakdown {
  sample_count: number;
  overall: number;
  metrics: Record<string, number>;
}

interface Model {
  name: string;
  provider: string;
  overall_score: number;
  grade: string;
  metrics: Record<string, MetricData>;
  category_breakdown: Record<string, CategoryBreakdown>;
}

interface VideoData {
  metadata: {
    pipeline: string;
    track: string;
    total_prompts: number;
    evaluation_date: string;
  };
  models: Model[];
}

function formatLabel(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function loadVideoData(): Promise<VideoData> {
  const filePath = path.join(process.cwd(), "public/data/video_results.json");
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as VideoData;
}

export default async function VideoPage() {
  const data = await loadVideoData();
  const sortedModels = [...data.models].sort(
    (a, b) => b.overall_score - a.overall_score
  );
  const metrics = Object.keys(data.models[0].metrics);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-text-primary">
          Video Evaluation Dashboard
        </h1>
        <p className="mt-2 text-text-secondary">
          {data.metadata.pipeline} &middot; {data.metadata.total_prompts}{" "}
          prompts &middot; Evaluated {data.metadata.evaluation_date}
        </p>
      </div>

      {/* Model Rankings Table */}
      <section className="glass-card p-6 mb-8 overflow-x-auto">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Model Rankings
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2 text-left text-text-secondary font-medium">
                #
              </th>
              <th className="px-3 py-2 text-left text-text-secondary font-medium">
                Model
              </th>
              <th className="px-3 py-2 text-left text-text-secondary font-medium">
                Provider
              </th>
              <th className="px-3 py-2 text-center text-text-secondary font-medium">
                Grade
              </th>
              <th className="px-3 py-2 text-right text-text-secondary font-medium">
                Overall
              </th>
              {metrics.map((m) => (
                <th
                  key={m}
                  className="px-2 py-2 text-right text-text-secondary font-medium text-xs"
                >
                  {formatLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedModels.map((model, idx) => (
              <tr
                key={model.name}
                className="border-b border-border-subtle last:border-0 hover:bg-bg-card-hover transition-colors"
              >
                <td className="px-3 py-3 text-text-muted font-mono">
                  {idx + 1}
                </td>
                <td className="px-3 py-3 font-medium text-text-primary">
                  {model.name}
                </td>
                <td className="px-3 py-3 text-text-muted text-xs">
                  {model.provider}
                </td>
                <td className="px-3 py-3 text-center">
                  <GradeChip grade={model.grade} />
                </td>
                <td className="px-3 py-3 text-right score-display font-bold text-accent-cyan">
                  {(model.overall_score * 100).toFixed(1)}
                </td>
                {metrics.map((m) => (
                  <td
                    key={m}
                    className="px-2 py-3 text-right font-mono text-xs text-text-secondary"
                  >
                    {(model.metrics[m].mean * 100).toFixed(1)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Client-side charts */}
      <VideoCharts models={sortedModels} metrics={metrics} />
    </div>
  );
}
