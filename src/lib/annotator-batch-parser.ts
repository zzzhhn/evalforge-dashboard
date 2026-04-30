import ExcelJS from "exceljs";

export type AccountTypeInput = "INTERNAL" | "VENDOR";

export interface AnnotatorBatchRow {
  rowNumber: number;
  name: string;
  email: string;
  accountType: AccountTypeInput;
  groupName: string | null;
}

export interface AnnotatorBatchParseError {
  row: number;
  column?: string;
  message: string;
}

export interface AnnotatorBatchParseResult {
  rows: AnnotatorBatchRow[];
  errors: AnnotatorBatchParseError[];
  stats: { totalRows: number; internal: number; outsourced: number; withGroup: number };
}

const HEADER_ALIASES: Record<keyof Pick<AnnotatorBatchRow, "name" | "email" | "accountType" | "groupName">, string[]> = {
  name: ["name", "姓名", "名字", "Name"],
  email: ["email", "邮箱", "E-mail", "Email"],
  accountType: ["accountType", "account_type", "账户类型", "账号类型", "类型", "type"],
  groupName: ["group", "groupName", "组", "分组", "group_name", "小组"],
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

function readCell(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "text" in v) return String((v as { text: string }).text).trim();
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "").trim();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "hyperlink" in v && "text" in v) {
    return String((v as { text: string }).text).trim();
  }
  return String(v).trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAccountType(raw: string, rowNumber: number): { type: AccountTypeInput; error?: string } {
  if (!raw) return { type: "INTERNAL" };
  const n = normalize(raw);
  if (n === "internal" || n === "内部" || n === "公司内部" || n === "inhouse") {
    return { type: "INTERNAL" };
  }
  if (
    n === "outsourced" ||
    n === "outsource" ||
    n === "vendor" ||
    n === "外包" ||
    n === "ext" ||
    n === "external"
  ) {
    return { type: "VENDOR" };
  }
  return { type: "INTERNAL", error: `row ${rowNumber}: 账户类型 "${raw}" 无法识别，使用 INTERNAL/VENDOR / 内部 / 外包` };
}

export async function parseAnnotatorBatchXlsx(
  buffer: Buffer | ArrayBuffer,
): Promise<AnnotatorBatchParseResult> {
  const wb = new ExcelJS.Workbook();
  const buf = (
    buffer instanceof ArrayBuffer
      ? buffer
      : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  ) as ArrayBuffer;
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const sheet = wb.worksheets[0];
  if (!sheet) {
    return {
      rows: [],
      errors: [{ row: 0, message: "文件中没有任何工作表 (sheet)" }],
      stats: { totalRows: 0, internal: 0, outsourced: 0, withGroup: 0 },
    };
  }

  const headerRow = sheet.getRow(1);
  const colMap = new Map<keyof typeof HEADER_ALIASES, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const match = matchHeader(readCell(cell));
    if (match && !colMap.has(match)) colMap.set(match, colNumber);
  });

  const errors: AnnotatorBatchParseError[] = [];
  const required: (keyof typeof HEADER_ALIASES)[] = ["name", "email"];
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
    return { rows: [], errors, stats: { totalRows: 0, internal: 0, outsourced: 0, withGroup: 0 } };
  }

  return finalizeRows(
    (r, col) => readCell(sheet.getRow(r).getCell(colMap.get(col)!)),
    (col) => colMap.has(col),
    sheet.rowCount,
  );
}

export function parseAnnotatorBatchCsv(text: string): AnnotatorBatchParseResult {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n").filter((line, idx, arr) => !(idx === arr.length - 1 && line === ""));
  if (lines.length === 0) {
    return {
      rows: [],
      errors: [{ row: 0, message: "CSV 内容为空" }],
      stats: { totalRows: 0, internal: 0, outsourced: 0, withGroup: 0 },
    };
  }

  const header = splitCsvLine(lines[0]);
  const colMap = new Map<keyof typeof HEADER_ALIASES, number>();
  header.forEach((cell, idx) => {
    const match = matchHeader(cell);
    if (match && !colMap.has(match)) colMap.set(match, idx + 1);
  });

  const errors: AnnotatorBatchParseError[] = [];
  const required: (keyof typeof HEADER_ALIASES)[] = ["name", "email"];
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
    return { rows: [], errors, stats: { totalRows: 0, internal: 0, outsourced: 0, withGroup: 0 } };
  }

  const data: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    data.push(splitCsvLine(lines[i]));
  }

  return finalizeRows(
    (r, col) => {
      const arr = data[r - 2];
      if (!arr) return "";
      const idx = colMap.get(col);
      if (idx == null) return "";
      return (arr[idx - 1] ?? "").trim();
    },
    (col) => colMap.has(col),
    data.length + 1,
  );
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuote = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function finalizeRows(
  readAt: (rowNumber: number, col: keyof typeof HEADER_ALIASES) => string,
  hasCol: (col: keyof typeof HEADER_ALIASES) => boolean,
  maxRow: number,
): AnnotatorBatchParseResult {
  const rows: AnnotatorBatchRow[] = [];
  const errors: AnnotatorBatchParseError[] = [];
  let internal = 0;
  let outsourced = 0;
  let withGroup = 0;
  const seenEmails = new Set<string>();

  for (let r = 2; r <= maxRow; r++) {
    const name = readAt(r, "name");
    const email = readAt(r, "email");
    const accountTypeRaw = hasCol("accountType") ? readAt(r, "accountType") : "";
    const groupName = hasCol("groupName") ? readAt(r, "groupName") : "";

    const allEmpty = !name && !email && !accountTypeRaw && !groupName;
    if (allEmpty) continue;

    if (!name) errors.push({ row: r, column: "name", message: "姓名为空" });
    if (!email) errors.push({ row: r, column: "email", message: "邮箱为空" });
    if (email && !EMAIL_RE.test(email)) {
      errors.push({ row: r, column: "email", message: `邮箱格式不合法: "${email}"` });
    }

    const lowerEmail = email.toLowerCase();
    if (email && seenEmails.has(lowerEmail)) {
      errors.push({ row: r, column: "email", message: `邮箱重复: "${email}" 在本文件中出现多次` });
    }

    const { type, error } = parseAccountType(accountTypeRaw, r);
    if (error) errors.push({ row: r, column: "accountType", message: error });

    if (name && email && EMAIL_RE.test(email) && !seenEmails.has(lowerEmail)) {
      seenEmails.add(lowerEmail);
      rows.push({
        rowNumber: r,
        name,
        email: lowerEmail,
        accountType: type,
        groupName: groupName || null,
      });
      if (type === "INTERNAL") internal++;
      else outsourced++;
      if (groupName) withGroup++;
    }
  }

  return {
    rows,
    errors,
    stats: { totalRows: rows.length, internal, outsourced, withGroup },
  };
}
