// One-time ETL: INDB.xlsx -> data/indb-recipes.csv (normalized, runtime-friendly).
// INDB = Indian Nutrient Databank (1,014 cooked Indian recipes), Jaacks Lab.
// Per-100g macros + a serving unit and per-serving macros; we derive serving grams.
import xlsx from 'xlsx';
import { writeFileSync, existsSync } from 'node:fs';

// We do not redistribute INDB (no license yet; see DATA_SOURCES.md). For personal
// use, fetch the workbook directly from the authors' public repository.
if (!existsSync('data/INDB.xlsx')) {
  console.log('data/INDB.xlsx not found, downloading from the INDB repository (personal use)...');
  const url = 'https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/INDB.xlsx';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  writeFileSync('data/INDB.xlsx', Buffer.from(await res.arrayBuffer()));
  console.log('downloaded data/INDB.xlsx');
}

const wb = xlsx.readFile('data/INDB.xlsx');
const rows = xlsx.utils.sheet_to_json(wb.Sheets['Nutrient Data'], { defval: null });

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const r1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

const out = [];
for (const r of rows) {
  const kcal100 = num(r.energy_kcal);
  const servKcal = num(r.unit_serving_energy_kcal);
  // Derive grams-per-serving from the energy ratio (robust across all macros).
  let serving_g = null;
  if (kcal100 && servKcal) serving_g = Math.round((servKcal / kcal100) * 100);
  out.push({
    code: 'INDB-' + String(r.food_code).trim(),
    name: String(r.food_name).trim(),
    source: 'INDB',
    cal: r1(kcal100),
    protein_g: r1(num(r.protein_g)),
    carb_g: r1(num(r.carb_g)),
    fat_g: r1(num(r.fat_g)),
    fiber_g: r1(num(r.fibre_g)),
    serving_desc: r.servings_unit ? String(r.servings_unit).trim() : null,
    serving_g,
  });
}

const cols = ['code','name','source','cal','protein_g','carb_g','fat_g','fiber_g','serving_desc','serving_g'];
const esc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = [cols.join(',')]
  .concat(out.map((o) => cols.map((c) => esc(o[c])).join(',')))
  .join('\n');
writeFileSync('data/indb-recipes.csv', csv + '\n');
console.log(`wrote data/indb-recipes.csv: ${out.length} recipes`);
console.log('sample with servings:');
for (const o of out.filter(o=>/dal|paneer|dosa|sabzi|sambar/i.test(o.name)).slice(0,6))
  console.log(`  ${o.code}  ${o.name} | ${o.cal}cal/100g | serving: ${o.serving_desc} (~${o.serving_g}g)`);
