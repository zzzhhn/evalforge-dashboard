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

/* ──────────────────────────────────────────────────────────────────
   Static agent evaluation data produced by the EvalForge pipeline.
   Subject: internal Gemma 4-based conversational assistant (27B,
   fine-tuned on 40K domain-specific instruction pairs).
   500 conversations collected from internal test set; LLM judge
   scoring via Gemma 4 with 5-shot calibration prompts.
   ────────────────────────────────────────────────────────────────── */

interface IntentData {
  name: string;
  count: number;
  color: string;
  quality: {
    coverage: number;
    relevance: number;
    executability: number;
    practicality: number;
    faithfulness: number;
  };
}

const INTENTS: IntentData[] = [
  { name: "Information Query", count: 142, color: "#6366f1",
    quality: { coverage: 88.2, relevance: 91.3, executability: 72.1, practicality: 85.6, faithfulness: 91.2 } },
  { name: "Task Execution",    count: 98,  color: "#10b981",
    quality: { coverage: 82.4, relevance: 86.7, executability: 90.2, practicality: 88.1, faithfulness: 88.6 } },
  { name: "Creative Writing",  count: 67,  color: "#f59e0b",
    quality: { coverage: 79.8, relevance: 84.5, executability: 68.3, practicality: 71.2, faithfulness: 72.3 } },
  { name: "Code Generation",   count: 83,  color: "#ec4899",
    quality: { coverage: 85.6, relevance: 88.9, executability: 91.5, practicality: 86.3, faithfulness: 94.1 } },
  { name: "Analysis",          count: 54,  color: "#8b5cf6",
    quality: { coverage: 90.1, relevance: 87.2, executability: 74.8, practicality: 82.4, faithfulness: 87.5 } },
  { name: "Conversation",      count: 38,  color: "#06b6d4",
    quality: { coverage: 75.3, relevance: 92.1, executability: 65.4, practicality: 78.9, faithfulness: 85.2 } },
  { name: "Translation",       count: 18,  color: "#84cc16",
    quality: { coverage: 86.7, relevance: 93.5, executability: 88.2, practicality: 90.1, faithfulness: 96.8 } },
];

const QUALITY_DIMS = ["coverage", "relevance", "executability", "practicality", "faithfulness"] as const;

const DIM_LABELS: Record<string, string> = {
  coverage:      "Coverage",
  relevance:     "Relevance",
  executability: "Executability",
  practicality:  "Practicality",
  faithfulness:  "Faithfulness",
};

const DIM_DESC: Record<string, string> = {
  coverage:      "Does the response address all aspects of the query?",
  relevance:     "Is the response on-topic and appropriately scoped?",
  executability: "Can the instructions/code be directly acted upon?",
  practicality:  "Is the output actionable in a real-world context?",
  faithfulness:  "Is the response grounded in verifiable facts? (Hallucination rate)",
};

interface ConversationSample {
  id: string;
  intent: string;
  turns: { role: "user" | "agent"; text: string }[];
  scores: {
    coverage: number;
    relevance: number;
    executability: number;
    practicality: number;
    faithfulness: number;
  };
  overallGrade: string;
}

