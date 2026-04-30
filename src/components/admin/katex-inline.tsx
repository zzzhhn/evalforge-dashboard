"use client";

import { useMemo } from "react";
import katex from "katex";

interface Props {
  expr: string;
  block?: boolean;
  className?: string;
}

/**
 * Thin KaTeX wrapper that renders LaTeX to pre-typeset HTML. We pass
 * `throwOnError: false` so a bad fragment degrades to plain text instead
 * of crashing the card. `trust: true` enables \htmlClass so we can colour
 * per-symbol tokens from the parent component.
 */
export function KaTeX({ expr, block = false, className }: Props) {
  const html = useMemo(
    () =>
      katex.renderToString(expr, {
        throwOnError: false,
        displayMode: block,
        output: "html",
        trust: true,
        strict: "ignore",
      }),
    [expr, block],
  );
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
