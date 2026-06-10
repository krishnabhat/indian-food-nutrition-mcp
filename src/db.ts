import Database from "better-sqlite3";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { seedIfEmpty } from "./seed.js";

export type DB = Database.Database;

/**
 * Bump when the bundled food data or its transform changes, so existing personal
 * DBs refresh the foods table on next start (meal_entries are preserved).
 * v2: rename kcal -> cal, add Atwater energy fallback for oils.
 * v3: add USDA SR Legacy (non-Indian foods + drinks).
 */
const DATA_VERSION = 3;

/**
 * Resolve the SQLite file path. Personal, single-user store.
 * Override with NUTRITION_DB_PATH (useful for tests / multiple profiles).
 */
export function dbPath(): string {
  const fromEnv = process.env.NUTRITION_DB_PATH;
  if (fromEnv) return fromEnv;
  return join(homedir(), ".nutrition-mcp", "nutrition.db");
}

let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  refreshFoodsIfStale(db);
  seedIfEmpty(db);
  _db = db;
  return db;
}

function initSchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS foods (
      code         TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      grup         TEXT,
      source       TEXT NOT NULL,      -- 'IFCT' (raw ingredients) | 'INDB' (cooked recipes)
      basis        TEXT NOT NULL,      -- 'per_100g'
      cal          REAL,               -- food calories (kcal) per 100 g
      protein_g    REAL,
      carb_g       REAL,
      fat_g        REAL,
      fiber_g      REAL,
      serving_desc TEXT,               -- e.g. "katori", "parantha" (INDB recipes)
      serving_g    REAL                -- grams in one serving, when known
    );

    CREATE TABLE IF NOT EXISTS meal_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      logged_at  TEXT NOT NULL,        -- ISO 8601 datetime
      log_date   TEXT NOT NULL,        -- YYYY-MM-DD (local), for fast day queries
      meal       TEXT,                 -- breakfast | lunch | dinner | snack | null
      food_code  TEXT,                 -- IFCT/INDB code, nullable for free-text items
      description TEXT NOT NULL,        -- what the user said, e.g. "2 roti"
      qty        REAL,                 -- household quantity, e.g. 2
      unit       TEXT,                 -- household unit, e.g. "katori", "small plate", "piece"
      grams      REAL,                 -- resolved quantity in grams, if known
      cal        REAL NOT NULL DEFAULT 0,
      protein_g  REAL NOT NULL DEFAULT 0,
      carb_g     REAL NOT NULL DEFAULT 0,
      fat_g      REAL NOT NULL DEFAULT 0,
      fiber_g    REAL NOT NULL DEFAULT 0,
      estimated  INTEGER NOT NULL DEFAULT 0  -- 1 when macros are LLM estimates, not DB-derived
    );

    CREATE INDEX IF NOT EXISTS idx_meal_entries_date ON meal_entries(log_date);
  `);
  migrate(db);
}

/** Idempotent migrations for DBs created by earlier versions. */
function migrate(db: DB): void {
  renameColumn(db, "foods", "kcal", "cal");
  renameColumn(db, "meal_entries", "kcal", "cal");

  const foodCols = columns(db, "foods");
  if (!foodCols.has("serving_desc")) db.exec("ALTER TABLE foods ADD COLUMN serving_desc TEXT");
  if (!foodCols.has("serving_g")) db.exec("ALTER TABLE foods ADD COLUMN serving_g REAL");

  const mealCols = columns(db, "meal_entries");
  if (!mealCols.has("qty")) db.exec("ALTER TABLE meal_entries ADD COLUMN qty REAL");
  if (!mealCols.has("unit")) db.exec("ALTER TABLE meal_entries ADD COLUMN unit TEXT");
}

/** Drop and re-seed the foods table when the bundled data version changed. */
function refreshFoodsIfStale(db: DB): void {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'data_version'").get() as
    | { value: string }
    | undefined;
  const current = row ? parseInt(row.value, 10) : 0;
  if (current === DATA_VERSION) return;
  db.exec("DELETE FROM foods"); // meal_entries keep their denormalized macros
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('data_version', ?)").run(
    String(DATA_VERSION)
  );
}

function columns(db: DB, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
  );
}

function renameColumn(db: DB, table: string, from: string, to: string): void {
  const cols = columns(db, table);
  if (cols.has(from) && !cols.has(to)) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  }
}
