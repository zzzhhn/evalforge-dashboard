import EvalVideoDashboard from "@/components/EvalVideoDashboard";

export const metadata = {
  title: "Video Evaluation · EvalForge",
  description:
    "T2V models evaluated across 16 VBench 1.0 dimensions (7 Video Quality + 9 Video-Condition Consistency) with pairwise win-rate ranking.",
};

export default function VideoPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
          Video Evaluation Track
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          T2V models evaluated across all 16 official VBench 1.0 dimensions — 7 Video Quality
          + 9 Video-Condition Consistency. Rankings use pairwise win-rate matrices, not composite scores.
        </p>
      </div>
      <EvalVideoDashboard />
    </div>
  );
}