const SAMPLES: ConversationSample[] = [
  {
    id: "conv-0247",
    intent: "Code Generation",
    turns: [
      { role: "user",  text: "Write a Python async function that retries an HTTP request up to 3 times with exponential backoff." },
      { role: "agent", text: "import asyncio\nimport aiohttp\n\nasync def fetch_with_retry(url: str, max_retries: int = 3, base_delay: float = 1.0):\n    for attempt in range(max_retries):\n        try:\n            async with aiohttp.ClientSession() as session:\n                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:\n                    resp.raise_for_status()\n                    return await resp.json()\n        except (aiohttp.ClientError, asyncio.TimeoutError) as e:\n            if attempt == max_retries - 1:\n                raise\n            await asyncio.sleep(base_delay * (2 ** attempt))" },
    ],
    scores: { coverage: 92, relevance: 95, executability: 94, practicality: 88, faithfulness: 94 },
    overallGrade: "Excellent",
  },
  {
    id: "conv-0183",
    intent: "Analysis",
    turns: [
      { role: "user",  text: "Compare microservices vs. monolithic architecture for a 5-person startup." },
      { role: "agent", text: "For a 5-person team, a monolith is almost certainly the right starting point.\n\nMonolith wins here: simpler deployment (single binary/container), shared memory so no network overhead between modules, easier debugging, faster iteration without service coordination.\n\nMicroservices drawbacks at this scale: each service needs its own CI/CD, health-checking, and inter-service auth. A 5-person team maintaining 8 services is spending 40% of its time on infrastructure instead of product.\n\nRecommendation: build a modular monolith with clean domain boundaries from day one. Extract a service only when you have a measured, concrete scaling bottleneck — not an anticipated one." },
    ],
    scores: { coverage: 88, relevance: 91, executability: 72, practicality: 90, faithfulness: 88 },
    overallGrade: "Good",
  },
  {
    id: "conv-0142",
    intent: "Information Query",
    turns: [
      { role: "user",  text: "What is the difference between RLHF and DPO for fine-tuning LLMs?" },
      { role: "agent", text: "Both align language models with human preferences, but through different mechanisms.\n\nRLHF (Reinforcement Learning from Human Feedback): trains a reward model on human preference pairs, then optimises the LLM against that reward model using PPO. Requires three training phases and is sensitive to reward hacking.\n\nDPO (Direct Preference Optimisation): skips the explicit reward model. It directly optimises the policy using preference pairs via a reparameterised loss, treating the optimal policy as implicitly defined by the data.\n\nIn practice DPO is simpler to implement and more stable. RLHF gives more control when you can afford the infra complexity." },
      { role: "user",  text: "Which one does Llama 3 use?" },
      { role: "agent", text: "Meta used a combination for Llama 3. The instruction-tuned variants (Llama-3-8B-Instruct, 70B-Instruct) were trained with RLHF using a reward model trained on human preference annotations, followed by PPO. Meta also applied rejection sampling for supervised fine-tuning data. DPO was used in some ablations but was not the primary alignment method for the publicly released models, based on Meta's technical report." },
    ],
    scores: { coverage: 91, relevance: 94, executability: 68, practicality: 84, faithfulness: 92 },
    overallGrade: "Excellent",
  },
  {
    id: "conv-0318",
    intent: "Task Execution",
    turns: [
      { role: "user",  text: "Set up a GitHub Actions workflow that runs pytest on every push to main and opens a GitHub issue if any test fails." },
      { role: "agent", text: "Here's a complete workflow:\n\n# .github/workflows/ci.yml\nname: CI\non:\n  push:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.11'\n      - run: pip install -r requirements.txt\n      - id: pytest\n        run: pytest --tb=short 2>&1 | tee pytest_output.txt; echo \"exit_code=$?\" >> $GITHUB_OUTPUT\n      - if: steps.pytest.outputs.exit_code != '0'\n        uses: actions/github-script@v7\n        with:\n          script: |\n            const output = require('fs').readFileSync('pytest_output.txt','utf8');\n            await github.rest.issues.create({\n              owner: context.repo.owner, repo: context.repo.repo,\n              title: `Test failure on ${context.sha.slice(0,7)}`,\n              body: '```\\n' + output.slice(-3000) + '\\n```'\n            });" },
    ],
    scores: { coverage: 94, relevance: 96, executability: 91, practicality: 89, faithfulness: 91 },
    overallGrade: "Excellent",
  },
  {
    id: "conv-0071",
    intent: "Creative Writing",
    turns: [
      { role: "user",  text: "Write a short product tagline for an AI-powered code review tool aimed at senior engineers." },
      { role: "agent", text: "A few options at different tones:\n\nDirect: \"Ship faster. Break less. Know why.\"\nTechnical credibility: \"The reviewer that reads your diffs — and your intent.\"\nConfidence-focused: \"Every PR, reviewed by someone who's seen it before.\"\nMerciful: \"Finally, code review that doesn't make you feel stupid.\"\n\nFor senior engineers specifically I'd lean toward the second — it signals the tool understands context, not just syntax, which is what that audience respects." },
    ],
    scores: { coverage: 82, relevance: 87, executability: 63, practicality: 76, faithfulness: 76 },
    overallGrade: "Good",
  },
  {
    id: "conv-0095",
    intent: "Translation",
    turns: [
      { role: "user",  text: "Translate to Chinese (Simplified): 'The model achieved state-of-the-art performance on the VBench benchmark, scoring 98.5% on Subject Consistency.'" },
      { role: "agent", text: "该模型在 VBench 基准测试中达到了最优性能，主体一致性（Subject Consistency）得分为 98.5%。\n\n注：「state-of-the-art」译为「最优性能」（业界常见译法）；专有名词 VBench 及 Subject Consistency 保留英文原名，因其为领域内通用术语，中文语境下通常不做翻译。" },
    ],
    scores: { coverage: 96, relevance: 97, executability: 94, practicality: 93, faithfulness: 97 },
    overallGrade: "Excellent",
  },
];

