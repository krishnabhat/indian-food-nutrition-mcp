import type { DB } from "./db.js";
import { dbPath } from "./db.js";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Path for the always-current CSV mirror of the meal log. Defaults to meals.csv
 * next to the SQLite DB; override with NUTRITION_CSV_PATH.
 */
export function csvPath(): string {
  return process.env.NUTRITION_CSV_PATH || join(dirname(dbPath()), "meals.csv");
}

const COLUMNS = [
  "id",
  "logged_at",
  "log_date",
  "meal",
  "description",
  "food_code",
  "qty",
  "unit",
  "grams",
  "cal",
  "protein_g",
  "carb_g",
  "fat_g",
  "fiber_g",
  "estimated",
] as const;

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Rewrite the CSV mirror from the current meal_entries. The log is small, so a
 * full rewrite on each mutation is simplest and keeps the file always correct.
 * Failures are non-fatal: the SQLite DB stays the source of truth.
 */
export function writeMealsCsv(db: DB): void {
  try {
    const rows = db
      .prepare(`SELECT ${COLUMNS.join(", ")} FROM meal_entries ORDER BY logged_at ASC, id ASC`)
      .all() as Record<string, unknown>[];
    const lines = [COLUMNS.join(",")];
    for (const r of rows) lines.push(COLUMNS.map((c) => esc(r[c])).join(","));
    writeFileSync(csvPath(), lines.join("\n") + "\n");
  } catch (err) {
    console.error("nutrition-mcp: failed to write CSV mirror:", (err as Error).message);
  }
}
