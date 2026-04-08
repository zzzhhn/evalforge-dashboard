import Link from "next/link";
import { Video, Bot, ArrowRight } from "lucide-react";
import MermaidDiagram from "@/components/MermaidDiagram";

const VIDEO_STATS = {
  models: 5,
  dims: 16,
  prompts: 200,
  bestModel: "Veo 3.1",
  bestScore: "82.1",
  radarPoints: [
    { metric: "TC", value: 96 },
    { metric: "MQ", value: 82 },
    { metric: "VF", value: 78 },
    { metric: "OR", value: 75 },
    { metric: "AS", value: 73 },
    { metric: "CS", value: 70 },
    { metric: "SA", value: 28 },
  ],
};

const AGENT_STATS = {
  conversations: 500,
  turns: 3600,
  intents: 7,
  avgQuality: "86.3",
  piePoints: [
    { name: "Information Query", value: 28.4, color: "#6366f1" },
    { name: "Task Execution",    value: 19.6, color: "#10b981" },
    { name: "Code Generation",   value: 16.6, color: "#ec4899" },
    { name: "Creative Writing",  value: 13.4, color: "#f59e0b" },
    { name: "Analysis",          value: 10.8, color: "#8b5cf6" },
    { name: "Conversation",      value:  7.6, color: "#06b6d4" },
    { name: "Translation",       value:  3.6, color: "#84cc16" },
  ],
};

const T2V_PIPELINE = [
  "flowchart LR",
  "    input([Prompt Dataset]):::io --> s1",
  '    s1["Stage 1: Classify\\nLLM taxonomy · hash cache\\n7 prompt categories"] --> s2',
  '    s2["Stage 2: Generate\\nasync · per-provider semaphore\\nN-run retry · checkpoint"] --> s3',
  '    s3["Stage 3: Evaluate\\nVBench 1.0 · 16 metrics\\n+ VBench++ I2V dims"] --> s4',
  '    s4["Stage 4: Analyze\\npercentile normalise\\ncross-model ranking"] --> s5',
  '    s5["Stage 5: Report\\nJSON · DOCX · HTML"]:::out --> output([Interactive Dashboard]):::io',
  "    providers([Model Providers\\nKling · Veo · Runway · Pika]):::ext --> s2",
  "    vbench([VBench Evaluator\\noptional GPU server]):::ext --> s3",
  "    classDef io fill:#6366f11a,stroke:#6366f1,color:#a5b4fc",
  "    classDef ext fill:#10b9811a,stroke:#10b981,color:#6ee7b7",
  "    classDef out fill:#f59e0b1a,stroke:#f59e0b,color:#fcd34d",
].join("\n");

const AGENT_PIPELINE = [
  "flowchart LR",
  "    input([Conversations\\n500 sessions · JSONL]):::io --> s1",
  '    s1["Stage 1: Classify Intent\\n7 categories\\nhybrid rules + LLM"] --> s3',
  '    s3["Stage 3: LLM Judge\\n5 dimensions\\n5-shot calibration"] --> s4',
  '    s4["Stage 4: Aggregate\\nturn → session\\n→ intent category"] --> s5',
  '    s5["Stage 5: Report\\nheatmaps · radar · JSON"]:::out --> output([Intent + Quality Profiles]):::io',
  "    llm([LLM Backend\\nGemma 4 local or\\nOpenAI-compat API]):::ext --> s1",
  "    llm --> s3",
  "    classDef io fill:#6366f11a,stroke:#6366f1,color:#a5b4fc",
  "    classDef ext fill:#10b9811a,stroke:#10b981,color:#6ee7b7",
  "    classDef out fill:#f59e0b1a,stroke:#f59e0b,color:#fcd34d",
].join("\n");

function MiniRadar({ points }: { points: typeof VIDEO_STATS.radarPoints }) {
  const cx = 60;
  const cy = 60;
  const r = 45;
  const n = points.length;
  const pts = points.map((p, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const scaled = (p.value / 100) * r;
    return [cx + scaled * Math.cos(angle), cy + scaled * Math.sin(angle)];
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + "Z";
  const gridDs = [0.25, 0.5, 0.75, 1].map((frac) => {
    const gPts = points.map((_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const gr = frac * r;
      return [cx + gr * Math.cos(angle), cy + gr * Math.sin(angle)];
    });
    return gPts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + "Z";
  });
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ display: "block", margin: "16px auto 0" }}>
      {gridDs.map((gd, i) => (
        <path key={i} d={gd} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
      ))}
      <path d={d} fill="rgba(56,189,248,0.2)" stroke="#38bdf8" strokeWidth="1.5" />
    </svg>
  );
}

