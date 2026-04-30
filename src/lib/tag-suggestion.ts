import { prisma } from "@/lib/db";

/**
 * Phase 6: Tag auto-recommendation.
 *
 * Looks at each annotator's score history grouped by L1 dimension, computes
 * volume + variance, and maps qualifying L1 dimensions to an existing
 * AnnotatorTag (matched by name/nameEn). Produces AUTO_SUGGESTED UserTag
 * entries with a confidence score in [0, 1] — admins confirm or dismiss.
 *
 * Pure functions (scoreCandidateSuggestions, etc.) are DB-free and
 * independently testable. runTagSuggestionForAll is the DB-side executor.
 */

// ─── Tunables ────────────────────────────────────────────────────────────
export const MIN_VOLUME = 20; // need ≥ this many scores on an L1 to consider
export const VARIANCE_MAX = 1.6; // stddev of Likert values above this → noisy, skip
export const CONFIDENCE_MIN = 0.35; // don't persist suggestions below this
export const VOLUME_SATURATION = 80; // volume at which volumeFactor hits 1.0

// ─── Types ───────────────────────────────────────────────────────────────
export interface RawScore {
  userId: string;
  dimensionId: string;
  value: number; // Likert 1-5
}

export interface DimensionMeta {
  id: string;
  code: string; // "D4" / "D4.1" / "D4.1.2"
  nameZh: string;
  nameEn: string;
}

export interface TagCandidate {
  id: string;
  name: string; // zh
  nameEn: string | null;
}

export interface UserDimStats {
  userId: string;
  l1Code: string; // "D4"
  volume: number;
  mean: number;
  stddev: number;
}

export interface SuggestedAssignment {
  userId: string;
  tagId: string;
  tagName: string;
  l1Code: string;
  confidence: number; // [0, 1]
  volume: number;
  stddev: number;
}

// ─── Pure helpers ────────────────────────────────────────────────────────

/** Extract the L1 portion of a dimension code. "D4.1.2" → "D4". */
export function l1CodeOf(code: string): string {
  const dot = code.indexOf(".");
  return dot === -1 ? code : code.slice(0, dot);
}

/** Population stddev. Returns 0 for n < 2. */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const ss = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(ss / values.length);
}

/**
 * Aggregate scores into per-(user, L1-code) stats.
 * `dimensions` param maps dimensionId → L1 code for O(1) lookup.
 */
export function aggregateByL1(
  scores: RawScore[],
  dimToL1: Map<string, string>,
): UserDimStats[] {
  const buckets = new Map<string, number[]>();
  for (const s of scores) {
    const l1 = dimToL1.get(s.dimensionId);
    if (!l1) continue;
    const key = `${s.userId}::${l1}`;
    const arr = buckets.get(key) ?? [];
    arr.push(s.value);
    buckets.set(key, arr);
  }
  const out: UserDimStats[] = [];
  for (const [key, values] of buckets) {
    const [userId, l1Code] = key.split("::");
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    out.push({
      userId,
      l1Code,
      volume: values.length,
      mean,
      stddev: stddev(values),
    });
  }
  return out;
}

/**
 * Match an L1 dimension to an existing AnnotatorTag by name equality.
 * Matching is fuzzy-friendly: exact on nameZh / nameEn (case-insensitive, trimmed).
 * Returns the first match or null. Missing map entries are normal — not every
 * L1 dimension has a corresponding tag.
 */
export function matchDimToTag(
  dim: DimensionMeta,
  tags: TagCandidate[],
): TagCandidate | null {
  const targets = [dim.nameZh, dim.nameEn]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => s.trim().toLowerCase());
  for (const t of tags) {
    const candidates = [t.name, t.nameEn ?? ""]
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    if (candidates.some((c) => targets.includes(c))) return t;
  }
  return null;
}

/**
 * Confidence combines volume saturation and Likert-variance penalty.
 *   volumeFactor   = min(1, volume / VOLUME_SATURATION)
 *   consistencyFac = 1 - stddev / 2  (Likert ranges 1-5, stddev cap 2)
 * Clipped into [0, 1]. High volume + low variance → high confidence.
 */
export function confidenceOf(volume: number, stddev: number): number {
  const volumeFactor = Math.min(1, volume / VOLUME_SATURATION);
  const consistency = Math.max(0, Math.min(1, 1 - stddev / 2));
  return Math.max(0, Math.min(1, volumeFactor * consistency));
}

/**
 * Apply thresholds + tag-matching to raw stats. Pure, testable.
 * `l1ToDim` maps L1 code → DimensionMeta (the L1 row itself, not its children).
 */
