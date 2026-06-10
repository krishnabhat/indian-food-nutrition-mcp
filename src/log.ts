import type { DB } from "./db.js";
import { getFood } from "./foods.js";
import { writeMealsCsv } from "./csv.js";

export interface MealItemInput {
  description: string;
  qty: number; // household quantity, e.g. 2
  unit: string; // household unit, e.g. "katori", "small plate", "piece", "cup"
  food_code?: string;
  grams?: number; // resolved weight; if omitted, derived from the food's serving size
  // LLM-estimate fallback (used only when food_code is absent):
  cal?: number;
  protein_g?: number;
  carb_g?: number;
  fat_g?: number;
  fiber_g?: number;
}

export interface Macros {
  cal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface MealEntry extends Macros {
  id: number;
  logged_at: string;
  log_date: string;
  meal: string | null;
  food_code: string | null;
  description: string;
  qty: number | null;
  unit: string | null;
  grams: number | null;
  estimated: boolean;
}

const ZERO: Macros = { cal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };

/** Local YYYY-MM-DD for an ISO datetime (or now). */
export function localDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Resolved extends Macros {
  estimated: boolean;
  grams: number | null;
}

/**
 * Resolve one item's macros. With a food_code, compute from the IFCT/INDB
 * per-100g values: grams is either given explicitly or derived as
 * qty * serving_g for foods with a known serving (e.g. "2 katori" of a dish
 * whose serving is one katori). Without a food_code, fall back to the
 * LLM-provided estimate, flagged as estimated.
 */
function resolveItem(db: DB, item: MealItemInput): Resolved {
  if (item.food_code) {
    const food = getFood(db, item.food_code);
    if (!food) {
      throw new Error(`Unknown food_code "${item.food_code}". Call search_food first.`);
    }
    let grams = item.grams ?? null;
    if (grams === null && food.serving_g != null) grams = round(item.qty * food.serving_g, 0);
    if (grams === null) {
      throw new Error(
        `No standard serving for "${food.name}" (${food.code}). Provide grams (estimate the ` +
          `weight of ${item.qty} ${item.unit}).`
      );
    }
    const factor = grams / 100;
    return {
      grams,
      estimated: false,
      cal: scale(food.cal, factor),
      protein_g: scale(food.protein_g, factor),
      carb_g: scale(food.carb_g, factor),
      fat_g: scale(food.fat_g, factor),
      fiber_g: scale(food.fiber_g, factor),
    };
  }
  // Free-text / estimate fallback.
  return {
    grams: item.grams ?? null,
    estimated: true,
    cal: item.cal ?? 0,
    protein_g: item.protein_g ?? 0,
    carb_g: item.carb_g ?? 0,
    fat_g: item.fat_g ?? 0,
    fiber_g: item.fiber_g ?? 0,
  };
}

function scale(v: number | null, factor: number): number {
  return round((v ?? 0) * factor, 1);
}

export interface LogResult {
  entries: MealEntry[];
  totals: Macros;
}

export function logMeal(
  db: DB,
  items: MealItemInput[],
  opts: { when?: string; meal?: string } = {}
): LogResult {
  const loggedAt = opts.when ? new Date(opts.when).toISOString() : new Date().toISOString();
  const logDate = localDate(loggedAt);

  const insert = db.prepare(`
    INSERT INTO meal_entries
      (logged_at, log_date, meal, food_code, description, qty, unit, grams,
       cal, protein_g, carb_g, fat_g, fiber_g, estimated)
    VALUES
      (@logged_at, @log_date, @meal, @food_code, @description, @qty, @unit, @grams,
       @cal, @protein_g, @carb_g, @fat_g, @fiber_g, @estimated)
  `);

  const ids: number[] = [];
  const tx = db.transaction((rows: MealItemInput[]) => {
    for (const item of rows) {
      const r = resolveItem(db, item);
      const info = insert.run({
        logged_at: loggedAt,
        log_date: logDate,
        meal: opts.meal ?? null,
        food_code: item.food_code ?? null,
        description: item.description,
        qty: item.qty,
        unit: item.unit,
        grams: r.grams,
        cal: r.cal,
        protein_g: r.protein_g,
        carb_g: r.carb_g,
        fat_g: r.fat_g,
        fiber_g: r.fiber_g,
        estimated: r.estimated ? 1 : 0,
      });
      ids.push(Number(info.lastInsertRowid));
    }
  });
  tx(items);

  const entries = ids.map((id) => getEntry(db, id)!);
  writeMealsCsv(db);
  return { entries, totals: sumMacros(entries) };
}

export function getEntry(db: DB, id: number): MealEntry | undefined {
  const row = db.prepare("SELECT * FROM meal_entries WHERE id = ?").get(id) as
    | (Omit<MealEntry, "estimated"> & { estimated: number })
    | undefined;
  if (!row) return undefined;
  return { ...row, estimated: !!row.estimated };
}

export function getDay(db: DB, date?: string): LogResult {
  const d = date ?? localDate();
  const rows = db
    .prepare("SELECT * FROM meal_entries WHERE log_date = ? ORDER BY logged_at ASC")
    .all(d) as (Omit<MealEntry, "estimated"> & { estimated: number })[];
  const entries = rows.map((r) => ({ ...r, estimated: !!r.estimated }));
  return { entries, totals: sumMacros(entries) };
}

export interface DayTotal extends Macros {
  date: string;
  items: number;
}

/** Per-day totals over a range, for the LLM round-trip / coaching context. */
export function getHistory(
  db: DB,
  opts: { start?: string; end?: string; days?: number } = {}
): DayTotal[] {
  let start = opts.start;
  let end = opts.end ?? localDate();
  if (!start) {
    const n = opts.days ?? 14;
    const d = new Date(end + "T00:00:00");
    d.setDate(d.getDate() - (n - 1));
    start = localDate(d.toISOString());
  }
  const rows = db
    .prepare(
      `SELECT log_date AS date, COUNT(*) AS items,
              ROUND(SUM(cal),1) AS cal, ROUND(SUM(protein_g),1) AS protein_g,
              ROUND(SUM(carb_g),1) AS carb_g, ROUND(SUM(fat_g),1) AS fat_g,
              ROUND(SUM(fiber_g),1) AS fiber_g
         FROM meal_entries
        WHERE log_date BETWEEN ? AND ?
        GROUP BY log_date
        ORDER BY log_date ASC`
    )
    .all(start, end) as DayTotal[];
  return rows;
}

export function editEntry(
  db: DB,
  id: number,
  patch: Partial<Pick<MealEntry, "description" | "qty" | "unit" | "grams" | "meal"> & Macros>
): MealEntry {
  const existing = getEntry(db, id);
  if (!existing) throw new Error(`No meal entry with id ${id}.`);

  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const key of [
    "description",
    "qty",
    "unit",
    "grams",
    "meal",
    "cal",
    "protein_g",
    "carb_g",
    "fat_g",
    "fiber_g",
  ] as const) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (fields.length === 0) return existing;
  db.prepare(`UPDATE meal_entries SET ${fields.join(", ")} WHERE id = @id`).run(params);
  writeMealsCsv(db);
  return getEntry(db, id)!;
}

export function deleteEntry(db: DB, id: number): boolean {
  const info = db.prepare("DELETE FROM meal_entries WHERE id = ?").run(id);
  if (info.changes > 0) writeMealsCsv(db);
  return info.changes > 0;
}

export function sumMacros(entries: Macros[]): Macros {
  const t = { ...ZERO };
  for (const e of entries) {
    t.cal += e.cal;
    t.protein_g += e.protein_g;
    t.carb_g += e.carb_g;
    t.fat_g += e.fat_g;
    t.fiber_g += e.fiber_g;
  }
  return {
    cal: round(t.cal, 1),
    protein_g: round(t.protein_g, 1),
    carb_g: round(t.carb_g, 1),
    fat_g: round(t.fat_g, 1),
    fiber_g: round(t.fiber_g, 1),
  };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
