"use client";

import IntentPieChart from "@/components/charts/IntentPieChart";
import QualityBarChart from "@/components/charts/QualityBarChart";
import QualityByIntentChart from "@/components/charts/QualityByIntentChart";

interface IntentSlice {
  name: string;
  count: number;
  percentage: number;
}

interface QualityDimension {
  dimension: string;
  score: number;
}

interface IntentQuality {
  intent: string;
  coverage: number;
  relevance: number;
  executability: number;
  practicality: number;
}

interface FormatEntry {
  format: string;
  percentage: number;
}

interface FeedbackCause {
  cause: string;
  percentage: number;
}

interface AgentChartsProps {
  readonly intentData: readonly IntentSlice[];
  readonly qualityDimensions: readonly QualityDimension[];
  readonly qualityByIntent: readonly IntentQuality[];
  readonly formatData: readonly FormatEntry[];
  readonly feedbackRate: number;
  readonly feedbackCauses: readonly FeedbackCause[];
}

export default function AgentCharts({
  intentData,
  qualityDimensions,
  qualityByIntent,
  formatData,
  feedbackRate,
  feedbackCauses,
}: AgentChartsProps) {
  return (
    <>
      {/* Intent Distribution */}
      <section className="glass-card p-6 mb-8">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Intent Distribution
        </h2>
        <IntentPieChart data={intentData} />
      </section>

      {/* Quality Scores */}
      <section className="glass-card p-6 mb-8">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Overall Quality Scores
        </h2>
        <QualityBarChart data={[...qualityDimensions]} />
      </section>

      {/* Quality by Intent */}
      <section className="glass-card p-6 mb-8">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Quality by Intent Category
        </h2>
        <QualityByIntentChart data={qualityByIntent} />
      </section>

      {/* Output Format Distribution + Negative Feedback */}
      <div className="grid gap-6 md:grid-cols-2 mb-8">
        {/* Output Format */}
        <section className="glass-card p-6">
          <h2 className="text-lg font-bold text-text-primary mb-4">
            Output Format Distribution
          </h2>
          <div className="space-y-3">
            {formatData.map((item) => (
              <div key={item.format} className="flex items-center gap-3">
                <span className="text-sm text-text-secondary w-32 truncate">
                  {item.format}
                </span>
                <div className="flex-1 h-2 rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-violet-500/60"
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-text-muted w-12 text-right">
                  {item.percentage.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Negative Feedback */}
        <section className="glass-card p-6">
          <h2 className="text-lg font-bold text-text-primary mb-2">
            Negative Feedback Analysis
          </h2>
          <p className="text-3xl font-bold text-accent-red mb-4 score-display">
            {(feedbackRate * 100).toFixed(1)}%
            <span className="text-sm font-normal text-text-muted ml-2">
              negative rate
            </span>
          </p>
          <div className="space-y-2.5">
            {feedbackCauses.map((item) => (
              <div key={item.cause} className="flex items-center gap-3">
                <span className="text-sm text-text-secondary w-36 truncate">
                  {item.cause
                    .split("_")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ")}
                </span>
                <div className="flex-1 h-2 rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-accent-red/50"
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-text-muted w-10 text-right">
                  {item.percentage.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
