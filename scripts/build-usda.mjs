// One-time ETL: USDA SR Legacy CSVs -> data/usda-foods.csv (non-Indian foods + drinks).
// Public domain (U.S. government). Per-100g macros. Streams the 36MB nutrient file.
import { parse } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";

const SRC = "data/usda-src/FoodData_Central_sr_legacy_food_csv_2018-04";
// USDA nutrient_id -> our column. Energy(kcal)=1008, Protein=1003,
// Carbohydrate by difference=1005, Total fat=1004, Total dietary fiber=1079.
const NUTR = { "1008": "cal", "1003": "protein_g", "1005": "carb_g", "1004": "fat_g", "1079": "fiber_g" };

const macros = new Map(); // fdc_id -> { cal, protein_g, ... }
await new Promise((resolve, reject) => {
  createReadStream(`${SRC}/food_nutrient.csv`)
    .pipe(parse({ columns: true, skip_empty_lines: true }))
    .on("data", (r) => {
      const key = NUTR[r.nutrient_id];
      if (!key) return;
      const amt = parseFloat(r.amount);
      if (!Number.isFinite(amt)) return;
      let m = macros.get(r.fdc_id);
      if (!m) {
        m = {};
        macros.set(r.fdc_id, m);
      }
      m[key] = amt;
    })
    .on("end", resolve)
    .on("error", reject);
});

const foods = parseSync(readFileSync(`${SRC}/food.csv`, "utf8"), {
  columns: true,
  skip_empty_lines: true,
});

const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const out = [];
for (const f of foods) {
  const m = macros.get(f.fdc_id);
  if (!m || m.cal == null) continue; // require at least energy
  out.push({
    code: "USDA-" + f.fdc_id,
    name: f.description,
    source: "USDA",
    cal: r1(m.cal),
    protein_g: r1(m.protein_g ?? null),
    carb_g: r1(m.carb_g ?? null),
    fat_g: r1(m.fat_g ?? null),
    fiber_g: r1(m.fiber_g ?? null),
    serving_desc: "",
    serving_g: "",
  });
}

const cols = ["code", "name", "source", "cal", "protein_g", "carb_g", "fat_g", "fiber_g", "serving_desc", "serving_g"];
const esc = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
writeFileSync(
  "data/usda-foods.csv",
  [cols.join(",")].concat(out.map((o) => cols.map((c) => esc(o[c])).join(","))).join("\n") + "\n"
);
console.log(`wrote data/usda-foods.csv: ${out.length} foods`);
for (const o of out.filter((o) => /beer, regular, all|cola|pizza, chee|coffee, brewed|wine, table/i.test(o.name)).slice(0, 6))
  console.log(`  ${o.code}  ${o.name} | ${o.cal} cal/100g`);
