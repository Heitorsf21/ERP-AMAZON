import { createHash } from "node:crypto";

export type TsvRecord = Record<string, string>;

export function parseTsvRecords(input: Buffer | string): TsvRecord[] {
  let text = typeof input === "string" ? input : input.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = lines[0]!.split("\t").map(normalizeKey);
  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    const row: TsvRecord = {};
    headers.forEach((header, index) => {
      row[header] = (cols[index] ?? "").trim();
    });
    return row;
  });
}

export function pick(row: TsvRecord, aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[normalizeKey(alias)];
    if (value != null && value.trim() !== "") return value.trim();
  }
  return "";
}

export function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/[^\d,.-]/g, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function parseIntValue(value: string | null | undefined): number {
  const n = parseNumber(value);
  return n == null ? 0 : Math.trunc(n);
}

export function parseCentavos(value: string | null | undefined): number {
  const n = parseNumber(value);
  return n == null ? 0 : Math.round(n * 100);
}

export function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed);

  const br = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})(.*)$/);
  if (br) {
    const [, dd, mm, yyyy, rest] = br;
    const iso = `${yyyy}-${mm}-${dd}${rest?.trim() ? `T${rest.trim()}` : "T00:00:00Z"}`;
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return new Date(t);
  }

  return null;
}

export function parseMonthOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMonth = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth) return new Date(`${isoMonth[1]}-${isoMonth[2]}-01T00:00:00.000Z`);

  const monthYear = trimmed.match(/^(\d{1,2})[/-](\d{4})$/);
  if (monthYear) {
    const month = monthYear[1]!.padStart(2, "0");
    return new Date(`${monthYear[2]}-${month}-01T00:00:00.000Z`);
  }

  const date = parseDateOrNull(trimmed);
  if (!date) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-")
    .replace(/[^\w-]/g, "");
}

export function compactKey(parts: Array<string | number | Date | null | undefined>) {
  const raw = parts
    .map((part) => {
      if (part instanceof Date) return part.toISOString();
      return String(part ?? "").trim();
    })
    .filter(Boolean)
    .join("|");
  return raw || hashObject(parts);
}

export function hashObject(value: unknown): string {
  return createHash("sha1")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}
