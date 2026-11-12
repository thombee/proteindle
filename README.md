# Proteindle

A daily guessing game about protein in plant foods. Each day there is one mystery plant food and six guesses to find it. Every guess is a food, and its tiles say how the mystery food compares per 100 g: same food group or not, and more or less protein, calories, carbs and fat. When the round ends, a card shows the food's protein per serving, per 100 g and per 100 calories next to eight familiar animal foods.

## Play it

Open `index.html` in a browser. There is no build step and nothing to install.

- `index.html?day=7` plays day 7 in preview mode: any day can be played and nothing is saved.
- `npm run bundle` writes `dist/proteindle.html`, the whole game as one file, and `dist/proteindle-preview.html`, the same in preview mode.

## How the game works

| Rule | Value | Where |
|---|---|---|
| Guesses | 6 | `MAX_GUESSES` in `logic.js` |
| Hint (first letter) | offered after 4 guesses; given free when a wrong food matches every tile | `HINT_AFTER` in `logic.js` |
| Green tile | within 0.5 g of protein, 10 calories, 1 g of carbs or 0.5 g of fat | `COLUMNS` in `logic.js` |
| Yellow tile | within 25%, or within 2 g of protein, 25 calories, 3 g of carbs or 2 g of fat when that allows more | `COLUMNS` in `logic.js` |
| New puzzle | local midnight; day 1 is 12 November 2026 | `EPOCH` in `logic.js` |
| Answers | the 83 "tier 1" foods, in the fixed order in `schedule.js`, then repeating from day 84 | `schedule.js` |
| Guessable foods | all 156 plant foods | `foods.js` |

Other things the game does:

- **The top row** collects what the tiles have shown so far, for example "protein between 15.3 and 21.2", and the first letter once the hint is known.
- **The hint** shows the answer's first letter in the top row. The player can ask for it after four guesses, which adds 💡 to the shared result. Some foods have the same group and numbers to within the green bands (iceberg lettuce and cucumber, for example), so when a wrong guess matches every tile the game gives the letter for free, without the 💡.
- **Midnight**: a page left open moves to the new day by itself if the round has not been started. A started round can be finished after midnight and counts for its own day; a finished round then offers the new plant.
- **The food list** puts foods from groups that are still possible first, and strikes out foods already guessed.
- **The pantry**: a food the player has guessed on any earlier day shows its protein in the list from then on, so regular players get better.
- **The bonus round** after each puzzle asks which has more protein, today's food or an animal food, by serving, by weight or by calorie. The question is picked by `bonusQuestion` in `logic.js` and is the same for everyone. It is chosen for being a close call, not for the plant winning.
- **The streak** counts days played in a row, win or lose.
- **Sharing** copies an emoji grid that shows the pattern of the guesses and never the food. Set `SITE_URL` in `app.js` to add the game's address to it.

Progress is kept in the browser's `localStorage` under `proteindle:v1`. There are no accounts and no server. Tabs open on the game keep each other up to date through the `storage` event, and a settings change reads the saved progress again before writing, so one tab cannot overwrite another's round. If the browser will not let the page use storage, the game still plays and says under the board that progress can't be saved.

## Files

| File | What it is |
|---|---|
| `index.html`, `style.css` | The page |
| `app.js` | Draws the board, handles input, saves progress |
| `logic.js` | The rules: grading, schedule, search, bonus question, share text, stats. No DOM, so it runs in Node too |
| `foods.js` | Generated food data. Do not edit by hand |
| `schedule.js` | The order of daily answers |
| `data/picks.json` | The hand-curated list of foods and the USDA record each one uses |
| `data/SOURCES.md` | Where the data comes from and how to regenerate it |

## Commands

```sh
npm install          # once, only needed for the browser tests
npm test             # rule checks against the real data, and colour contrast (Node only)
npm run e2e          # plays the game in headless Google Chrome; SHOTS=dir saves screenshots
BROWSER=webkit npm run e2e    # the same in Playwright's WebKit; BROWSER=firefox for Firefox
                              # (install them once: npx playwright-core install webkit firefox)
npm run bundle       # single-file builds in dist/
npm run simulate     # estimates how hard the game is with simulated players
npm run foods        # rebuilds foods.js from the USDA downloads (see data/SOURCES.md)
```

## The food data

Every number comes from USDA FoodData Central, which is public domain. `data/picks.json` names the exact record for each food, and `scripts/build-foods.mjs` copies the numbers out and refuses to run if a record does not resolve. Each food is measured as its name says: beans, lentils, rice and pasta are cooked, and a vegetable that is eaten both raw and cooked carries its state, as in "Broccoli (boiled)" or "Spinach (raw)".

Two foods (tempeh and falafel) have no fibre figure in their source record. The game does not grade on fibre, so they are included with fibre left empty.

Foods that are missing because no trustworthy record was found: seitan, nutritional yeast and red lentils.

## Difficulty

`npm run simulate` plays thousands of rounds with a player who only roughly knows each food's figures. With the current rules a casual player who takes the hint wins about 96% of rounds in about four guesses, and without the hint about 72%. A player who knows the figures well wins about 90% without the hint and 99% with it. The free hint for a wrong food with matching numbers is part of the model. These come from a rough model, not from real players.

## Before going public

- **The name is taken.** Two live sites already use "Proteindle": a biology game at proteindle.github.io and a higher/lower food game at proteindle.vercel.app. Decide whether to rename.
- Set `SITE_URL` in `app.js`.
- Do not rerun `scripts/build-schedule.mjs` once people are playing. The schedule repeats by position (day 84 is the first answer again), so adding answers changes which food every repeated day gets. New answers can be appended to the end of `schedule.js` only until the last scheduled day (day 83, 2 February 2027) has been played; after that, extending the schedule needs a planned change, for example a second list that starts on a given day.
- The research behind the design is in `~/Documents/research/daily-games-what-makes-them-stick-2026-11.md`.
