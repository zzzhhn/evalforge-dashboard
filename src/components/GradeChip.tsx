interface GradeChipProps {
  readonly grade: string;
}

const GRADE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  excellent: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    label: "Excellent",
  },
  good: {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    label: "Good",
  },
  moderate: {
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    label: "Moderate",
  },
  needs_improvement: {
    bg: "bg-red-500/15",
    text: "text-red-400",
    label: "Needs Improvement",
  },
};

const DEFAULT_STYLE = {
  bg: "bg-slate-500/15",
  text: "text-slate-400",
  label: "Unknown",
};

export function GradeChip({ grade }: GradeChipProps) {
  const style = GRADE_STYLES[grade] ?? { ...DEFAULT_STYLE, label: grade };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}
