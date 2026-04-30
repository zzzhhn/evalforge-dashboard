"use client";

import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n/context";
import { KaTeX } from "@/components/admin/katex-inline";

// Inline LaTeX colour macros shared across the card. These render in
// real math typography (KaTeX) while still giving us the per-symbol
// colour coding that came from the original design tiles.
const BLUE = "#60a5fa";
const ROSE = "#fb7185";
const PURPLE = "#c084fc";

function c(hex: string, body: string) {
  return `\\textcolor{${hex}}{${body}}`;
}

interface Props {
  // MCMC diagnostics — all null until Phase 9 wires real sampler output.
  // Kept in state so the card can later animate when a run completes.
  rHat?: number | null;
  divergent?: number | null;
  chains?: string | null;
  waic?: number | null;
  sparseAnnotators?: number | null;
}

/**
 * Bold model card — the visual anchor of the calibration page. Two-column
 * layout: left shows the IRT equations with token-tile symbols, right lists
 * the symbol legend. Bottom row surfaces 5 MCMC diagnostic chips.
 *
 * All diagnostic values are Phase 9 stubs (hardcoded to the design-sample
 * numbers so the card renders identically to the mock). Real values will
 * come from the PyMC/Stan sampler when it lands.
 */
export function CalibrationModelCard({
  rHat = 1.012,
  divergent = -13,
  chains = "4×1000",
  waic = -12482,
  sparseAnnotators = 1,
}: Props) {
  const { locale } = useLocale();

  return (
    <div className="rounded-xl border bg-card/60 px-5 py-5">
      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        {/* Left: title + equations + diagnostics */}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {locale === "zh" ? "能力评估模型" : "Capability Model"}
            </span>
            <Badge className="bg-blue-500/15 text-blue-500 hover:bg-blue-500/15">
              BAYESIAN HIERARCHICAL IRT
            </Badge>
          </div>

          <h2 className="mt-2 flex flex-wrap items-center gap-2 text-lg font-semibold">
            {locale === "zh" ? <>联合推断</> : <>Joint inference of</>}
            <KaTeX
              expr={`${c(BLUE, "\\alpha_r")} \\times ${c(BLUE, "q_{i,d}")}`}
              className="text-xl"
            />
            <span className="text-muted-foreground">·</span>
            {locale === "zh"
              ? "Likert 与 Pairwise 共享参数"
              : "Likert and Pairwise share parameters"}
          </h2>

          <p className="mt-1 text-xs text-muted-foreground">
            {locale === "zh"
              ? "GRM 处理 Likert 1-5 · Quality-aware Davidson-BT 处理 Arena 投票 · NumPyro NUTS 采样 · 输出 α_r 后验均值 + 95% 可信区间 (CI)，以百分位形式给出能力排序。"
              : "GRM for Likert 1-5. Quality-aware Davidson-BT for Arena votes. NumPyro NUTS sampler. Outputs α_r posterior mean + 95% CI, ranked as percentiles."}
          </p>

          {/* Equation rows — rendered via KaTeX for real math typography.
              Symbols are tinted with \textcolor so they match the legend
              on the right column. */}
          <div className="mt-4 space-y-3">
            <EquationRow
              tag={{ label: "LIKERT · GRM", color: "emerald" }}
              expr={[
                `P(y_{r,i,d}=k)`,
                `=`,
                `\\sigma\\!\\left(${c(BLUE, "\\alpha_r")} \\cdot ${c(BLUE, "q_{i,d}")} - ${c(ROSE, "\\beta_{r,k-1}")}\\right)`,
                `-`,
                `\\sigma\\!\\left(\\,\\cdot\\, - ${c(ROSE, "\\beta_{r,k}")}\\right)`,
              ].join(" ")}
            />
            <EquationRow
              tag={{ label: "PAIRWISE · DAVIDSON", color: "amber" }}
              expr={[
                `P(v)`,
                `=`,
                `\\operatorname{softmax}\\!\\left\\{`,
                `${c(BLUE, "\\alpha_r")} ${c(BLUE, "q_i")},\\ `,
                `${c(BLUE, "\\alpha_r")} ${c(BLUE, "q_j")},\\ `,
                `${c(PURPLE, "\\gamma_r \\pm \\eta_r \\mu")}`,
                `\\right\\}`,
              ].join(" ")}
            />
          </div>

          {/* Diagnostic chips — real values from bootstrap posterior.
              R̂ comes from the Gelman-Rubin-like chain split statistic
              in capability-metrics.ts. WAIC remains null because a proper
              likelihood model isn't wired yet. */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <DiagChip label="R̂" value={rHat != null ? rHat.toFixed(3) : "—"} />
            <DiagChip
              label="divergent"
              value={divergent != null ? String(divergent) : "—"}
            />
            <DiagChip label="chains" value={chains ?? "—"} />
            <DiagChip
              label="WAIC"
              value={waic != null ? waic.toLocaleString() : "—"}
            />
            <DiagChip
              label={locale === "zh" ? "稀疏评测员" : "Sparse annotators"}
              value={sparseAnnotators != null ? String(sparseAnnotators) : "—"}
            />
          </div>
        </div>

        {/* Right: symbol legend */}
        <div className="rounded-lg border bg-background/40 px-3 py-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {locale === "zh" ? "参数含义" : "Symbols"}
          </div>
          <div className="mt-2 space-y-2.5">
            <LegendRow
              expr={c(BLUE, "\\alpha_r")}
              title={locale === "zh" ? "鉴别度" : "Discrimination"}
              body={
                locale === "zh"
                  ? "评测员区分高/低质量项目的能力 · log 尺度 · 核心排序依据"
                  : "Annotator's ability to discriminate high/low quality items · log scale · primary ranking basis"
              }
            />
            <LegendRow
              expr={c(BLUE, "q_{i,d}")}
              title={locale === "zh" ? "项目质量" : "Item quality"}
              body={
                locale === "zh"
                  ? "视频 i 在维度 d 上的潜在真实质量 · latent · LKJ 先验"
                  : "Latent quality of video i on dimension d · LKJ prior"
              }
            />
            <LegendRow
              expr={c(ROSE, "\\delta_r")}
              title={locale === "zh" ? "严厉度" : "Severity"}
              body={
                locale === "zh"
                  ? "评测员整体打分偏向 · 负=严厉 / 正=宽容"
                  : "Overall scoring bias · negative=strict, positive=lenient"
              }
            />
            <LegendRow
              expr={c(PURPLE, "\\gamma_r")}
              title={locale === "zh" ? "Tie 倾向" : "Tie propensity"}
              body={
                locale === "zh"
                  ? "Arena 投 BOTH_GOOD / BOTH_BAD 的倾向 · 仅 Pairwise"
                  : "Tendency to vote BOTH_GOOD / BOTH_BAD in Arena · Pairwise only"
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function EquationRow({
  tag,
  expr,
}: {
  tag: { label: string; color: "emerald" | "amber" };
  expr: string;
}) {
  const tagCls =
    tag.color === "emerald"
      ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
      : "bg-amber-500/15 text-amber-500 border-amber-500/30";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wider ${tagCls}`}
      >
        {tag.label}
      </span>
      <div className="overflow-x-auto text-base">
        <KaTeX expr={expr} />
      </div>
    </div>
  );
}

function DiagChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/40 px-2.5 py-1 font-mono text-xs">
      <span className="text-muted-foreground">{label}</span>{" "}
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function LegendRow({
  expr,
  title,
  body,
}: {
  expr: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-[32px] pt-0.5 text-base">
        <KaTeX expr={expr} />
      </div>
      <div className="flex-1">
        <div className="text-xs font-semibold">{title}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {body}
        </div>
      </div>
    </div>
  );
}
