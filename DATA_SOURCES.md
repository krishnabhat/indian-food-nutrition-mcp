# Data sources and licensing

This project is licensed **AGPL-3.0-or-later** (see LICENSE). Data posture for the
public distribution:

- **Bundled and redistributed:** IFCT 2017 (AGPL-compatible via the upstream
  package) and USDA SR Legacy (public domain).
- **NOT redistributed:** INDB cooked-recipe data. The INDB repository has no
  license, so we do not ship its data. The server runs fine without it. If you
  want the cooked-dish layer for personal use, run `npm run build:indb` in a
  cloned repo: it downloads the workbook directly from the authors' public
  repository to your machine and generates the local extract. Redistribution
  permission has been requested from the authors; the data ships bundled if and
  when it is granted.

## IFCT 2017 — raw ingredients (542 foods)

- File: `data/ifct-compositions.csv`
- Origin: Indian Food Composition Tables 2017, National Institute of Nutrition (NIN),
  Hyderabad (a government of India publication).
- Obtained via the npm/JSR package `@nodef/ifct2017`, whose source headers declare
  **`SPDX-License-Identifier: AGPL-3.0-or-later`**.
- **Launch implication:** AGPL-3.0 is strong copyleft with a network clause: if you
  run a hosted/remote service built on AGPL code/data, you must offer the complete
  corresponding source to users. This is *compatible with your plan* to open-source
  the MCP servers (BYO-model infra). If you ever want a closed-source hosted tier,
  source the IFCT data directly from the NIN publication instead and confirm its
  terms, rather than relying on the AGPL package.

## INDB — cooked Indian recipes (1,014 dishes)

- Files: `data/indb-recipes.csv` (normalized extract, committed),
  `data/INDB.xlsx` (raw source, git-ignored; regenerate the CSV with
  `npm run build:indb`).
- Origin: Indian Nutrient Databank (INDB), Jaacks Lab —
  https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-
  Associated open-access publication: "Development of an Indian Food Composition
  Database" (2024).
- **License: NOT specified in the repository.** Open-access in a paper does not by
  itself grant redistribution rights for a product.
- **Launch implication (action required):** before distributing INDB-derived data in
  a public/commercial product, contact the authors for explicit redistribution
  permission, OR replace this layer with a properly licensed / self-built recipe
  database. Until then, keep INDB usage to personal/dev only.

## USDA SR Legacy — non-Indian foods and drinks (7,793 items)

- Files: `data/usda-foods.csv` (normalized extract, committed),
  `data/usda-src/` (raw download, git-ignored; regenerate with `npm run build:usda`).
- Origin: USDA FoodData Central, SR Legacy (2018-04). U.S. Department of Agriculture.
- **License: public domain** (U.S. government work). Free to use and redistribute,
  including commercially. No restriction.
- Covers Western/general foods and beverages (alcohol, soda, coffee, tea, juice, milk).

## Summary

| Dataset | Use now (personal) | Public/commercial launch |
|---|---|---|
| IFCT 2017 (`@nodef`, AGPL-3.0) | OK | OK if servers stay open-source; else source from NIN directly |
| INDB (no license) | OK (personal) | Blocked until permission obtained or replaced |
| USDA SR Legacy (public domain) | OK | OK, no restriction |
