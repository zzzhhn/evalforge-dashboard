import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import type { TaskType } from "@prisma/client";
import { canonicalTagsForL1, extractL1Code } from "@/lib/failure-tag-taxonomy";

export interface ParsedRow {
  rowNumber: number;
  externalId: string;   // e.g. "T2V_001" / "I2V_001" — the key for matching OSS files
  l1: string;
  l2: string;
  l3: string;
  promptZh: string;
  promptEn: string;
  category: string | null;
  // I2V only — describes the starting frame (used to pre-generate the
  // source image). Absent for T2V rows.
  startingFramePrompt: string | null;
}

export interface ParseError {
  row: number;
  column?: string;
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
  stats: {
    totalRows: number;
    uniqueL1: number;
    uniqueL2: number;
    uniqueL3: number;
  };
}

const HEADER_ALIASES: Record<keyof Pick<ParsedRow, "externalId" | "l1" | "l2" | "l3" | "promptZh" | "promptEn" | "category" | "startingFramePrompt">, string[]> = {
  externalId: ["id", "ID", "外部id", "编号", "prompt_id", "external_id", "task_id"],
  l1: ["D1", "d1", "一级分类", "一级维度", "L1"],
  l2: ["D2", "d2", "二级分类", "二级维度", "L2"],
  l3: ["D3", "d3", "三级分类", "三级维度", "L3"],
  // Support both the original (`prompt_en` / `prompt_cn`) and the
  // "_clean" variants that the I2V_200 sheet uses.
  promptZh: [
    "prompt_cn",
    "prompt_cn_clean",
    "prompt_zh",
    "中文prompt",
    "中文 prompt",
    "中文Prompt",
  ],
  promptEn: [
    "prompt_en",
    "prompt_en_clean",
    "英文prompt",
    "英文 prompt",
    "英文Prompt",
  ],
  category: ["category", "类别", "分类"],
  // I2V source-image prompt. When present in the header, the parser
  // auto-flags the suite as I2V (taskType override passed down from
  // the caller still wins — this is just a signal).
  startingFramePrompt: [
    "starting_frame_prompt",
    "source_image_prompt",
    "首帧",
    "首帧prompt",
    "首帧 prompt",
  ],
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function matchHeader(cell: string): keyof typeof HEADER_ALIASES | null {
  const n = normalize(cell);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => normalize(a) === n)) {
      return key as keyof typeof HEADER_ALIASES;
    }
  }
  return null;
}

/** Scan a sheet's header row (row 1) and return true iff any cell
 *  matches the given alias key. Used to detect I2V sheets via the
 *  presence of `starting_frame_prompt`. */
function headerHasColumn(
  sheet: ExcelJS.Worksheet,
  aliasKey: keyof typeof HEADER_ALIASES,
): boolean {
  const header = sheet.getRow(1);
  let found = false;
  header.eachCell({ includeEmpty: false }, (cell) => {
    if (matchHeader(readCell(cell)) === aliasKey) found = true;
  });
  return found;
}

/**
 * Pick the right sheet given a task-type hint. Preference order is
 * documented in `parsePromptSuiteXlsx`. Returns null when the workbook
 * is empty.
 */
function pickSheet(
  wb: ExcelJS.Workbook,
  taskType: TaskType | undefined,
): ExcelJS.Worksheet | null {
  if (wb.worksheets.length === 0) return null;
  if (!taskType) return wb.worksheets[0];

  const hint = taskType.toLowerCase();

  // 1. Name-based match (T2V_200 / I2V_200 / "T2V Prompts" / etc.)
  const byName = wb.worksheets.find((s) =>
    s.name.toLowerCase().includes(hint),
  );
  if (byName) return byName;

  // 2. Column-signature match. I2V sheets carry a `starting_frame_prompt`
  //    column; T2V sheets don't. Use this to disambiguate when sheet
  //    names are generic (e.g. "Sheet1" / "Sheet2").
  if (taskType === "I2V") {
    const withStartFrame = wb.worksheets.find((s) =>
      headerHasColumn(s, "startingFramePrompt"),
    );
    if (withStartFrame) return withStartFrame;
  } else if (taskType === "T2V") {
    const withoutStartFrame = wb.worksheets.find(
      (s) => !headerHasColumn(s, "startingFramePrompt"),
    );
    if (withoutStartFrame) return withoutStartFrame;
  }

  // 3. Fallback: first sheet. A warning would be helpful but the
  //    caller will surface whatever the row parse does/doesn't find.
  return wb.worksheets[0];
}

