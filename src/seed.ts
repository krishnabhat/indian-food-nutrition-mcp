import type { Database } from "better-sqlite3";
import { parse } from "csv-parse/sync";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KJ_PER_KCAL = 4.184;

/** Resolve a bundled data file (data/ lives next to dist/ at runtime). */
function dataPath(file: string): string {
  const here = dirname(fileURLToPath(import.meta.url)); // dist/ at runtime
  return join(here, "..", "data", file);
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * One-time ETL of IFCT 2017 raw-ingredient nutrition into the foods table.
 * IFCT energy (enerc) is in kJ; we convert to kcal. All macros are per 100 g.
 * Columns: enerc (energy kJ), protcnt (protein g), fatce (fat g),
 * choavldf (available carbohydrate g), fibtg (total dietary fibre g).
 */
export function seedIfEmpty(db: Database): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM foods").get() as { n: number };
  if (count.n > 0) return;
  seedIfct(db); // Indian raw ingredients
  // INDB cooked-dish data is not redistributed until the authors grant a license
  // (see DATA_SOURCES.md). The extract is optional: present locally (generate with
  // `npm run build:indb` for personal use) it seeds; absent, the server still works
  // on IFCT + USDA.
  seedFlatCsv(db, "indb-recipes.csv", "Indian recipes", { optional: true });
  seedFlatCsv(db, "usda-foods.csv", "Foods & drinks"); // non-Indian foods + drinks (USDA SR)
}

/** IFCT 2017 raw ingredients. Energy (enerc) is kJ; macros per 100 g. */
function seedIfct(db: Database): void {
  const rows = readCsv(dataPath("ifct-compositions.csv"));
  const insert = db.prepare(`
    INSERT OR REPLACE INTO foods
      (code, name, grup, source, basis, cal, protein_g, carb_g, fat_g, fiber_g, serving_desc, serving_g)
    VALUES
      (@code, @name, @grup, 'IFCT', 'per_100g', @cal, @protein_g, @carb_g, @fat_g, @fiber_g, NULL, NULL)
  `);
  const tx = db.transaction((records: Record<string, string>[]) => {
    for (const r of records) {
      const protein = num(r.protcnt);
      const carb = num(r.choavldf);
      const fat = num(r.fatce);
      const enercKj = num(r.enerc);
      insert.run({
        code: r.code,
        name: r.name,
        grup: r.grup ?? null,
        cal: energyCal(enercKj, protein, carb, fat),
        protein_g: protein,
        carb_g: carb,
        fat_g: fat,
        fiber_g: num(r.fibtg),
      });
    }
  });
  tx(rows);
}

/**
 * Energy in (food) calories per 100 g. Prefer IFCT's measured value (kJ -> cal);
 * fall back to the Atwater estimate from macros when IFCT leaves energy blank,
 * which it does for pure fats/oils (otherwise they'd seed as 0 despite being
 * ~900 cal/100 g). Returns null only when there's nothing to go on.
 */
function energyCal(
  enercKj: number | null,
  protein: number | null,
  carb: number | null,
  fat: number | null
): number | null {
  if (enercKj !== null && enercKj > 0) return round(enercKj / KJ_PER_KCAL, 1);
  if (protein === null && carb === null && fat === null) return null;
  const atwater = 4 * (protein ?? 0) + 4 * (carb ?? 0) + 9 * (fat ?? 0);
  return atwater > 0 ? round(atwater, 1) : enercKj === null ? null : 0;
}

/**
 * Seed a pre-normalized flat food CSV (INDB cooked Indian recipes, USDA foods/drinks).
 * Columns: code,name,source,cal,protein_g,carb_g,fat_g,fiber_g,serving_desc,serving_g.
 * `group` labels the food group; per-100 g basis; serving fields may be blank.
 */
function seedFlatCsv(
  db: Database,
  file: string,
  group: string,
  opts: { optional?: boolean } = {}
): void {
  const path = dataPath(file);
  if (opts.optional && !existsSync(path)) {
    console.error(`nutrition-mcp: optional dataset ${file} not present, skipping (see DATA_SOURCES.md).`);
    return;
  }
  const rows = readCsv(path);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO foods
      (code, name, grup, source, basis, cal, protein_g, carb_g, fat_g, fiber_g, serving_desc, serving_g)
    VALUES
      (@code, @name, @grup, @source, 'per_100g', @cal, @protein_g, @carb_g, @fat_g, @fiber_g, @serving_desc, @serving_g)
  `);
  const tx = db.transaction((records: Record<string, string>[]) => {
    for (const r of records) {
      insert.run({
        code: r.code,
        name: r.name,
        grup: group,
        source: r.source,
        cal: num(r.cal),
        protein_g: num(r.protein_g),
        carb_g: num(r.carb_g),
        fat_g: num(r.fat_g),
        fiber_g: num(r.fiber_g),
        serving_desc: r.serving_desc || null,
        serving_g: num(r.serving_g),
      });
    }
  });
  tx(rows);
}

function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
  return parse(text, { columns: true, skip_empty_lines: true, comment: "#" }) as Record<
    string,
    string
  >[];
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
