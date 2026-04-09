import { ExternalLink } from "lucide-react";
import {
  VQ_DIMENSIONS,
  VCC_DIMENSIONS,
} from "@/data/vbench";
import {
  QUALITY_DIMS,
  DIM_LABELS,
  DIM_DESC,
} from "@/data/agent";

const PIPELINE_STAGES = [
  {
    step: 1,
    title: "Prompt Generation",
    description:
      "LLM-powered prompt generation with category-aware templates for video and agent tasks.",
  },
  {
    step: 2,
    title: "Content Generation",
    description:
      "Multi-provider API orchestration to generate videos (Veo, Kling, Seedance, etc.) or agent conversations.",
  },
  {
    step: 3,
    title: "Classification",
    description:
      "Intent classification for agent turns and category tagging for video prompts using LLM judges.",
  },
  {
    step: 4,
    title: "Evaluation",
    description:
      "VBench 1.0 metrics for video quality (16 dims); 8-dimension LLM-as-judge for agent responses.",
  },
  {
    step: 5,
    title: "Analysis & Reporting",
    description:
      "Statistical aggregation, pairwise win-rate rankings, and formatted reports with visualizations.",
  },
] as const;

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-extrabold text-text-primary mb-2">
        About EvalForge
      </h1>
      <p className="text-text-secondary mb-12">
        An open-source, extensible evaluation framework for generative AI
        systems.
      </p>

      {/* Pipeline Architecture */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-text-primary mb-6">
          Pipeline Architecture
        </h2>
        <div className="relative">
          {PIPELINE_STAGES.map((stage, i) => (
            <div key={stage.step} className="flex gap-4 mb-1 last:mb-0">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-accent-blue/20 text-accent-blue flex items-center justify-center text-sm font-bold shrink-0">
                  {stage.step}
                </div>
                {i < PIPELINE_STAGES.length - 1 && (
                  <div className="w-px flex-1 bg-border-subtle my-1" />
                )}
              </div>
              <div className="glass-card p-4 flex-1 mb-3">
                <h3 className="font-semibold text-text-primary text-sm">
                  {stage.title}
                </h3>
                <p className="text-xs text-text-secondary mt-1">
                  {stage.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Video Evaluation Methodology */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-text-primary mb-2">
          Video Evaluation Methodology
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          Video quality is assessed using the official VBench 1.0 protocol
          (CVPR 2024): 16 dimensions split into 7 Video Quality and 9
          Video-Condition Consistency metrics. Rankings use pairwise win-rate
          matrices — not a single composite score — matching the VBench paper.
        </p>

        <h3 className="text-sm font-semibold text-accent-cyan mb-3">
          Video Quality ({VQ_DIMENSIONS.length} dimensions)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 mb-6">
          {VQ_DIMENSIONS.map((dim) => (
            <div key={dim.name} className="glass-card p-4">
              <h4 className="text-sm font-semibold text-accent-cyan">
                {dim.name}
              </h4>
              <p className="text-xs text-text-muted mt-1">{dim.description}</p>
              <p className="text-xs text-text-tertiary mt-1 font-mono">
                Evaluator: {dim.evaluator}
              </p>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-violet-400 mb-3">
          Video-Condition Consistency ({VCC_DIMENSIONS.length} dimensions)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {VCC_DIMENSIONS.map((dim) => (
            <div key={dim.name} className="glass-card p-4">
              <h4 className="text-sm font-semibold text-violet-400">
                {dim.name}
              </h4>
              <p className="text-xs text-text-muted mt-1">{dim.description}</p>
              <p className="text-xs text-text-tertiary mt-1 font-mono">
                Evaluator: {dim.evaluator}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Agent Evaluation Methodology */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-text-primary mb-2">
          Agent Evaluation Methodology
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          Agent conversations are classified into 7 intent categories. Each
          response is evaluated by an LLM judge across{" "}
          {QUALITY_DIMS.length} quality dimensions (inspired by MT-Bench and
          AlpacaEval 2.0), scored 0-100 with 5-shot calibration, then
          aggregated per intent and globally.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {QUALITY_DIMS.map((dim) => (
            <div key={dim} className="glass-card p-4">
              <h3 className="text-sm font-semibold text-violet-400">
                {DIM_LABELS[dim]}
              </h3>
              <p className="text-xs text-text-muted mt-1">{DIM_DESC[dim]}</p>
            </div>
          ))}
        </div>
      </section>

      {/* GitHub Link */}
      <section className="glass-card p-6 text-center">
        <h2 className="text-lg font-bold text-text-primary mb-2">
          Open Source
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          EvalForge is open-source. Contributions, feedback, and new evaluation
          tracks are welcome.
        </p>
        <a
          href="https://github.com/zzzhhn/evalforge"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-blue/15 text-accent-blue font-medium text-sm hover:bg-accent-blue/25 transition-colors"
        >
          View on GitHub
          <ExternalLink className="h-4 w-4" />
        </a>
      </section>
    </div>
  );
}