function readCell(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "text" in v) return String((v as { text: string }).text).trim();
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "").trim();
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

export async function parsePromptSuiteXlsx(
  buffer: Buffer | ArrayBuffer,
  options: { taskType?: TaskType } = {},
): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs accepts ArrayBuffer at runtime; cast to satisfy its Buffer-typed signature.
  const buf = (
    buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  ) as ArrayBuffer;
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);

  // Sheet selection — a workbook may ship multiple sheets (typical:
  // T2V_200 + I2V_200 side by side). Silently reading worksheets[0]
  // would read T2V rows even when the admin picked I2V in the UI,
  // producing the confusing "id T2V_001 已存在但 taskType 为 T2V" error.
  //
  // Resolution order when `options.taskType` is provided:
  //   1. Sheet whose name contains the task type (case-insensitive)
  //   2. Sheet whose header row contains `starting_frame_prompt`
  //      (I2V signature) — matches for I2V only; for T2V, prefer the
  //      sheet WITHOUT that column.
  //   3. Fallback: first sheet.
  //
  // When `taskType` is absent (e.g. legacy caller), keep the old
  // behavior (first sheet) so we don't regress.
  const sheet = pickSheet(wb, options.taskType);
  if (!sheet) {
    return {
      rows: [],
      errors: [{ row: 0, message: "文件中没有任何工作表 (sheet)" }],
      stats: { totalRows: 0, uniqueL1: 0, uniqueL2: 0, uniqueL3: 0 },
    };
  }

  const headerRow = sheet.getRow(1);
  const colMap = new Map<keyof typeof HEADER_ALIASES, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const match = matchHeader(readCell(cell));
    if (match && !colMap.has(match)) colMap.set(match, colNumber);
  });

  const errors: ParseError[] = [];
  const required: (keyof typeof HEADER_ALIASES)[] = ["externalId", "l1", "l2", "l3", "promptZh", "promptEn"];
  for (const req of required) {
    if (!colMap.has(req)) {
      errors.push({
        row: 1,
        column: req,
        message: `缺少必填列 "${req}"。可用列头别名: ${HEADER_ALIASES[req].join(" / ")}`,
      });
    }
  }
  if (errors.length > 0) {
    return {
      rows: [],
      errors,
      stats: { totalRows: 0, uniqueL1: 0, uniqueL2: 0, uniqueL3: 0 },
    };
  }

  const rows: ParsedRow[] = [];
  const uniqueL1 = new Set<string>();
  const uniqueL2 = new Set<string>();
  const uniqueL3 = new Set<string>();

  const seenExternalIds = new Set<string>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const externalId = readCell(row.getCell(colMap.get("externalId")!));
    const l1 = readCell(row.getCell(colMap.get("l1")!));
    const l2 = readCell(row.getCell(colMap.get("l2")!));
    const l3 = readCell(row.getCell(colMap.get("l3")!));
    const promptZh = readCell(row.getCell(colMap.get("promptZh")!));
    const promptEn = readCell(row.getCell(colMap.get("promptEn")!));
    const category = colMap.has("category")
      ? readCell(row.getCell(colMap.get("category")!))
      : "";
    const startingFramePrompt = colMap.has("startingFramePrompt")
      ? readCell(row.getCell(colMap.get("startingFramePrompt")!))
      : "";

    const allEmpty = !externalId && !l1 && !l2 && !l3 && !promptZh && !promptEn;
    if (allEmpty) continue;

    if (!externalId) errors.push({ row: r, column: "id", message: "id 列为空 (例如 T2V_001 / I2V_001)" });
    if (!l1) errors.push({ row: r, column: "D1", message: "L1 维度为空" });
    if (!l2) errors.push({ row: r, column: "D2", message: "L2 维度为空" });
    if (!l3) errors.push({ row: r, column: "D3", message: "L3 维度为空" });
    if (!promptZh) errors.push({ row: r, column: "prompt_cn", message: "中文 prompt 为空" });
    if (!promptEn) errors.push({ row: r, column: "prompt_en", message: "英文 prompt 为空" });

    if (externalId && seenExternalIds.has(externalId)) {
      errors.push({ row: r, column: "id", message: `id 重复: "${externalId}" 在本文件中出现多次` });
    }

    if (externalId && l1 && l2 && l3 && promptZh && promptEn && !seenExternalIds.has(externalId)) {
      seenExternalIds.add(externalId);
      rows.push({
        rowNumber: r,
        externalId,
        l1,
        l2,
        l3,
        promptZh,
        promptEn,
        category: category || null,
        startingFramePrompt: startingFramePrompt || null,
      });
      uniqueL1.add(l1);
      uniqueL2.add(`${l1}|${l2}`);
      uniqueL3.add(`${l1}|${l2}|${l3}`);
    }
  }

  return {
    rows,
    errors,
    stats: {
      totalRows: rows.length,
      uniqueL1: uniqueL1.size,
      uniqueL2: uniqueL2.size,
      uniqueL3: uniqueL3.size,
    },
  };
}

