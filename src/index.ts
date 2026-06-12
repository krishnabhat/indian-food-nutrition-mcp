#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "./db.js";
import { searchFoods } from "./foods.js";
import { writeMealsCsv, csvPath } from "./csv.js";
import {
  logMeal,
  getDay,
  getHistory,
  editEntry,
  deleteEntry,
  type MealItemInput,
} from "./log.js";

const db = getDb();

const server = new McpServer({
  name: "indian-food-nutrition-mcp",
  version: "1.0.2",
});

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "search_food",
  {
    title: "Search Indian foods (IFCT 2017 + INDB)",
    description:
      "Search Indian food data (IFCT 2017 raw ingredients + INDB cooked dishes) and " +
      "their per-100g nutrition. Use this to find a food_code before logging a meal so " +
      "calories are database-accurate for Indian food, not estimated. INDB results are " +
      "cooked dishes and include a serving size. Returns code, name, group, source, " +
      "per-100g cal/protein/carb/fat/fiber, and serving (when known). Prefer the result " +
      "that matches how the food was prepared (cooked dish over raw ingredient; a tempered/" +
      "fried version over a plain one). If the top result looks off, search again with a " +
      "more specific phrase before settling.",
    inputSchema: {
      query: z.string().describe('Food to search, e.g. "rice raw milled" or "wheat flour".'),
      limit: z.number().int().min(1).max(25).optional().describe("Max results (default 8)."),
    },
  },
  async ({ query, limit }) => {
    const results = searchFoods(db, query, limit ?? 8).map((f) => ({
      food_code: f.code,
      name: f.name,
      group: f.grup,
      source: f.source, // IFCT = raw ingredient, INDB = cooked dish
      per_100g: {
        cal: f.cal,
        protein_g: f.protein_g,
        carb_g: f.carb_g,
        fat_g: f.fat_g,
        fiber_g: f.fiber_g,
      },
      // For INDB recipes: one serving's label and grams, so "2 servings" = 2 * serving_g.
      serving: f.serving_g ? { desc: f.serving_desc, grams: f.serving_g } : null,
    }));
    return json({ query, count: results.length, results });
  }
);

const itemSchema = z
  .object({
    description: z.string().describe('What was eaten, e.g. "dal" or "rice".'),
    qty: z
      .number()
      .positive()
      .describe('REQUIRED quantity, e.g. 2. The amount in the given unit.'),
    unit: z
      .string()
      .describe(
        'REQUIRED household unit the user used, e.g. "katori", "cup", "bowl", ' +
          '"small plate", "large plate", "piece", "glass", "tbsp", "serving", or "g".'
      ),
    food_code: z
      .string()
      .optional()
      .describe("food_code from search_food. Provide this for accurate macros."),
    grams: z
      .number()
      .positive()
      .optional()
      .describe(
        "Resolved weight in grams. Estimate it from qty + unit (e.g. 2 katori dal ≈ 300g). " +
          "If omitted, the food's standard serving size is multiplied by qty (only correct " +
          "when unit is that serving)."
      ),
    cal: z.number().optional().describe("Fallback estimate, used only if food_code is omitted."),
    protein_g: z.number().optional(),
    carb_g: z.number().optional(),
    fat_g: z.number().optional(),
    fiber_g: z.number().optional(),
  })
  .describe("One eaten item. qty + unit are required; prefer food_code so macros are DB-derived.");

server.registerTool(
  "log_meal",
  {
    title: "Log a meal",
    description:
      "Log one or more eaten items to the personal nutrition history. QUANTITY IS " +
      "MANDATORY: every item needs qty + unit (e.g. 2 katori, 1 large plate, 3 pieces). " +
      "If the user did NOT say how much they ate, you MUST ask them before calling this " +
      "tool. Do not guess or assume a default portion. " +
      "PHOTO INPUT: if the user uploads a photo of food, identify each dish from the image, " +
      "then state your estimated qty + unit for each and confirm with the user before " +
      "logging (photo portion estimates are approximate, so confirmation is required). " +
      "ALWAYS USE THE DATABASE: for every recognizable food you MUST call search_food first " +
      "and log with a food_code. Do NOT estimate macros yourself when a database match " +
      "exists. Try a few phrasings if the first search is a poor match. When several entries " +
      "match, pick the one that fits how it was actually prepared: a cooked INDB dish over a " +
      "raw IFCT ingredient, and a prepared version over a plain/watery one (e.g. 'dal tadka' " +
      "or 'dal fry' over a thin 'dal' when the user's dal had a ghee/oil tempering). Only omit " +
      "food_code and supply your own macro estimate when search_food returns nothing " +
      "reasonable; such items are flagged estimated. Pass grams estimated from qty + unit. " +
      "Returns the logged entries and meal totals.",
    inputSchema: {
      items: z.array(itemSchema).min(1).describe("The items eaten in this meal."),
      when: z
        .string()
        .optional()
        .describe("ISO datetime of the meal (default: now)."),
      meal: z
        .enum(["breakfast", "lunch", "dinner", "snack"])
        .optional()
        .describe("Optional meal label."),
    },
  },
  async ({ items, when, meal }) => {
    const result = logMeal(db, items as MealItemInput[], { when, meal });
    return json(result);
  }
);

