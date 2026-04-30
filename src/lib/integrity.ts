/**
 * Integrity score calculation for annotators.
 *
 * Domain invariant: integrity ∈ [0, 100] ∪ {null}
 *
 * Rationale for v2 formula (2026-04-20):
 * - Old formula treated single critical events harshly (×10 each, uncapped).
 *   A user with 20 normal scores and 2 critical events would drop to 80
 *   regardless of sample size. This penalized normal evaluation behavior.
 * - New formula: capped penalties + minimum sample size. Below the sample
 *   floor we return null (unknown), not zero. Penalties scale by rate and
 *   cap out so a single anomaly cannot dominate.
 */

export const MIN_SCORES_FOR_INTEGRITY = 20;

export interface IntegrityInput {
  totalScores: number;
  suspiciousCount: number;
  invalidCount: number;
  criticalEvents: number;
  warningEvents: number;
}

export interface IntegrityResult {
  score: number | null;
  totalScores: number;
  suspiciousCount: number;
  invalidCount: number;
  criticalEvents: number;
  warningEvents: number;
}

/**
 * Calculate an annotator's integrity score.
 *
 * Sample floor: returns null when totalScores < MIN_SCORES_FOR_INTEGRITY.
 *
 * Capped penalty weights (v2):
 * - suspiciousRate × 40, capped at 25
 * - invalidRate × 80, capped at 40
 * - (criticalEvents / totalScores) × 100, capped at 30
 * - (warningEvents / totalScores) × 50, capped at 15
 *
 * Max theoretical penalty: 110 (i.e. a truly bad actor clamps to 0).
 */
export function calculateIntegrity(input: IntegrityInput): IntegrityResult {
  const {
    totalScores,
    suspiciousCount,
    invalidCount,
    criticalEvents,
    warningEvents,
  } = input;

  if (totalScores < MIN_SCORES_FOR_INTEGRITY) {
    return {
      score: null,
      totalScores,
      suspiciousCount,
      invalidCount,
      criticalEvents,
      warningEvents,
    };
  }

  const suspiciousRate = suspiciousCount / totalScores;
  const invalidRate = invalidCount / totalScores;
  const criticalPerScore = criticalEvents / totalScores;
  const warningPerScore = warningEvents / totalScores;

  const suspiciousPenalty = Math.min(suspiciousRate * 40, 25);
  const invalidPenalty = Math.min(invalidRate * 80, 40);
  const criticalPenalty = Math.min(criticalPerScore * 100, 30);
  const warningPenalty = Math.min(warningPerScore * 50, 15);

  const raw =
    100 - suspiciousPenalty - invalidPenalty - criticalPenalty - warningPenalty;

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    score,
    totalScores,
    suspiciousCount,
    invalidCount,
    criticalEvents,
    warningEvents,
  };
}