function MiniDonut({ points }: { points: typeof AGENT_STATS.piePoints }) {
  const cx = 60;
  const cy = 60;
  const r = 42;
  const ri = 24;
  const total = points.reduce((s, p) => s + p.value, 0);
  let angle = -Math.PI / 2;
  const slices = points.map((p) => {
    const start = angle;
    const sweep = (p.value / total) * Math.PI * 2;
    angle += sweep;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(start + sweep);
    const y2 = cy + r * Math.sin(start + sweep);
    const xi1 = cx + ri * Math.cos(start);
    const yi1 = cy + ri * Math.sin(start);
    const xi2 = cx + ri * Math.cos(start + sweep);
    const yi2 = cy + ri * Math.sin(start + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    return {
      d: `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${xi2.toFixed(1)},${yi2.toFixed(1)} A${ri},${ri} 0 ${large},0 ${xi1.toFixed(1)},${yi1.toFixed(1)} Z`,
      color: p.color,
    };
  });
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ display: "block", margin: "16px auto 0" }}>
      {slices.map((s, i) => (
        <path key={i} d={s.d} fill={s.color} fillOpacity="0.85" />
      ))}
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      {/* Hero */}
      <section className="mb-16 text-center">
        <h1 className="text-5xl font-extrabold tracking-tight text-[var(--text-primary)]">
          EvalForge Dashboard
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-[var(--text-secondary)]">
          Unified evaluation results for generative video models and
          conversational agents
        </p>
      </section>

      {/* Track Cards */}
      <section className="mb-16 grid gap-6 md:grid-cols-2">
        <Link
          href="/video"
          className="group glass-card p-6 transition-all hover:border-[rgba(56,189,248,0.4)] hover:shadow-lg"
        >
          <div className="flex items-center gap-3 text-[var(--accent-cyan)]">
            <Video className="h-6 w-6" />
            <h2 className="text-xl font-bold">Video Track</h2>
            <ArrowRight className="ml-auto h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {VIDEO_STATS.models} models &middot; {VIDEO_STATS.dims} VBench dims &middot;{" "}
            {VIDEO_STATS.prompts} prompts
          </p>
          <MiniRadar points={VIDEO_STATS.radarPoints} />
        </Link>

        <Link
          href="/agent"
          className="group glass-card p-6 transition-all hover:border-[rgba(139,92,246,0.4)] hover:shadow-lg"
        >
          <div className="flex items-center gap-3 text-[var(--accent-blue)]" style={{ color: "#a78bfa" }}>
            <Bot className="h-6 w-6" />
            <h2 className="text-xl font-bold">Agent Track</h2>
            <ArrowRight className="ml-auto h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {AGENT_STATS.conversations} conversations &middot;{" "}
            {AGENT_STATS.turns} turns &middot; {AGENT_STATS.intents} intent categories
          </p>
          <MiniDonut points={AGENT_STATS.piePoints} />
        </Link>
      </section>

      {/* Pipeline Architecture */}
      <section className="mb-16">
        <h2 className="mb-6 text-2xl font-bold text-[var(--text-primary)]">
          Pipeline Architecture
        </h2>
        <div className="grid gap-6">
          <div className="glass-card p-6">
            <h3 className="mb-4 text-lg font-semibold text-[var(--accent-cyan)]">
              T2V Evaluation Track
            </h3>
            <MermaidDiagram
              chart={T2V_PIPELINE}
              caption="EvalForge T2V track — text-to-video evaluation pipeline"
            />
          </div>
          <div className="glass-card p-6">
            <h3 className="mb-4 text-lg font-semibold" style={{ color: "#a78bfa" }}>
              Agent Evaluation Track
            </h3>
            <MermaidDiagram
              chart={AGENT_PIPELINE}
              caption="EvalForge Agent track — Stage 2 (Generation) is skipped when conversations are pre-collected"
            />
          </div>
        </div>
      </section>

      {/* Key Highlights */}
      <section>
        <h2 className="mb-6 text-2xl font-bold text-[var(--text-primary)]">
          Key Highlights
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "T2V Models Evaluated", value: String(VIDEO_STATS.models), sub: "VBench 1.0 · all 16 dims", color: "var(--accent-cyan)" },
            { label: "VBench Dimensions", value: String(VIDEO_STATS.dims), sub: "Video Quality + Condition Consistency", color: "#a78bfa" },
            { label: "Avg Agent Quality", value: `${AGENT_STATS.avgQuality}%`, sub: "8-dim LLM-as-judge · 5-shot", color: "var(--accent-emerald)" },
            { label: "Best T2V Performer", value: VIDEO_STATS.bestModel, sub: `EvalForge composite ${VIDEO_STATS.bestScore}`, color: "var(--accent-amber)" },
          ].map((card) => (
            <div key={card.label} className="glass-card p-5">
              <p className="text-sm text-[var(--text-muted)]">{card.label}</p>
              <p className="mt-1 text-2xl font-bold" style={{ color: card.color }}>{card.value}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{card.sub}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