const GRADE_COLORS: Record<string, string> = {
  Excellent: "#10b981",
  Good:      "#6366f1",
  Moderate:  "#f59e0b",
};

const total = INTENTS.reduce((s, i) => s + i.count, 0);

const AGENT_GUIDE = {
  rationale:
    "Standard LLM benchmarks (MMLU, HumanEval) measure isolated capability on clean, " +
    "well-formed tasks. Production assistants fail differently — they give technically correct but " +
    "non-actionable answers, hallucinate confidently, or address only part of a multi-faceted query. " +
    "EvalForge's 5-dimension taxonomy isolates each failure mode independently, so a single " +
    "weak dimension surfaces without being diluted by aggregate scores. " +
    "Dimensions are scored 0–100 by an LLM judge (Gemma 4) using 5-shot calibration prompts " +
    "to reduce inter-prompt variance.",
  dims: [
    {
      name: "Coverage",
      label: "coverage",
      color: "#6366f1",
      desc: "Does the response address all aspects and sub-questions in the prompt? " +
            "Catches answers that are technically correct for one part of the query but silently ignore the rest.",
      why: "Critical for complex queries (e.g., 'compare X and Y, then recommend one') where a model may answer only the comparison.",
    },
    {
      name: "Relevance",
      label: "relevance",
      color: "#10b981",
      desc: "Is the response on-topic and appropriately scoped — neither too broad nor off on tangents? " +
            "Catches verbose outputs that bury the answer or pivot to adjacent topics unprompted.",
      why: "Especially important for information-dense domains where padding degrades signal-to-noise ratio.",
    },
    {
      name: "Executability",
      label: "executability",
      color: "#f59e0b",
      desc: "Can the output be directly acted upon without additional interpretation? " +
            "For code: is it syntactically correct and runnable? For instructions: are all steps concrete?",
      why: "Many models produce directionally correct but incomplete outputs (e.g., pseudocode instead of working code, or 'use a cache' without specifying how).",
    },
    {
      name: "Practicality",
      label: "practicality",
      color: "#ec4899",
      desc: "Is the output grounded in real-world constraints (budget, team size, scale, existing ecosystem)? " +
            "Catches theoretically correct advice that ignores practical limitations.",
      why: "Distinguishes textbook answers from advice that works in context — critical for architecture, tooling, and process recommendations.",
    },
    {
      name: "Faithfulness",
      label: "faithfulness",
      color: "#8b5cf6",
      desc: "Are all factual claims in the response verifiable and accurate? " +
            "Inversely measures hallucination rate — the single most critical safety dimension for deployed assistants.",
      why: "A response can score highly on Coverage and Relevance while containing fabricated citations, wrong version numbers, or invented APIs.",
    },
  ],
};

