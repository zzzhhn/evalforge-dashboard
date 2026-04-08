"use client";

import { useState } from "react";
import FullRadarChart from "@/components/charts/FullRadarChart";

interface MetricData {
  mean: number;
  std: number;
  baseline: number;
  delta: number;
}

interface CategoryBreakdown {
  sample_count: number;
  overall: number;
  metrics: Record<string, number>;
}

interface Model {
  name: string;
  provider: string;
  overall_score: number;
  grade: string;
  metrics: Record<string, MetricData>;
  category_breakdown: Record<string, CategoryBreakdown>;
}

interface VideoChartsProps {
  readonly models: readonly Model[];
  readonly metrics: readonly string[];
}

const MODEL_COLORS = ["#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"];
const CATEGORIES = ["Narrative", "Subject", "Environment", "Motion", "Style"];

function formatLabel(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function scoreColor(score: number): string {
  if (score >= 0.9) return "bg-emerald-500";
  if (score >= 0.85) return "bg-blue-500";
  if (score >= 0.8) return "bg-cyan-500";
  if (score >= 0.75) return "bg-amber-500";
  return "bg-red-500";
}

function Heatmap({
  models,
  metrics,
}: {
  readonly models: readonly Model[];
  readonly metrics: readonly string[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-text-secondary font-medium">
              Model
            </th>
            {metrics.map((m) => (
              <th
                key={m}
                className="px-2 py-2 text-center text-text-secondary font-medium text-xs"
              >
                {formatLabel(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr key={model.name} className="border-t border-border-subtle">
              <td className="px-3 py-2 font-medium text-text-primary">
                {model.name}
              </td>
              {metrics.map((m) => {
                const val = model.metrics[m]?.mean ?? 0;
                return (
                  <td key={m} className="px-2 py-2 text-center">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-mono text-white ${scoreColor(val)}`}
                      style={{ opacity: 0.4 + val * 0.6 }}
                    >
                      {(val * 100).toFixed(1)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryTabs({
  models,
}: {
  readonly models: readonly Model[];
}) {
  const [activeTab, setActiveTab] = useState(CATEGORIES[0]);

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === cat
                ? "bg-accent-blue/15 text-accent-blue"
                : "text-text-secondary hover:text-text-primary hover:bg-white/5"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {models.map((model, i) => {
          const cat = model.category_breakdown[activeTab];
          if (!cat) return null;
          return (
            <div key={model.name} className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
                />
                <span className="font-medium text-text-primary text-sm">
                  {model.name}
                </span>
                <span className="ml-auto score-display text-lg font-bold text-text-primary">
                  {(cat.overall * 100).toFixed(1)}
                </span>
              </div>
              <div className="space-y-1.5">
                {Object.entries(cat.metrics).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="text-text-muted w-28 truncate">
                      {formatLabel(key)}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-accent-blue/60"
                        style={{ width: `${val * 100}%` }}
                      />
                    </div>
                    <span className="text-text-secondary font-mono w-10 text-right">
                      {(val * 100).toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModelDetailCards({
  models,
}: {
  readonly models: readonly Model[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {models.map((model, i) => {
        const isOpen = expanded === model.name;
        const metricEntries = Object.entries(model.metrics);
        const sorted = [...metricEntries].sort(
          (a, b) => b[1].mean - a[1].mean
        );
        const strengths = sorted.slice(0, 3);
        const weaknesses = sorted.slice(-3).reverse();

        return (
          <div key={model.name} className="glass-card overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : model.name)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-bg-card-hover transition-colors"
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
              />
              <span className="font-medium text-text-primary">
                {model.name}
              </span>
              <span className="text-xs text-text-muted">{model.provider}</span>
              <span className="ml-auto score-display text-lg font-bold text-text-primary">
                {(model.overall_score * 100).toFixed(1)}
              </span>
              <svg
                className={`w-4 h-4 text-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 border-t border-border-subtle pt-4">
                <div className="grid gap-4 sm:grid-cols-2 mb-4">
                  <div>
                    <h4 className="text-xs font-medium text-accent-emerald mb-2">
                      Strengths
                    </h4>
                    {strengths.map(([key, val]) => (
                      <div
                        key={key}
                        className="flex justify-between text-sm py-1"
                      >
                        <span className="text-text-secondary">
                          {formatLabel(key)}
                        </span>
                        <span className="font-mono text-accent-emerald">
                          {(val.mean * 100).toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="text-xs font-medium text-accent-red mb-2">
                      Weaknesses
                    </h4>
                    {weaknesses.map(([key, val]) => (
                      <div
                        key={key}
                        className="flex justify-between text-sm py-1"
                      >
                        <span className="text-text-secondary">
                          {formatLabel(key)}
                        </span>
                        <span className="font-mono text-accent-red">
                          {(val.mean * 100).toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 grid-cols-3 sm:grid-cols-5">
                  {metricEntries.map(([key, val]) => (
                    <div key={key} className="text-center p-2 rounded-lg bg-white/5">
                      <div className="text-[10px] text-text-muted truncate">
                        {formatLabel(key)}
                      </div>
                      <div className="score-display text-sm font-bold text-text-primary mt-0.5">
                        {(val.mean * 100).toFixed(1)}
                      </div>
                      <div
                        className={`text-[10px] font-mono ${
                          val.delta > 0.005
                            ? "delta-positive"
                            : val.delta < -0.005
                              ? "delta-negative"
                              : "delta-neutral"
                        }`}
                      >
                        {val.delta > 0 ? "+" : ""}
                        {(val.delta * 100).toFixed(1)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function VideoCharts({ models, metrics }: VideoChartsProps) {
  return (
    <>
      {/* Radar Chart */}
      <section className="glass-card p-6 mb-8">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Model Comparison Radar
        </h2>
        <FullRadarChart models={[...models]} metrics={[...metrics]} />
      </section>

      {/* Heatmap */}
      <section className="glass-card p-6 mb-8">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Score Heatmap
        </h2>
        <Heatmap models={models} metrics={metrics} />
      </section>

      {/* Category Breakdown */}
      <section className="glass-card p-6 mb-8">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Category Breakdown
        </h2>
        <CategoryTabs models={models} />
      </section>

      {/* Model Detail Cards */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          Model Details
        </h2>
        <ModelDetailCards models={models} />
      </section>
    </>
  );
}
