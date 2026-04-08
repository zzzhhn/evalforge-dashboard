import { promises as fs } from "fs";
import path from "path";
import Link from "next/link";
import { Video, Bot, ArrowRight } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import MiniRadarPreview from "./MiniRadarPreview";
import MiniPiePreview from "./MiniPiePreview";

interface VideoMetric {
  mean: number;
  std: number;
  baseline: number;
  delta: number;
}

interface VideoModel {
  name: string;
  overall_score: number;
  grade: string;
  metrics: Record<string, VideoMetric>;
}

interface VideoData {
  metadata: { total_prompts: number };
  models: VideoModel[];
}

interface IntentEntry {
  count: number;
  percentage: number;
}

interface AgentData {
  metadata: { total_conversations: number; total_turns: number };
  intent_distribution: Record<string, IntentEntry>;
  quality_scores: { overall: Record<string, number> };
}

async function loadData() {
  const videoPath = path.join(process.cwd(), "public/data/video_results.json");
  const agentPath = path.join(process.cwd(), "public/data/agent_results.json");
  const [videoRaw, agentRaw] = await Promise.all([
    fs.readFile(videoPath, "utf-8"),
    fs.readFile(agentPath, "utf-8"),
  ]);
  return {
    video: JSON.parse(videoRaw) as VideoData,
    agent: JSON.parse(agentRaw) as AgentData,
  };
}

export default async function HomePage() {
  const { video, agent } = await loadData();

  const sortedModels = [...video.models].sort(
    (a, b) => b.overall_score - a.overall_score
  );
  const bestModel = sortedModels[0];

  const qualityValues = Object.values(agent.quality_scores.overall);
  const avgQuality =
    qualityValues.reduce((sum, v) => sum + v, 0) / qualityValues.length;

  const intentCount = Object.keys(agent.intent_distribution).length;

  const radarPreviewData = Object.entries(bestModel.metrics)
    .slice(0, 9)
    .map(([key, val]) => ({
      metric: key.split("_").map((w) => w[0].toUpperCase()).join(""),
      value: val.mean * 100,
    }));

  const piePreviewData = Object.entries(agent.intent_distribution).map(
    ([key, val]) => ({ name: key, value: val.percentage })
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      {/* Hero */}
      <section className="mb-16 text-center">
        <h1 className="text-5xl font-extrabold tracking-tight text-text-primary">
          EvalForge Dashboard
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
          Unified evaluation results for generative video models and
          conversational agents
        </p>
      </section>

      {/* Track Cards */}
      <section className="mb-16 grid gap-6 md:grid-cols-2">
        <Link
          href="/video"
          className="group glass-card p-6 transition-all hover:border-accent-cyan/40 hover:shadow-lg hover:shadow-accent-cyan/5"
        >
          <div className="flex items-center gap-3 text-accent-cyan">
            <Video className="h-6 w-6" />
            <h2 className="text-xl font-bold">Video Track</h2>
            <ArrowRight className="ml-auto h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            {video.models.length} models &middot; 9 metrics &middot;{" "}
            {video.metadata.total_prompts} prompts
          </p>
          <MiniRadarPreview data={radarPreviewData} />
        </Link>

        <Link
          href="/agent"
          className="group glass-card p-6 transition-all hover:border-violet-500/40 hover:shadow-lg hover:shadow-violet-500/5"
        >
          <div className="flex items-center gap-3 text-violet-400">
            <Bot className="h-6 w-6" />
            <h2 className="text-xl font-bold">Agent Track</h2>
            <ArrowRight className="ml-auto h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            {agent.metadata.total_conversations} conversations &middot;{" "}
            {agent.metadata.total_turns} turns &middot; {intentCount} intent
            categories
          </p>
          <MiniPiePreview data={piePreviewData} />
        </Link>
      </section>

      {/* Key Highlights */}
      <section>
        <h2 className="mb-6 text-2xl font-bold text-text-primary">
          Key Highlights
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Models Evaluated"
            value={video.models.length}
            subtitle="Generative video models"
            accentColor="text-accent-cyan"
          />
          <StatCard
            label="Total Prompts"
            value={video.metadata.total_prompts}
            subtitle="Across all categories"
            accentColor="text-violet-400"
          />
          <StatCard
            label="Avg Quality Score"
            value={`${(avgQuality * 100).toFixed(1)}%`}
            subtitle="Agent response quality"
            accentColor="text-accent-emerald"
          />
          <StatCard
            label="Best Performer"
            value={bestModel.name}
            subtitle={`Overall: ${(bestModel.overall_score * 100).toFixed(1)}%`}
            accentColor="text-accent-amber"
          />
        </div>
      </section>
    </div>
  );
}