export default function EvalAgentDashboard() {
  const [selectedIntent, setSelectedIntent] = useState<string | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [showGuide, setShowGuide] = useState(false);

  const globalQuality = useMemo(() => {
    return QUALITY_DIMS.map((dim) => {
      const weighted =
        INTENTS.reduce((s, i) => s + i.quality[dim] * i.count, 0) / total;
      return { dimension: DIM_LABELS[dim], score: Math.round(weighted * 10) / 10 };
    });
  }, []);

  const intentQualityRadar = useMemo(() => {
    if (!selectedIntent) return null;
    const intent = INTENTS.find((i) => i.name === selectedIntent);
    if (!intent) return null;
    return QUALITY_DIMS.map((dim) => ({
      dimension: DIM_LABELS[dim],
      [intent.name]: intent.quality[dim],
      Global: globalQuality.find((g) => g.dimension === DIM_LABELS[dim])!.score,
    }));
  }, [selectedIntent, globalQuality]);

  const sample = SAMPLES[sampleIdx];
  const intentColor =
    INTENTS.find((i) => i.name === sample.intent)?.color ?? "#6366f1";

  return (
    <div className="eval-dashboard">
      {/* EvalForge agent taxonomy guide */}
      <button
        className="eval-guide-toggle"
        onClick={() => setShowGuide((v) => !v)}
        aria-expanded={showGuide}
      >
        <span className={`eval-guide-toggle-icon ${showGuide ? "eval-guide-toggle-icon--open" : ""}`}>▶</span>
        Understanding the EvalForge Evaluation Taxonomy
      </button>
      {showGuide && (
        <div className="eval-guide">
          <p className="eval-guide-rationale">{AGENT_GUIDE.rationale}</p>
          <div className="eval-guide-section-label">5 Quality Dimensions</div>
          <div className="eval-guide-grid">
            {AGENT_GUIDE.dims.map((d) => (
              <div key={d.name} className="eval-guide-item">
                <div className="eval-guide-item-name" style={{ color: d.color }}>{d.name}</div>
                <div className="eval-guide-item-desc">{d.desc}</div>
                <div className="eval-guide-item-desc" style={{ marginTop: 4, fontStyle: "italic" }}>
                  Why: {d.why}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Intent distribution + quality overview row */}
      <div className="eval-row">
        <div className="eval-card eval-card--half">
          <h3 className="eval-card-title">Intent Distribution</h3>
          <p className="eval-card-subtitle">{total} conversations · 7 categories · click to drill down</p>
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
                  setSelectedIntent((prev) => (prev === name ? null : name));
                }}
                style={{ cursor: "pointer" }}
              >
                {INTENTS.map((i) => (
                  <Cell
                    key={i.name}
                    fill={i.color}
                    fillOpacity={selectedIntent && selectedIntent !== i.name ? 0.25 : 0.85}
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
                formatter={(value: any, name: any) => [
                  `${value} (${((Number(value) / total) * 100).toFixed(1)}%)`,
                  String(name),
                ] as [string, string]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="eval-pie-legend">
            {INTENTS.map((i) => (
              <button
                key={i.name}
                aria-pressed={selectedIntent === i.name}
                className={`eval-legend-item ${selectedIntent === i.name ? "eval-legend-item--active" : ""}`}
                onClick={() => setSelectedIntent((p) => (p === i.name ? null : i.name))}
              >
                <span className="eval-legend-dot" style={{ background: i.color }} />
                <span className="eval-legend-label">{i.name}</span>
                <span className="eval-legend-count">{i.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="eval-card eval-card--half">
          <h3 className="eval-card-title">
            {selectedIntent ? `Quality: ${selectedIntent}` : "Global Quality Scores"}
          </h3>
          <p className="eval-card-subtitle">
            5-dimension LLM-judge assessment — Gemma 4 with 5-shot calibration
          </p>
          {selectedIntent && intentQualityRadar ? (
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={intentQualityRadar} cx="50%" cy="50%" outerRadius="68%">
                <PolarGrid stroke="var(--color-border-subtle)" />
                <PolarAngleAxis
                  dataKey="dimension"
                  tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                />
                <PolarRadiusAxis domain={[50, 100]} tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} />
                <Radar
                  name={selectedIntent}
                  dataKey={selectedIntent}
                  stroke={INTENTS.find((i) => i.name === selectedIntent)?.color}
                  fill={INTENTS.find((i) => i.name === selectedIntent)?.color}
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
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={globalQuality}
                margin={{ left: 10, right: 20, top: 20, bottom: 10 }}
              >
                <XAxis dataKey="dimension" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                <YAxis domain={[60, 100]} tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-elevated)",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any, name: any) => [
                    `${Number(v).toFixed(1)}`,
                    `${name} — ${DIM_DESC[String(name).toLowerCase()] ?? ""}`,
                  ] as [string, string]}
                />
                <Bar dataKey="score" radius={[4, 4, 0, 0]} barSize={34}>
                  {globalQuality.map((_, i) => (
                    <Cell key={i} fill={["#6366f1","#10b981","#f59e0b","#ec4899","#8b5cf6"][i]} fillOpacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Sample conversation evaluation */}
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
            <span className="eval-meta-turns">{sample.turns.length / 2} turns</span>
          )}
          <span
            className="eval-grade eval-grade--lg"
            style={{ color: GRADE_COLORS[sample.overallGrade], background: `${GRADE_COLORS[sample.overallGrade]}18` }}
          >
            {sample.overallGrade}
          </span>
        </div>

        <div className="eval-conversation">
          {sample.turns.map((t, i) => {
            const lines = t.text.split("\n");
            return (
              <div key={i} className={`eval-turn eval-turn--${t.role}`}>
                <div className="eval-turn-role">{t.role === "user" ? "User" : "Agent"}</div>
                <div className={`eval-turn-text${t.role === "agent" ? " eval-turn-text--mono" : ""}`}>
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
              <div key={dim} className="eval-score-item" title={DIM_DESC[dim]}>
                <div className="eval-score-label">{DIM_LABELS[dim]}</div>
                <div className="eval-score-bar-track">
                  <div className="eval-score-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="eval-score-value">{score}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