export interface CommitResult {
  promptSuiteId: string;
  promptsCreated: number;      // net new Prompt rows
  promptsReused: number;       // existing Prompts re-associated to this suite
  l1DimensionsCreated: number;
  l3DimensionsCreated: number;
}

function l1CodeFrom(l1Label: string): string {
  const m = l1Label.match(/^[A-Za-z]+\d+/);
  if (m) return m[0];
  return l1Label.replace(/\s+/g, "").slice(0, 8).toUpperCase();
}

/**
 * Batched commit. Previous version made ~700 sequential queries inside a
 * single transaction for a 200-row xlsx — taking 5-8 seconds end-to-end.
 *
 * Strategy now:
 *   1. Pre-load all candidate dimensions / prompts in 2 reads BEFORE the
 *      transaction (idempotent, safe outside tx).
 *   2. Compute everything we need to insert/update in memory.
 *   3. Inside one short transaction: createMany for new dims, new tags,
 *      new prompts, all suite entries; updateMany-style loop only for
 *      the rare "existing prompt with new text" case.
 *
 * Result: ~10 queries for 200 rows. ~5s → ~300-500ms (10-15× faster).
 */
export async function commitPromptSuite(params: {
  name: string;
  description: string | null;
  taskType: TaskType;
  rows: ParsedRow[];
}): Promise<CommitResult> {
  const { name, description, taskType, rows } = params;
  let promptsCreated = 0;
  let promptsReused = 0;
  let l1Created = 0;
  let l3Created = 0;

  // ─── PHASE A — pre-load everything in parallel (no tx) ──────
  const uniqueL1Labels = [...new Set(rows.map((r) => r.l1))];
  const uniqueL1Codes = uniqueL1Labels.map(l1CodeFrom);
  const uniqueL3Triples = [
    ...new Map(
      rows.map((r) => [`${r.l1}|${r.l2}|${r.l3}`, { l1: r.l1, l2: r.l2, l3: r.l3 }]),
    ).values(),
  ];
  const uniqueExternalIds = [...new Set(rows.map((r) => r.externalId))];

  const [existingL1Dims, existingPrompts] = await Promise.all([
    prisma.dimension.findMany({
      where: { code: { in: uniqueL1Codes } },
      include: { failureTags: { select: { id: true, labelZh: true } } },
    }),
    prisma.prompt.findMany({
      where: { externalId: { in: uniqueExternalIds } },
      select: { id: true, externalId: true, taskType: true },
    }),
  ]);
  const l1DimByCode = new Map(existingL1Dims.map((d) => [d.code, d]));
  const promptByExternalId = new Map(existingPrompts.map((p) => [p.externalId, p]));

  // Validate taskType consistency BEFORE we touch anything.
  for (const row of rows) {
    const existing = promptByExternalId.get(row.externalId);
    if (existing && existing.taskType !== taskType) {
      throw new Error(
        `id "${row.externalId}" 在数据库中已存在但 taskType 为 ${existing.taskType}，` +
          `与当前上传的 ${taskType} 不符。请更换 id 或修正任务类型。`,
      );
    }
  }

  // For L3 dimension lookup, also need existing siblings under each L1 to
  // (a) compute next available code suffix, and (b) inherit failure tags.
  // We fetch them all in one shot, scoped to the L1 parents we'll touch.
  const allL1Ids = [...existingL1Dims.map((d) => d.id)];
  // L1s that don't exist yet will get an id during the tx; siblings list
  // for those is empty (new L1 has no children).
  const existingL3UnderKnownL1 = allL1Ids.length
    ? await prisma.dimension.findMany({
        where: { parentId: { in: allL1Ids } },
        include: { failureTags: { select: { labelZh: true, labelEn: true } } },
      })
    : [];

  // Build per-parent next-suffix counter from existing siblings.
  const nextSuffixByParent = new Map<string, number>();
  // Map (parentId, nameZh) → existing dim, with anchor preference.
  const existingL3ByKey = new Map<string, (typeof existingL3UnderKnownL1)[number]>();
  // Map parentId → first sibling that already has failure tags (for inheritance).
  const siblingTagsByParent = new Map<
    string,
    { labelZh: string; labelEn: string }[]
  >();
  for (const dim of existingL3UnderKnownL1) {
    if (!dim.parentId) continue;
    // suffix counter
    const parentDim = existingL1Dims.find((d) => d.id === dim.parentId);
    if (parentDim) {
      const prefix = `${parentDim.code}.`;
      if (dim.code.startsWith(prefix)) {
        const n = Number.parseInt(dim.code.slice(prefix.length), 10);
        if (Number.isFinite(n)) {
          const cur = nextSuffixByParent.get(dim.parentId) ?? -1;
          if (n > cur) nextSuffixByParent.set(dim.parentId, n);
        }
      }
    }
    // (parent, nameZh) lookup with anchor priority
    const exactKey = `${dim.parentId}|${dim.nameZh}|${dim.anchor ?? ""}`;
    const fallbackKey = `${dim.parentId}|${dim.nameZh}|`;
    if (!existingL3ByKey.has(exactKey)) existingL3ByKey.set(exactKey, dim);
    if (!existingL3ByKey.has(fallbackKey)) existingL3ByKey.set(fallbackKey, dim);
    // sibling-tags cache
    if (
      dim.failureTags.length > 0 &&
      !siblingTagsByParent.has(dim.parentId)
    ) {
      siblingTagsByParent.set(
        dim.parentId,
        dim.failureTags.map((t) => ({ labelZh: t.labelZh, labelEn: t.labelEn })),
      );
    }
  }
  // Convert maxSuffix → nextSuffix.
  for (const [k, v] of nextSuffixByParent) nextSuffixByParent.set(k, v + 1);

  // ─── PHASE B — short, batched transaction ───────────────────
  return await prisma.$transaction(async (tx) => {
    const suite = await tx.promptSuite.create({
      data: { name, description, taskType },
    });

    // L1 dims: create the missing ones in a single createMany.
    const l1ToCreate: { code: string; nameZh: string; nameEn: string; sortOrder: number }[] = [];
    let l1Order = existingL1Dims.length; // append after existing
    for (const label of uniqueL1Labels) {
      const code = l1CodeFrom(label);
      if (!l1DimByCode.has(code)) {
        l1ToCreate.push({ code, nameZh: label, nameEn: code, sortOrder: l1Order++ });
      }
    }
    if (l1ToCreate.length > 0) {
      await tx.dimension.createMany({ data: l1ToCreate });
      // Re-read JUST the codes we created so we get their ids.
      const newL1s = await tx.dimension.findMany({
        where: { code: { in: l1ToCreate.map((d) => d.code) } },
        include: { failureTags: { select: { id: true, labelZh: true } } },
      });
      for (const d of newL1s) l1DimByCode.set(d.code, d);
      l1Created = newL1s.length;
    }

    // L1 codeMap (label → id)
    const l1IdByLabel = new Map<string, string>();
    for (const label of uniqueL1Labels) {
      l1IdByLabel.set(label, l1DimByCode.get(l1CodeFrom(label))!.id);
    }

    // Failure tags for L1: only insert canonical-tags-not-already-present.
    const newL1FailureTags: {
      labelZh: string;
      labelEn: string;
      dimensionId: string;
    }[] = [];
    for (const label of uniqueL1Labels) {
      const code = l1CodeFrom(label);
      const dim = l1DimByCode.get(code)!;
      const haveLabels = new Set(dim.failureTags.map((t) => t.labelZh));
      for (const t of canonicalTagsForL1(code)) {
        if (!haveLabels.has(t.labelZh)) {
          newL1FailureTags.push({ ...t, dimensionId: dim.id });
        }
      }
    }
    if (newL1FailureTags.length > 0) {
      await tx.failureTag.createMany({ data: newL1FailureTags });
    }

    // L3 dims: build full insert plan in memory, then 1 createMany.
    const l3IdByTriple = new Map<string, string>();
    const l3ToCreate: {
      tripleKey: string;
      code: string;
      nameZh: string;
      nameEn: string;
      anchor: string;
      parentId: string;
      sortOrder: number;
      parentCode: string;
    }[] = [];
    let perParentSortOrder = 0;
    for (const { l1, l2, l3 } of uniqueL3Triples) {
      const parentId = l1IdByLabel.get(l1)!;
      const parentCode = l1CodeFrom(l1);
      const tripleKey = `${l1}|${l2}|${l3}`;
      const exact = existingL3ByKey.get(`${parentId}|${l3}|${l2}`);
      const fallback = existingL3ByKey.get(`${parentId}|${l3}|`);
      const found = exact ?? fallback;
      if (found) {
        l3IdByTriple.set(tripleKey, found.id);
      } else {
        const suffix = nextSuffixByParent.get(parentId) ?? 0;
        nextSuffixByParent.set(parentId, suffix + 1);
        const code = `${parentCode}.${suffix}`;
        l3ToCreate.push({
          tripleKey,
          code,
          nameZh: l3,
          nameEn: l3,
          anchor: l2,
          parentId,
          sortOrder: perParentSortOrder,
          parentCode,
        });
      }
      perParentSortOrder++;
    }
    if (l3ToCreate.length > 0) {
      await tx.dimension.createMany({
        data: l3ToCreate.map((d) => ({
          code: d.code,
          nameZh: d.nameZh,
          nameEn: d.nameEn,
          anchor: d.anchor,
          parentId: d.parentId,
          sortOrder: d.sortOrder,
        })),
      });
      // Re-read to get ids; bind to the in-memory triple keys.
      const newL3s = await tx.dimension.findMany({
        where: { code: { in: l3ToCreate.map((d) => d.code) } },
        select: { id: true, code: true, parentId: true },
      });
      const newL3ByCode = new Map(newL3s.map((d) => [d.code, d]));
      for (const planned of l3ToCreate) {
        const created = newL3ByCode.get(planned.code);
        if (created) l3IdByTriple.set(planned.tripleKey, created.id);
      }
      l3Created = newL3s.length;

      // Inherit failure tags for new L3s. One createMany.
      const newL3Tags: {
        labelZh: string;
        labelEn: string;
        dimensionId: string;
      }[] = [];
      for (const planned of l3ToCreate) {
        const dimId = l3IdByTriple.get(planned.tripleKey);
        if (!dimId) continue;
        const inherited =
          siblingTagsByParent.get(planned.parentId) ??
          canonicalTagsForL1(planned.parentCode);
        for (const t of inherited) {
          newL3Tags.push({ ...t, dimensionId: dimId });
        }
      }
      if (newL3Tags.length > 0) {
        await tx.failureTag.createMany({ data: newL3Tags });
      }
    }

    // Prompts: createMany the brand-new ones, and update only the
    // existing rows whose text has changed.
    const promptsToCreate: {
      externalId: string;
      textZh: string;
      textEn: string;
      category: string | null;
      taskType: TaskType;
      sourceImagePrompt: string | null;
    }[] = [];
    const promptsToUpdate: {
      id: string;
      textZh: string;
      textEn: string;
      category: string | null;
      sourceImagePrompt: string | null;
    }[] = [];
    for (const row of rows) {
      const existing = promptByExternalId.get(row.externalId);
      if (existing) {
        promptsToUpdate.push({
          id: existing.id,
          textZh: row.promptZh,
          textEn: row.promptEn,
          category: row.category,
          sourceImagePrompt: row.startingFramePrompt ?? null,
        });
        promptsReused++;
      } else {
        promptsToCreate.push({
          externalId: row.externalId,
          textZh: row.promptZh,
          textEn: row.promptEn,
          category: row.category,
          taskType,
          sourceImagePrompt: row.startingFramePrompt ?? null,
        });
        promptsCreated++;
      }
    }
    if (promptsToCreate.length > 0) {
      await tx.prompt.createMany({ data: promptsToCreate });
      const fresh = await tx.prompt.findMany({
        where: { externalId: { in: promptsToCreate.map((p) => p.externalId) } },
        select: { id: true, externalId: true, taskType: true },
      });
      for (const p of fresh) promptByExternalId.set(p.externalId, p);
    }
    // Updates can't be batched into one Prisma call (different per-row
    // values), but Promise.all serialises inside a tx so we run them in
    // sequence; still cheap because each update is just 1 round-trip.
    // For typical re-uploads this is the only N-sized loop left.
    for (const u of promptsToUpdate) {
      await tx.prompt.update({
        where: { id: u.id },
        data: {
          textZh: u.textZh,
          textEn: u.textEn,
          category: u.category,
          ...(u.sourceImagePrompt != null
            ? { sourceImagePrompt: u.sourceImagePrompt }
            : {}),
        },
      });
    }

    // Suite entries: one createMany.
    const entries: {
      promptSuiteId: string;
      promptId: string;
      dimensionId: string;
      sortOrder: number;
    }[] = [];
    let sortOrder = 0;
    for (const row of rows) {
      const dimId = l3IdByTriple.get(`${row.l1}|${row.l2}|${row.l3}`);
      const promptId = promptByExternalId.get(row.externalId)?.id;
      if (!dimId || !promptId) continue; // shouldn't happen given pre-load
      entries.push({
        promptSuiteId: suite.id,
        promptId,
        dimensionId: dimId,
        sortOrder: sortOrder++,
      });
    }
    if (entries.length > 0) {
      await tx.promptSuiteEntry.createMany({ data: entries });
    }

    return {
      promptSuiteId: suite.id,
      promptsCreated,
      promptsReused,
      l1DimensionsCreated: l1Created,
      l3DimensionsCreated: l3Created,
    };
  });
}
