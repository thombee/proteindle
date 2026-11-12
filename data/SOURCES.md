# Data sources

All nutrient values in `foods.js` come from **USDA FoodData Central** (FDC), https://fdc.nal.usda.gov/.

**Licence:** FDC data is a U.S. Government work in the public domain, published under CC0 1.0 Universal. No permission is needed. USDA asks for this citation: *U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.*

## Datasets used

| Dataset in `picks.json` | Release | Download URL | SHA-256 of the zip (downloaded 2026-11-12) |
|---|---|---|---|
| `SR Legacy` | April 2018 (final release of the Standard Reference database) | https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip | `0fe8ae486a2c8eb42cb96413f058deb51863a46c8fb8eeb4b1fb45006dd338ef` |
| `FNDDS` | FNDDS 2021-2023, FDC release 2024-10-31 | https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip | `dfb06ae7ddc397ccd570b91c14b75438ab2ba39f64f22d321f61d4a52a77f3eb` |

SR Legacy is the main source. FNDDS supplies the five foods SR Legacy lacks or covers only through brand-name records: `tvp` (textured vegetable protein, dry), `soy-yogurt`, `cornflakes`, `granola` and `oat-milk`.

Each food in `picks.json` names its dataset, its FDC id (`fdcId`) and the record's exact description. You can look any record up at `https://fdc.nal.usda.gov/food-details/<fdcId>/nutrients`.

Nutrients used (FDC nutrient id): energy in kcal (1008), protein (1003), carbohydrate by difference (1005), total fat (1004) and total dietary fibre (1079), all per 100 g of the food.

## Regenerating `foods.js`

```sh
mkdir -p data/raw/sr-legacy-2018-04 data/raw/fndds-2024-10-31
curl -fL -o data/raw/sr-legacy-2018-04/sr_legacy_json.zip \
  https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip
curl -fL -o data/raw/fndds-2024-10-31/survey_json.zip \
  https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip
shasum -a 256 data/raw/*/*.zip     # compare with the table above
unzip -o -d data/raw/sr-legacy-2018-04 data/raw/sr-legacy-2018-04/sr_legacy_json.zip
unzip -o -d data/raw/fndds-2024-10-31  data/raw/fndds-2024-10-31/survey_json.zip

node scripts/build-foods.mjs       # writes foods.js; exits non-zero and lists every problem if a pick fails
node scripts/check-foods.mjs       # counts, energy sanity flags, tier 1 near-duplicates (add --table for every value)
```

The unzipped files the build expects are:

- `data/raw/sr-legacy-2018-04/FoodData_Central_sr_legacy_food_json_2018-04.json`
- `data/raw/fndds-2024-10-31/surveyDownload.json`

`data/raw/` is gitignored. The build needs Node 24 and no npm packages. It only JSON-parses the raw files and copies numbers out of them.

## Curation rules (`data/picks.json`)

- **Resolving records.** Every pick must match exactly one record by dataset and `fdcId`, and that record's description must equal the one in `picks.json`. The record must also have all five nutrients. Otherwise the build fails.
- **Servings.** A serving comes from the record's own portion list, and the build checks that its gram weight is one of that record's portions. Six servings were chosen by hand and are marked `"servingSource": "chosen"`. Each is a multiple or fraction of a portion in the same record: hummus 2 tbsp (from 1 tbsp = 15 g), rolled oats ½ cup (40.5 g, from 1 cup = 81 g), black olives 5 large (from 1 large = 4.4 g), dried apricots 8 halves (from 1 half = 3.5 g), prunes 4 (from 1 prune = 9.5 g) and bacon 3 slices (from 1 slice = 11.5 g).
- **Tiers.** Tier 2 foods can be guessed but are never the daily answer. Within each group, no two tier 1 foods are closer than 1 g protein, 15 kcal, 2 g carbs and 1 g fat. `check-foods.mjs` enforces this and exits non-zero if a pair appears.
