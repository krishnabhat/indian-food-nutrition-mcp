# indian-food-nutrition-mcp

**Your AI assistant can finally count Indian food calories correctly.**

An MCP server that lets you log meals through Claude (and soon ChatGPT) in plain
language: *"2 rotis and a katori of dal"*, or just a photo of your plate. Calories
and macros come from **India's official food composition data (IFCT 2017, National
Institute of Nutrition)** plus USDA for everything else, not from US-centric
databases that think a roti is a tortilla.

## Why

Every popular calorie database is built on USDA data. It is wrong for home-cooked
Indian food: wrong oils, wrong preparations, no katori, no idli. The one app with a
great Indian database keeps it locked behind a subscription with no API. Meanwhile
the Indian government published the real data. This project wraps it for the AI you
already talk to, and gives that AI memory of what you actually ate.

- **Indian-accurate:** IFCT 2017, measured across six Indian regions by NIN
  Hyderabad. Ghee, atta, dals, regional varieties.
- **Everything else too:** 7,800+ USDA foods and drinks (public domain).
- **Household units:** log in katori, plates, pieces, cups. Quantity is mandatory;
  the model asks instead of guessing portions.
- **Photo logging:** show Claude your plate (upload or URL via `fetch_image`).
- **Your AI gets memory:** `get_history` returns your real intake so the model can
  coach you ("your protein is low on training days") against data, not vibes.
- **Local-first and private:** SQLite on your machine, plus an always-current CSV
  mirror at `~/.nutrition-mcp/meals.csv`. No account, no cloud, no telemetry.

## Quickstart (Claude Desktop)

```bash
npm install -g indian-food-nutrition-mcp
```

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "nutrition": {
      "command": "indian-food-nutrition-mcp"
    }
  }
}
```

Restart Claude Desktop, then just talk:

> "Log breakfast: 3 idlis and a small bowl of sambar"
> "How much protein have I had today?"
> "Here's a photo of my lunch, log it"
> "Look at my last week and tell me where my diet is failing"

## Tools

| Tool | What it does |
|---|---|
| `search_food` | Search 8,300+ foods (IFCT + USDA), per-100g cal/protein/carb/fat/fiber |
| `log_meal` | Log items with mandatory qty + household unit; DB-derived macros |
| `get_day` | A day's log + totals |
| `get_history` | Per-day totals over a range, the AI-coaching context block |
| `edit_entry` / `delete_entry` | Fix mistakes so history stays honest |
| `fetch_image` | Pull a food photo from a URL so the model can see and log it |

## Data and licensing

Code is **AGPL-3.0-or-later**. Bundled data: IFCT 2017 + USDA SR Legacy (public
domain). The INDB cooked-dish dataset (dal, dosa, idli as dishes with serving
sizes) is supported by the code but **not redistributed** until its authors grant
a license; generate it locally for personal use with `npm run build:indb`.
Full provenance: [DATA_SOURCES.md](DATA_SOURCES.md).

## Hosted version (ChatGPT, mobile, zero setup)

This local server works with Claude Desktop today. A hosted version, which works
as a ChatGPT connector and syncs across devices, is coming. Open an issue titled
"hosted" or watch releases to get in early.

## Storage

`~/.nutrition-mcp/nutrition.db` (SQLite, WAL) + `~/.nutrition-mcp/meals.csv`
(auto-maintained mirror). Override with `NUTRITION_DB_PATH` / `NUTRITION_CSV_PATH`.

## Credits

- Indian Food Composition Tables 2017, National Institute of Nutrition, Hyderabad
  (via the `@nodef/ifct2017` package, AGPL)
- USDA FoodData Central, SR Legacy
- Indian Nutrient Databank (Jaacks Lab), code support, data pending license
