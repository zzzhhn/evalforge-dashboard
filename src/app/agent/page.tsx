import EvalAgentDashboard from "@/components/EvalAgentDashboard";

export const metadata = {
  title: "Agent Evaluation · EvalForge",
  description:
    "500 conversations from a Gemma 4-based assistant evaluated across 8 quality dimensions via LLM-as-judge.",
};

export default function AgentPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
          Agent Evaluation Track
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          500 conversations from an internal Gemma 4-based conversational assistant — intent
          classification across 7 categories and 8-dimension quality scoring (including safety,
          reasoning, efficiency) via LLM-as-judge with 5-shot calibration.
        </p>
      </div>
      <EvalAgentDashboard />
    </div>
  );
}
