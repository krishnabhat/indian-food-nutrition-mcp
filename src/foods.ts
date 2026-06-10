import type { DB } from "./db.js";

export interface Food {
  code: string;
  name: string;
  grup: string | null;
  source: string;
  basis: string; // 'per_100g'
  cal: number | null;
  protein_g: number | null;
  carb_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  serving_desc: string | null;
  serving_g: number | null;
}

// Words that mark a raw/unprepared IFCT ingredient. When the user logs a meal
// they almost always ate the cooked dish, so these are demoted unless the query
// explicitly asks for them (e.g. "raw mango").
const RAW_MARKERS = ["raw", "dried", "uncooked", "dehydrated"];

interface Score {
  allMatched: number; // 1 if every query token is present
  matched: number; // count of query tokens present
  cooked: number; // 1 for INDB cooked dishes (preferred for meal logging)
  notRaw: number; // 0 if it's a raw ingredient the query didn't ask for, else 1
  firstPos: number;
  nameLen: number;
}

/**
 * Ranked substring search over the foods table. The corpus is small (~1.5k rows),
 * so a token-coverage LIKE scan beats the complexity of an FTS index here.
 * Ranking, in order: all-tokens match, more tokens matched, then prefer cooked
 * INDB dishes over raw IFCT ingredients (people log what they ate, not raw
 * staples), then demote "raw/dried" entries the query didn't ask for, then
 * earlier match position, then shorter name. This makes "rice" resolve to
 * "Boiled rice" (~117 kcal/100g) instead of "Rice, raw, milled" (~356).
 */
export function searchFoods(db: DB, query: string, limit = 8): Food[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);

  if (tokens.length === 0) return [];

  const queryWantsRaw = RAW_MARKERS.some((m) => tokens.includes(m));

  const likeClauses = tokens.map(() => "LOWER(name) LIKE ?").join(" OR ");
  const params = tokens.map((t) => `%${t}%`);
  const candidates = db
    .prepare(`SELECT * FROM foods WHERE ${likeClauses}`)
    .all(...params) as Food[];

  const scored = candidates
    .map((f) => ({ f, score: scoreFood(f, tokens, queryWantsRaw) }))
    .filter((s) => s.score.matched > 0)
    .sort((a, b) => compareScore(a.score, b.score));

  return scored.slice(0, limit).map((s) => s.f);
}

function scoreFood(food: Food, tokens: string[], queryWantsRaw: boolean): Score {
  const name = food.name.toLowerCase();
  let matched = 0;
  let firstPos = Number.MAX_SAFE_INTEGER;
  for (const t of tokens) {
    const pos = name.indexOf(t);
    if (pos >= 0) {
      matched += 1;
      if (pos < firstPos) firstPos = pos;
    }
  }
  const isRaw = !queryWantsRaw && RAW_MARKERS.some((m) => name.includes(m));
  return {
    allMatched: matched === tokens.length ? 1 : 0,
    matched,
    cooked: food.source === "INDB" ? 1 : 0,
    notRaw: isRaw ? 0 : 1,
    firstPos,
    nameLen: food.name.length,
  };
}

function compareScore(a: Score, b: Score): number {
  if (a.allMatched !== b.allMatched) return b.allMatched - a.allMatched;
  if (a.matched !== b.matched) return b.matched - a.matched;
  if (a.notRaw !== b.notRaw) return b.notRaw - a.notRaw;
  if (a.cooked !== b.cooked) return b.cooked - a.cooked;
  if (a.firstPos !== b.firstPos) return a.firstPos - b.firstPos;
  return a.nameLen - b.nameLen;
}

export function getFood(db: DB, code: string): Food | undefined {
  return db.prepare("SELECT * FROM foods WHERE code = ?").get(code) as Food | undefined;
}
