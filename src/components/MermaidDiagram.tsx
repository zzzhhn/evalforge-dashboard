"use client";

import { useEffect, useRef, useState, useId } from "react";

interface Props {
  chart: string;
  caption?: string;
}

/* Mermaid must be initialized once globally. Track whether it has been done. */
let mermaidInitialized = false;

function ensureMermaidInitialized(mermaid: { initialize: (cfg: object) => void }) {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      background:          "#0f0f10",
      primaryColor:        "#1e1e24",
      primaryTextColor:    "#e8e8f0",
      primaryBorderColor:  "#2e2e3a",
      lineColor:           "#4a4a5a",
      secondaryColor:      "#1a1a22",
      tertiaryColor:       "#161620",
      nodeBorder:          "#3a3a4a",
      mainBkg:             "#1e1e28",
      nodeTextColor:       "#c8c8d8",
      edgeLabelBackground: "#1e1e28",
      clusterBkg:          "#14141c",
      clusterBorder:       "#2a2a38",
      titleColor:          "#a8a8c0",
      fontFamily:          "'SF Pro Display', 'Inter', sans-serif",
      fontSize:            "13px",
    },
    flowchart: { htmlLabels: true, curve: "basis" },
  });
}

export default function MermaidDiagram({ chart, caption }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  /* useId() is SSR-safe and stable across Strict Mode double-invocations */
  const reactId = useId();
  const diagramId = `mermaid-${reactId.replace(/:/g, "")}`;

  useEffect(() => {
    let cancelled = false;

    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;
      ensureMermaidInitialized(mermaid);

      mermaid
        .render(diagramId, chart)
        .then(({ svg }) => {
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg;
            const svgEl = containerRef.current.querySelector("svg");
            if (svgEl) {
              svgEl.removeAttribute("height");
              svgEl.style.width = "100%";
              svgEl.style.maxWidth = "100%";
            }
          }
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [chart, diagramId]);

  if (error) {
    return (
      <pre style={{ fontSize: "0.75rem", color: "var(--color-text-tertiary)", overflowX: "auto" }}>
        {chart}
      </pre>
    );
  }

  return (
    <figure className="mermaid-figure">
      <div ref={containerRef} className="mermaid-container" />
      {caption && <figcaption className="mermaid-caption">{caption}</figcaption>}
    </figure>
  );
}
