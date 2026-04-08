import { useEffect, useRef, useState } from "react";

interface Props {
  chart: string;
  caption?: string;
}

let idCounter = 0;

export default function MermaidDiagram({ chart, caption }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${++idCounter}`);

  useEffect(() => {
    let cancelled = false;

    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;

      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: {
          /* Match site's dark palette */
          background:         "#0f0f10",
          primaryColor:       "#1e1e24",
          primaryTextColor:   "#e8e8f0",
          primaryBorderColor: "#2e2e3a",
          lineColor:          "#4a4a5a",
          secondaryColor:     "#1a1a22",
          tertiaryColor:      "#161620",
          /* Node text */
          nodeBorder:         "#3a3a4a",
          mainBkg:            "#1e1e28",
          nodeTextColor:      "#c8c8d8",
          /* Edges */
          edgeLabelBackground: "#1e1e28",
          /* Cluster */
          clusterBkg:         "#14141c",
          clusterBorder:      "#2a2a38",
          titleColor:         "#a8a8c0",
          /* Font */
          fontFamily:         "'SF Pro Display', 'Inter', sans-serif",
          fontSize:           "13px",
        },
        flowchart: {
          htmlLabels: true,
          curve: "basis",
        },
      });

      mermaid
        .render(idRef.current, chart)
        .then(({ svg }) => {
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg;
            /* Remove fixed dimensions so it scales responsively */
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
  }, [chart]);

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