server.registerTool(
  "get_day",
  {
    title: "Get a day's log",
    description:
      "Return all logged items and macro totals for a given local date (default today). " +
      "Use to answer 'what did I eat today / how many calories so far'.",
    inputSchema: {
      date: z.string().optional().describe("Local date YYYY-MM-DD (default today)."),
    },
  },
  async ({ date }) => json(getDay(db, date))
);

server.registerTool(
  "get_history",
  {
    title: "Get nutrition history",
    description:
      "Return per-day macro totals over a date range, as a compact block for coaching. " +
      "Feed this to the model so it can program diet around real intake. " +
      "Specify start/end (YYYY-MM-DD) or days (default last 14).",
    inputSchema: {
      start: z.string().optional().describe("Start date YYYY-MM-DD."),
      end: z.string().optional().describe("End date YYYY-MM-DD (default today)."),
      days: z.number().int().min(1).max(365).optional().describe("Trailing days if no start."),
    },
  },
  async ({ start, end, days }) => json({ days: getHistory(db, { start, end, days }) })
);

server.registerTool(
  "edit_entry",
  {
    title: "Edit a logged item",
    description:
      "Correct a logged meal item by id (from log_meal/get_day) so the history stays " +
      "accurate. Pass only the fields to change.",
    inputSchema: {
      id: z.number().int().describe("Meal entry id."),
      description: z.string().optional(),
      qty: z.number().positive().optional(),
      unit: z.string().optional(),
      grams: z.number().positive().optional(),
      meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
      cal: z.number().optional(),
      protein_g: z.number().optional(),
      carb_g: z.number().optional(),
      fat_g: z.number().optional(),
      fiber_g: z.number().optional(),
    },
  },
  async ({ id, ...patch }) => json(editEntry(db, id, patch))
);

server.registerTool(
  "delete_entry",
  {
    title: "Delete a logged item",
    description: "Delete a logged meal item by id. Use to fix mistakes so history isn't poisoned.",
    inputSchema: {
      id: z.number().int().describe("Meal entry id to delete."),
    },
  },
  async ({ id }) => json({ id, deleted: deleteEntry(db, id) })
);

server.registerTool(
  "fetch_image",
  {
    title: "Fetch a food image from a URL",
    description:
      "Download an image from an http(s) URL and return it so you can SEE it. Use this " +
      "when the user gives a LINK to a food photo instead of uploading the image. After " +
      "viewing it, identify each dish, propose qty + unit per item, confirm portions with " +
      "the user, then call log_meal (photo portions are approximate).",
    inputSchema: {
      url: z.string().url().describe("Direct http(s) URL of the food image."),
    },
  },
  async ({ url }) => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Failed to fetch image: HTTP ${res.status}` }], isError: true };
      }
      const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!ct.startsWith("image/")) {
        return {
          content: [{ type: "text", text: `That URL is not an image (content-type: ${ct || "unknown"}).` }],
          isError: true,
        };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const MAX = 10 * 1024 * 1024;
      if (buf.length > MAX) {
        return {
          content: [{ type: "text", text: `Image too large (${(buf.length / 1e6).toFixed(1)} MB, max 10 MB).` }],
          isError: true,
        };
      }
      return {
        content: [
          { type: "image", data: buf.toString("base64"), mimeType: ct },
          {
            type: "text",
            text: "Image fetched. Identify each food, propose qty + unit per item, confirm with the user, then call log_meal.",
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error fetching image: ${(err as Error).message}` }], isError: true };
    }
  }
);

async function main() {
  writeMealsCsv(db); // keep the CSV mirror current from the first connection
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout is the MCP JSON-RPC channel.
  const foodCount = (db.prepare("SELECT COUNT(*) AS n FROM foods").get() as { n: number }).n;
  console.error(
    `indian-food-nutrition-mcp running (${foodCount} foods). CSV mirror: ` +
      csvPath() +
      ". Tools: search_food, log_meal, get_day, get_history, edit_entry, delete_entry, fetch_image."
  );
}

main().catch((err) => {
  console.error("nutrition-mcp fatal:", err);
  process.exit(1);
});
