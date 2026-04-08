import EvalVideoDashboard from "@/components/EvalVideoDashboard";

export const metadata = {
  title: "Video Evaluation · EvalForge",
  description:
    "T2V and I2V model evaluation across all 16 VBench 1.0 dimensions and VBench++ I2V metrics.",
};

export default function VideoPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
          Video Evaluation Track
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          T2V models evaluated across all 16 official VBench 1.0 dimensions (Video Quality +
          Video-Condition Consistency). I2V track uses VBench++ Subject/Background/Camera metrics.
        </p>
      </div>
      <EvalVideoDashboard />
    </div>
  );
}
