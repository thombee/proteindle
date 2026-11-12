# Proteindle

A daily game: which has more protein? Each day brings ten match-ups. Each one shows two foods in everyday portions, such as a cup of cooked black beans against a large egg, and the player taps the one with more protein. The answer shows both figures, and after ten the player gets a score to share.

An earlier version of the game, in which the player worked out a mystery food from Wordle-style tiles, is kept on the `guess-the-food` branch.

## Play it

Open `index.html` in a browser. There is no build step and nothing to install.

- `index.html?day=7` plays day 7 in preview mode: any day can be played and nothing is saved.
- `npm run bundle` writes `dist/proteindle.html`, the whole game as one file, and `dist/proteindle-preview.html`, the same in preview mode.

## How a day is put together

`dailyRounds` in `logic.js` builds the ten match-ups from the day number, so everyone gets the same ones.

| Rule | Value |
|---|---|
| Match-ups a day | 10: seven plant against animal, three plant against plant |
| Order | 3 easy, 4 medium, 3 hard |
| Easy | the winner has 1.8 to 4 times the loser's protein |
| Medium | 1.35 to 1.8 times |
| Hard | 1.12 to 1.35 times |
| Smallest contest | the winner has at least 4 g, and at least 0.8 g more than the loser |
| Plant foods | the 106 everyday ones (tier 1 in the data); none appears twice in a day |
| Animal foods | 20 |
| Who wins | of the seven plant-against-animal match-ups, the plant wins 2, 3, 4 or 5, drawn per day with chances of 15%, 35%, 35% and 15% |
| New day | local midnight; day 1 is 12 November 2026 |

Over time the plant wins half of these match-ups. That is deliberate and is stated in the game's help: it means neither "always pick the meat" nor "always pick the plant" beats guessing, and it shows plants and animal foods trading wins at realistic portions. Because the number of plant wins changes from day to day, counting them does not give away the last answers. Every individual figure is still straight from the data.

Portions are the serving in the food data. Servings of one or two ounces, tablespoons or slices can also appear doubled, and nine animal foods have a larger portion as well (two or three eggs, a whole chicken breast).

Plant foods used one day sit out the next. For a plant-against-animal match-up the animal food is chosen first, evenly among those that fit, so each one turns up about as often as the others allow (pork chop fits fewest match-ups and is on about 15% of days; the most frequent are on about 43%). Animal foods not used in the two days before are preferred, then those not used the day before, then any. Days are worked out in blocks of seven so that this stays quick; the first day of a block can repeat a food from the day before.

Other things the game does:

- **Progress** is kept in the browser's `localStorage` under `proteindle:v2`. There are no accounts and no server. If storage is blocked the game still plays and says progress is not being saved.
- **The score card** shows the score, how many of the three closest calls (the hard match-ups) the player got, a recap of the day's match-ups, a share button, stats and a countdown to the next day.
- **The streak** counts days played in a row, whatever the score.
- **Midnight**: a day nobody has started moves on by itself. A day in progress can be finished, and counts for the day it belongs to, only while the page stays open: reloading or coming back after midnight always starts the new day.
- **Two tabs** stay in step and do not overwrite each other. A tab that has fallen behind takes the saved game when tapped, rather than recording the tap.
- **Sharing** copies the score and a row of squares, and never the foods. Set `SITE_URL` in `app.js` to add the game's address.

## Files

| File | What it is |
|---|---|
| `index.html`, `style.css` | The page |
| `app.js` | Shows the match-ups and the score card, saves progress |
| `logic.js` | The rules: portions, the day's match-ups, scoring, share text, stats. No DOM, so it runs in Node too |
| `foods.js` | Generated food data. Do not edit by hand |
| `data/picks.json` | The hand-curated list of foods and the USDA record each one uses |
| `data/SOURCES.md` | Where the data comes from and how to regenerate it |

## Commands

```sh
npm install          # once, only needed for the browser tests
npm test             # rule checks against the real data, and colour contrast (Node only)
npm run e2e          # plays the game in headless Google Chrome; SHOTS=dir saves screenshots
BROWSER=webkit npm run e2e    # the same in Safari's engine (also BROWSER=firefox)
npm run bundle       # single-file builds in dist/
npm run foods        # rebuilds foods.js from the USDA downloads (see data/SOURCES.md)
```

## The food data

Every number comes from USDA FoodData Central, which is public domain. `data/picks.json` names the exact record for each food, and `scripts/build-foods.mjs` copies the numbers out and refuses to run if a record does not resolve. Each food's name says what state it is in ("Lentils (cooked)", "Spinach (raw)").

Foods that are missing because no trustworthy record was found: seitan, nutritional yeast and red lentils.

## Before going public

- **The name is taken.** Two live sites already use "Proteindle": a biology game at proteindle.github.io and, closer to this one, a "which food has more protein" game at proteindle.vercel.app. Decide whether to rename.
- Set `SITE_URL` in `app.js`.
- Changing the food list or the rules in `dailyRounds` changes the match-ups of every day, so do it between days, not while people are mid-game.
- The research behind the design is in `~/Documents/research/daily-games-what-makes-them-stick-2026-11.md`.
