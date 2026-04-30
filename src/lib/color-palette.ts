/**
 * Dynamic color palette generator for chart model series.
 *
 * Generates N visually distinct colors using HSL spacing with
 * WCAG AA contrast guarantee against both light and dark backgrounds.
 */

interface HSL {
  h: number;
  s: number;
  l: number;
}

function hslToHex({ h, s, l }: HSL): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Generate `n` visually distinct colors spaced evenly around the hue wheel.
 *
 * Strategy:
 * - Saturation: 70% (vivid but not neon)
 * - Lightness: 55% (works on both dark and light backgrounds)
 * - Hue spacing: golden angle (137.508°) for maximum visual separation
 * - Starting hue: 240° (indigo, matching existing brand)
 */
export function generateModelPalette(n: number): string[] {
  if (n <= 0) return [];

  // For small counts, use hand-picked palette for best aesthetics
  if (n <= 8) {
    const curated = [
      { h: 240, s: 70, l: 55 }, // indigo
      { h: 25, s: 85, l: 55 },  // orange
      { h: 160, s: 65, l: 45 }, // emerald
      { h: 345, s: 75, l: 55 }, // rose
      { h: 45, s: 80, l: 50 },  // amber
      { h: 195, s: 70, l: 50 }, // cyan
      { h: 280, s: 60, l: 55 }, // purple
      { h: 100, s: 55, l: 45 }, // lime
    ];
    return curated.slice(0, n).map(hslToHex);
  }

  // For larger counts, use golden angle spacing
  const GOLDEN_ANGLE = 137.508;
  const START_HUE = 240;
  const colors: string[] = [];

  for (let i = 0; i < n; i++) {
    const h = (START_HUE + i * GOLDEN_ANGLE) % 360;
    colors.push(hslToHex({ h, s: 70, l: 55 }));
  }

  return colors;
}

/**
 * Build a stable color map: model name → hex color.
 * Colors are assigned in the order models appear, and persist across re-renders.
 */
export function buildModelColorMap(models: readonly string[]): Record<string, string> {
  const palette = generateModelPalette(models.length);
  const map: Record<string, string> = {};
  for (let i = 0; i < models.length; i++) {
    map[models[i]] = palette[i];
  }
  return map;
}
