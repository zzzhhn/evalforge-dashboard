import EvalVideoDashboard from "@/components/EvalVideoDashboard";

export const metadata = {
  title: "Video Evaluation · EvalForge",
  description:
    "T2V models evaluated across 18 VBench 2.0 intrinsic faithfulness dimensions with pairwise win-rate ranking.",
};

export default function VideoPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
          Video Evaluation Track
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          T2V models evaluated across all 18 VBench 2.0 dimensions (Human Fidelity, Creativity,
          Controllability, Physics, Commonsense). All scores from the published paper (Table 2).
        </p>
      </div>
      <EvalVideoDashboard />
    </div>
  );
}
