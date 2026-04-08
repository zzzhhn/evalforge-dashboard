import { ExternalLink } from "lucide-react";

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
      "VBench-based metrics for video quality; multi-dimensional quality scoring for agent responses.",
  },
  {
    step: 5,
    title: "Analysis & Reporting",
    description:
      "Statistical aggregation, comparative rankings, and formatted reports with visualizations.",
  },
] as const;

const VIDEO_METRICS = [
  {
    name: "Subject Consistency",
    description: "How well the main subject maintains identity across frames.",
  },
  {
    name: "Background Consistency",
    description: "Stability and coherence of background elements over time.",
  },
  {
    name: "Temporal Flickering",
    description: "Absence of unnatural brightness or color fluctuations between frames.",
  },
  {
    name: "Motion Smoothness",
    description: "Natural flow and continuity of movement without jitter.",
  },
  {
    name: "Dynamic Degree",
    description: "Amount and variety of meaningful motion in the generated video.",
  },
  {
    name: "Aesthetic Quality",
    description: "Visual appeal, composition, and artistic quality of individual frames.",
  },
  {
    name: "Imaging Quality",
    description: "Technical quality including sharpness, noise, and artifact absence.",
  },
  {
    name: "Overall Consistency",
    description: "Holistic coherence of the video as a unified visual narrative.",
  },
  {
    name: "Text Alignment",
    description: "Faithfulness of the generated video to the input text prompt.",
  },
] as const;

const AGENT_DIMENSIONS = [
  {
    name: "Coverage",
    description:
      "Completeness of the response in addressing all aspects of the user query.",
  },
  {
    name: "Relevance",
    description:
      "How directly the response addresses the specific question or task at hand.",
  },
  {
    name: "Executability",
    description:
      "Whether code, instructions, or suggestions can be directly executed or applied.",
  },
  {
    name: "Practicality",
    description:
      "Real-world applicability and usefulness of the provided answer.",
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
              {/* Connector line */}
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
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Video Evaluation Methodology
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          Video quality is assessed using 9 VBench-inspired metrics, each scored
          on a 0-1 scale. Scores are compared against baseline values derived
          from prior-generation models. The 5 evaluation categories (Narrative,
          Subject, Environment, Motion, Style) aggregate subsets of these
          metrics for domain-specific analysis.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {VIDEO_METRICS.map((metric) => (
            <div key={metric.name} className="glass-card p-4">
              <h3 className="text-sm font-semibold text-accent-cyan">
                {metric.name}
              </h3>
              <p className="text-xs text-text-muted mt-1">
                {metric.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Agent Evaluation Methodology */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Agent Evaluation Methodology
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          Agent conversations are classified into 7 intent categories (QA,
          Code Development, Content Generation, Data Analysis, Tool Action,
          Task Planning, Translation). Each response is evaluated by an LLM
          judge across 4 quality dimensions, then aggregated per intent and
          overall.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {AGENT_DIMENSIONS.map((dim) => (
            <div key={dim.name} className="glass-card p-4">
              <h3 className="text-sm font-semibold text-violet-400">
                {dim.name}
              </h3>
              <p className="text-xs text-text-muted mt-1">
                {dim.description}
              </p>
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
          href="https://github.com/BobbyZhong/evalforge"
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