export function selectSuggestions(
  stats: UserDimStats[],
  l1ToDim: Map<string, DimensionMeta>,
  tags: TagCandidate[],
): SuggestedAssignment[] {
  const out: SuggestedAssignment[] = [];
  for (const s of stats) {
    if (s.volume < MIN_VOLUME) continue;
    if (s.stddev > VARIANCE_MAX) continue;
    const dim = l1ToDim.get(s.l1Code);
    if (!dim) continue;
    const tag = matchDimToTag(dim, tags);
    if (!tag) continue;
    const confidence = confidenceOf(s.volume, s.stddev);
    if (confidence < CONFIDENCE_MIN) continue;
    out.push({
      userId: s.userId,
      tagId: tag.id,
      tagName: tag.name,
      l1Code: s.l1Code,
      confidence,
      volume: s.volume,
      stddev: s.stddev,
    });
  }
  return out;
}

// ─── DB-side executor ────────────────────────────────────────────────────

export interface SuggestionRunResult {
  scannedUsers: number;
  evaluated: number; // total (user, L1) buckets above MIN_VOLUME
  created: number; // new AUTO_SUGGESTED UserTag rows
  updated: number; // existing AUTO_SUGGESTED rows refreshed
  skippedManual: number; // user already has this tag as MANUAL — never overwrite
  suggestions: SuggestedAssignment[];
}

/**
 * Scan the whole Score table and produce AUTO_SUGGESTED UserTag rows.
 *
 * Safety invariants:
 *   - Never touch a UserTag whose source=MANUAL (admin-curated wins always)
 *   - Upsert AUTO_SUGGESTED by composite PK (userId, tagId) — idempotent
 *   - Scores with `validity != VALID` are excluded (flagged cheating attempts)
 *   - Soft-deleted users are excluded
 */
export async function runTagSuggestionForAll(): Promise<SuggestionRunResult> {
  // 1. Pull Score + Dimension + Tag catalogs in parallel.
  const [rawScores, dimensions, tags, existingUserTags] = await Promise.all([
    prisma.score.findMany({
      where: {
        validity: "VALID",
        user: { deletedAt: null, role: { in: ["ANNOTATOR", "VENDOR_ANNOTATOR"] } },
      },
      select: { userId: true, dimensionId: true, value: true },
    }),
    prisma.dimension.findMany({
      select: { id: true, code: true, nameZh: true, nameEn: true },
    }),
    prisma.annotatorTag.findMany({
      select: { id: true, name: true, nameEn: true },
    }),
    prisma.userTag.findMany({
      select: { userId: true, tagId: true, source: true },
    }),
  ]);

  // 2. Build lookup maps.
  const dimToL1 = new Map<string, string>();
  const l1ToDim = new Map<string, DimensionMeta>();
  for (const d of dimensions) {
    dimToL1.set(d.id, l1CodeOf(d.code));
    if (l1CodeOf(d.code) === d.code) {
      // d itself is L1 — register as the representative for tag matching.
      l1ToDim.set(d.code, d);
    }
  }

  // 3. Aggregate + select.
  const stats = aggregateByL1(rawScores, dimToL1);
  const suggestions = selectSuggestions(stats, l1ToDim, tags);

  // 4. Persist, respecting the MANUAL-wins rule.
  const manualKeys = new Set(
    existingUserTags
      .filter((ut) => ut.source === "MANUAL")
      .map((ut) => `${ut.userId}::${ut.tagId}`),
  );
  const autoKeys = new Set(
    existingUserTags
      .filter((ut) => ut.source === "AUTO_SUGGESTED")
      .map((ut) => `${ut.userId}::${ut.tagId}`),
  );

  let created = 0;
  let updated = 0;
  let skippedManual = 0;

  for (const s of suggestions) {
    const key = `${s.userId}::${s.tagId}`;
    if (manualKeys.has(key)) {
      skippedManual += 1;
      continue;
    }
    if (autoKeys.has(key)) {
      await prisma.userTag.update({
        where: { userId_tagId: { userId: s.userId, tagId: s.tagId } },
        data: { confidence: s.confidence },
      });
      updated += 1;
    } else {
      await prisma.userTag.create({
        data: {
          userId: s.userId,
          tagId: s.tagId,
          source: "AUTO_SUGGESTED",
          confidence: s.confidence,
        },
      });
      created += 1;
    }
  }

  const distinctUsers = new Set(stats.map((s) => s.userId)).size;

  return {
    scannedUsers: distinctUsers,
    evaluated: stats.filter((s) => s.volume >= MIN_VOLUME).length,
    created,
    updated,
    skippedManual,
    suggestions,
  };
}
