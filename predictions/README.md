# Prediction payload contract

Each file here is generated in its model repo by a `generate_web_picks.py` /
`generate_web_predictions.py` entrypoint, validated by
`.github/scripts/validate_predictions.py`, and committed either by the matching workflow
in `.github/workflows/` or -- for `real_estate.json` and `magicformula.json` -- by a
scheduled job on the local machine (see those sections for why). The front end (`script.js`) renders them and nothing else — if a
field is not listed here, the site ignores it.

**The validator is the contract.** Every rule below is enforced, and a violation fails
the workflow instead of publishing. Before wiring up a new generator, run it against
your output locally — it is stdlib-only, so no install is needed:

```bash
python3 generate_web_picks.py --output /tmp/candidate.json
python3 path/to/website/.github/scripts/validate_predictions.py nfl /tmp/candidate.json
```

The validator's own tests double as executable examples of every rule:

```bash
python3 -m unittest discover -s .github/scripts -p 'test_*.py'
```

## Shared rules

### `generated_at` — the field that breaks generators

Required on every payload, and it must be **a real ISO 8601 timestamp carrying a UTC
offset**. In Python that is exactly:

```python
datetime.now(timezone.utc).isoformat()   # 2026-09-09T13:04:22.109384+00:00
```

Three ways to get this wrong, all rejected:

- **`null`** — means "the generator never ran". The site shows an explicit "not
  published yet" state rather than pretending the slate is empty. Every one of the 70
  failed runs between 2026-04-19 and 2026-06-18 would have published this.
- **No offset** (`datetime.now().isoformat()`, the tempting default). Browsers parse a
  naive ISO string as *the viewer's* local time, so the published "Updated:" line would
  shift by each visitor's own UTC offset.
- **Not "now"** — the slate date, the model's training cutoff, a cached value. The
  validator refuses any payload whose `generated_at` is **more than 6 hours old** at
  publish time, because the generator runs in the same workflow job that validates it.
  Clock skew up to an hour into the future is tolerated; beyond that is rejected.

That 6-hour publish gate is separate from the front end's *display* staleness
thresholds (NBA 36h, NFL 10d, F1 10d). The gate decides whether a payload may be
published at all; the thresholds decide whether an already-published payload is still
presented as current. Past its threshold the site says when it was last published and
shows nothing, rather than passing an old slate off as today's.

### Everything else

- **Numbers must be JSON numbers.** `"0.68"` and `null` are rejected, including for
  `pred_spread`, which the front end would otherwise render as a fabricated `Spread: 0`.
  Booleans are not numbers.
- **Probabilities are in `[0, 1]`, not percent.** Emit `0.68`, never `68`.
- **An empty list (`games: []` / `predictions: []`) is a valid payload** meaning "no
  fixtures in this window" (off day, bye week). It is not the same as a missing file,
  and it is not the same as a failed generator — which is why `generated_at` is policed
  so hard.
- Optional `season_status` (`"preseason" | "in_season" | "offseason"`) and
  `next_season_start` (`YYYY-MM-DD`) override the front end's built-in season windows.
  Emit them if the model repo knows the real schedule — the front end's fallback dates
  are approximate. **`season_status` is validated against that exact list**: the front
  end treats anything other than `"in_season"` as off-season, so a typo like
  `"In_Season"` would hide a live slate behind a "between seasons" message.

## `nfl.json`

```json
{
  "generated_at": "2026-09-09T13:04:22Z",
  "season": 2026,
  "week": 1,
  "season_type": "regular",
  "season_status": "in_season",
  "next_season_start": "2026-09-10",
  "games": [
    {
      "kickoff": "2026-09-11T00:20:00Z",
      "away_team": "DAL",
      "home_team": "PHI",
      "away_team_full": "Dallas Cowboys",
      "home_team_full": "Philadelphia Eagles",
      "pick": "PHI",
      "pred_spread": -6.5,
      "pred_total": 47.5,
      "ml_win_prob": 0.68,
      "confidence": 0.68
    }
  ]
}
```

| field | required | type | meaning |
|---|---|---|---|
| `generated_at` | yes | ISO 8601 + offset | when the payload was produced — see above |
| `season` | yes | int | e.g. `2026`. Rendered as "Week 1 -- 2026 season" |
| `week` | yes | int `1`-`25` | 1-18 regular season; continues 19+ for playoffs |
| `season_type` | no | `"preseason"`\|`"regular"`\|`"postseason"` | defaults to `"regular"`; changes the week label |
| `games[].kickoff` | no | ISO 8601 + offset | rendered as local kickoff time when present |
| `games[].away_team` / `home_team` | yes | non-empty string | short code (`DAL`) — used as the display label |
| `games[].away_team_full` / `home_team_full` | no | string | full name, used for `title=` tooltips |
| `games[].pick` | yes | string | **must be byte-equal to `away_team` or `home_team`** — the front end bolds the pick by exact match, so `"phi"` renders a slate with nothing highlighted |
| `games[].pred_spread` | yes | number | **home-team perspective**; negative = home favoured (`-6.5` = home by 6.5) |
| `games[].pred_total` | no | number | predicted combined points |
| `games[].ml_win_prob` | yes | number in `[0,1]` | **home team's** win probability |
| `games[].confidence` | yes | number in `[0,1]`, `>= 0.5` | model confidence in `pick`, i.e. `max(p, 1-p)` |

### The sign convention, stated once

`pred_spread` and `ml_win_prob` are both **from the home team's perspective**, and
`pick` is a moneyline pick. Those three have to agree, and the validator enforces it:

- `ml_win_prob > 0.5` → `pick` **must** be `home_team`
- `ml_win_prob < 0.5` → `pick` **must** be `away_team`
- `ml_win_prob == 0.5` → either side is accepted
- `confidence` is confidence in `pick`, so it is never below `0.5`

An away/home flip is the most likely bug in a new generator and it inverts every pick
on the page while still looking completely plausible. If your model naturally produces
the *pick's* probability rather than the *home team's*, convert before emitting:
`ml_win_prob = p if pick == home_team else 1 - p`.

Sort `games` in kickoff order. Cap at ~16 entries (one week's slate).

## `nba.json`

Same shape and the same sign convention, minus `season`/`week`/`kickoff`, plus a slate
`date`:

```json
{
  "generated_at": "2026-10-22T15:03:11Z",
  "date": "2026-10-22",
  "games": [
    {"away_team": "BOS", "home_team": "NYK", "pick": "NYK",
     "pred_spread": -3.5, "ml_win_prob": 0.63, "confidence": 0.63}
  ]
}
```

`date` is required and must be `YYYY-MM-DD` — it is rendered above the picks
("Thursday, October 22 slate"), so it is the slate's date, not the generation date.

## `real_estate.json`

Flagged residential listings from the `real_estate` deal screen. **Published by a local
launchd job, not a GitHub Action** (`~/personal/real_estate/run_weekly.sh`, weekly Sunday
08:00 local, installed per `~/personal/automation/LAUNCHD.md`). The generator scrapes
Realtor.com for ~15k listings across three metros and takes about twenty minutes, which
does not belong in CI; the wrapper runs this validator itself before it copies the
payload in, so the contract is enforced identically either way.

```json
{
  "generated_at": "2026-09-01T07:54:16.729035+00:00",
  "markets": ["Phoenix, AZ", "San Francisco, CA", "Tampa, FL"],
  "track_record": {
    "resolved": 498, "spearman": 0.309, "ci_low": 0.227, "ci_high": 0.386,
    "mean_edge": 0.0805, "median_edge": 0.0823, "share_below_comp_value": 0.6386
  },
  "deals": [
    {
      "address": "926 W Cocopah St", "city": "Phoenix", "state": "AZ",
      "zip_code": "85007", "score": 79.1,
      "list_price": 270000, "comp_implied_value": 514009,
      "discount_vs_comps": 0.4747,
      "property_type": "SINGLE_FAMILY", "beds": 2, "baths": 2.0, "sqft": 1512,
      "year_built": 1940, "reno_scope": "full", "reno_mid": 149688,
      "comp_basis": "85007 SINGLE_FAMILY n=51 from sold prices",
      "rationale": "47% below single family comp median $/sqft; 157 DOM (very stale)",
      "url": "https://www.realtor.com/..."
    }
  ]
}
```

| field | required | type | meaning |
|---|---|---|---|
| `generated_at` | yes | ISO 8601 + offset | see the shared rules |
| `markets` | yes | list of string | `"City, ST"` per scanned metro; rendered as the slate line |
| `track_record` | no | object or `null` | the model's measured skill — see below |
| `deals[].address` / `city` | yes | non-empty string | |
| `deals[].state` | yes | 2-letter string | **must be a disclosure state** — see below |
| `deals[].zip_code` | no | string | |
| `deals[].score` | yes | number `0`-`100` | composite deal score |
| `deals[].list_price` | yes | number `> 0` | asking price in dollars |
| `deals[].comp_implied_value` | yes | number `> 0` | p50 $/sqft of same-type comps in its ZIP x its sqft |
| `deals[].discount_vs_comps` | yes | number `< 1` | `(comp_implied_value - list_price) / comp_implied_value`, **enforced** |
| `deals[].property_type` | no | string | `SINGLE_FAMILY`, `CONDOS`, ... |
| `deals[].beds` / `baths` / `sqft` / `year_built` | no | number | |
| `deals[].reno_scope` | no | `"light"`\|`"moderate"`\|`"full"` | estimated renovation scope |
| `deals[].reno_mid` | no | number | mid renovation estimate, dollars |
| `deals[].comp_basis` | no | string | which comp pool produced the value |
| `deals[].rationale` | no | string | the model's own reasoning line |
| `deals[].url` | no | string | listing link |

Sort `deals` by `score` descending. Cap at ~12.

### Disclosure states, stated once

Sale prices are **not public record** in twelve states (AK, ID, KS, LA, MS, MO, MT, NM,
ND, TX, UT, WY). Realtor.com therefore reports no sold price there, and the model's
comps silently fall back to the last *asking* price -- verified: 0 of 11,170 stored Texas
comps carry a sold price, against 100% for Arizona and California.

So a Texan `discount_vs_comps` is a list-to-list comparison wearing the language of a
discount to market value, and the page has no way to signal the difference. **The
validator rejects any deal in one of those states outright.** 7,281 of the model's stored
deals are Texan; this rule is what keeps every one of them off the site. Filter them in
the generator -- the failure is not recoverable at render time.

### `track_record`, and why it is policed

The model explains about 9.5% of rank variance. Publishing its output without saying so
would be the misrepresentation, so the front end renders this block above the list, and
`null` renders an explicit "track record not established yet".

It is optional but not partial: if present it must carry `resolved`, `spearman`,
`ci_low` and `ci_high`. `resolved` must be **at least 30** -- the CLI refuses to draw a
conclusion below that and the page must not either -- every correlation must be in
`[-1, 1]`, and `spearman` must lie inside its own confidence interval.

### The sign convention, stated once

`discount_vs_comps` is **positive when the listing is priced BELOW comparable value**.
The validator recomputes it from `list_price` and `comp_implied_value` and rejects a
mismatch beyond rounding, because an inverted subtraction turns every bargain into a
premium and still renders a page that looks entirely plausible. A positive `list_price`
makes the true ratio strictly less than 1, so emitting a percent (`47`) instead of a
fraction (`0.47`) can never agree and is caught by the same check.

## `businesses.json`

Small-business acquisition screen, published **nightly** by a launchd job in
`~/personal/business-hunter` (not a GitHub Action — see `run_daily.sh` there and
`~/personal/automation/LAUNCHD.md`).

```json
{
  "generated_at": "2026-09-01T08:07:50.483262+00:00",
  "sources": [
    {"name": "empireflippers", "listings": 184, "scored": 184, "refused": 0, "flagged": 86},
    {"name": "flippa", "listings": 99, "scored": 0, "refused": 97, "flagged": 0}
  ],
  "screened": 283,
  "scored": 184,
  "refused": 97,
  "flagged": 86,
  "bands": [
    {"population": "online", "cash_flow_type": "SDE",
     "rungs": [{"below": null, "multiple": 2.5}]}
  ],
  "businesses": [
    {
      "title": "Food & Beverages - Amazon FBA #94642",
      "source": "empireflippers",
      "url": "https://empireflippers.com/listing/94642/",
      "state": "ONLINE", "city": "",
      "asking_price": 96077, "cash_flow": 164700, "cash_flow_type": "SDE",
      "multiple": 0.58, "fair_value": 2.5, "discount": 0.768,
      "score": 62.6, "vetted": true, "traits": ["online"]
    }
  ]
}
```

| field | required | type | meaning |
|---|---|---|---|
| `generated_at` | yes | ISO 8601 + offset | see the shared rules |
| `sources[]` | yes | list | per-source `name`, `listings`, `scored`, `refused`, `flagged`. `listings` and `flagged` **must sum to the payload totals** |
| `screened` | yes | int | listings considered (US-only, publishable sources) |
| `scored` | yes | int | had a computable multiple **and** a defensible fair-value band |
| `refused` | yes | int | had a multiple but no defensible band — see below |
| `flagged` | yes | int | scored below their band. `businesses` is the top slice of this, so it may never be shorter than the published list |
| `bands` | no | list | the fair-value table, for the methodology note |
| `businesses[].title` / `source` / `url` | yes | non-empty string | the feed publishes links, so a row without one is a dead end |
| `businesses[].asking_price` / `cash_flow` | yes | number > 0 | dollars |
| `businesses[].cash_flow_type` | yes | `"SDE"`\|`"EBITDA"`\|`"cashflow"` | the earnings definition the multiple is taken against. `cashflow` is BizBuySell's own field name for SDE |
| `businesses[].multiple` | yes | number > 0 | `asking_price / cash_flow`, and validated against exactly that |
| `businesses[].fair_value` | yes | number > 0 | the band for this listing's earnings type **and size** |
| `businesses[].discount` | yes | number > 0 | `1 - (multiple / fair_value)`; positive = priced BELOW band |
| `businesses[].score` | yes | number > 0 | screening rank, 0-100ish |
| `businesses[].vetted` | yes | boolean | the marketplace screened the P&L. **Not** that anyone audited it |
| `businesses[].traits` | no | list of `absentee`\|`recurring`\|`online` | |

### Refused rows are not opportunities

The screener declines to score some earnings labels, and a refused row may not be
published — the validator rejects the payload if one appears. This is not tidiness:
Flippa reports a self-reported, unaudited **monthly** `net_profit` with no add-back
discipline, and its median is **0.98x**. That is not a bargain bin, it is the market
declining to believe the numbers. On a page ranked by discount those rows would place
**first**, presenting the least credible listings as the best finds. So they are counted
in `refused` — visible, deliberately not scored — and never ranked.

### The sign convention, stated once

`discount` is `1 - (multiple / fair_value)`: **positive means priced below the band.**
An inverted subtraction turns every premium into a bargain and still renders a
completely plausible page, so the validator recomputes it. Emit a fraction (`0.47`),
never a percent (`47`).

A published row must also actually be one: `multiple < fair_value`, `discount > 0` and
`score > 0` are all enforced. The screener's own history is why — trait bonuses used to
be *additive*, so absentee/recurring/online keywords manufactured a positive score on
businesses priced at or above fair value, and 297 of 640 flagged rows were at or above
their band.

### Why the band is per earnings type and size

A multiple is meaningless without the earnings definition it was taken against. SDE is
EBITDA **plus** owner compensation and add-backs, so the same business prices at a
higher multiple of EBITDA than of SDE — a flat fair value scored 41 of 69 EBITDA
listings at zero even when they were cheap for their type. `fair_value` is therefore
per label and per deal size, anchored on IBBA Market Pulse and BizBuySell closed
medians. Full derivation lives in `business-hunter/analyze.py`.

### Feed scope

Only marketplaces that answer plain HTTP are in this payload. BizBuySell is
Akamai-blocked (403 on every path, `robots.txt` included) and needs a manual WebFetch
pass, so its rows go months stale between sweeps and would decay into dead links on a
page claiming to be current. They stay in the screener's local CSVs.

The generator also refuses to write at all when its own raw sweep is older than three
days, so a fresh `generated_at` here really does imply fresh listings. That is why this
feed needs no extra front-end `gate` the way `magicformula.json` does.

## `magicformula.json`

A Magic Formula value screen (Greenblatt: rank by earnings yield and return on capital,
sum the two ranks) from `~/personal/magic-formula-portfolio`. **Published by a local
launchd job, not a GitHub Action** (`run_weekly.sh`, Mondays 08:00 local, installed per
`~/personal/automation/LAUNCHD.md`). Weekly rather than daily because the strategy holds
for a year and the source re-screens quarterly, so a daily rebuild would publish price
noise as though it were signal. The wrapper runs this validator itself before copying the
payload in, so the contract is enforced identically either way.

The page shows the screen only -- no holdings, no P&L, no position sizes.

```json
{
  "generated_at": "2026-09-01T08:13:48.431866+00:00",
  "universe_pulled": "2026-04-15",
  "universe_size": 50,
  "screened": 18,
  "unrankable": 9,
  "min_market_cap_m": 1000.0,
  "ideas": [
    {
      "ticker": "VSNT",
      "name": "Versant Media Group, Inc.",
      "sector": "Communication Services",
      "rank": 1,
      "earnings_yield": 0.230031,
      "return_on_capital": 0.752497,
      "market_cap": 5722673664.0,
      "ebit_basis": "TTM"
    }
  ]
}
```

| field | required | type | meaning |
|---|---|---|---|
| `generated_at` | yes | ISO 8601 + offset | when the screen was re-ranked — see above |
| `universe_pulled` | yes | `YYYY-MM-DD` | when the candidate list was last pasted in by hand |
| `universe_size` | yes | int | names in the pasted list |
| `screened` | yes | int, `0 <= screened <= universe_size` | how many were rankable and cleared the filters |
| `unrankable` | no | int | names the formula could not rank (see below) |
| `min_market_cap_m` | no | number | market-cap floor applied, in $M; rendered in the slate line |
| `ideas[].ticker` / `name` | yes | non-empty string | ticker is the display label, name is context |
| `ideas[].rank` | yes | int `>= 1` | 1 = best combined rank. **The list must be sorted by it** |
| `ideas[].earnings_yield` | yes | number, \|x\| <= 5 | EBIT / enterprise value, **a fraction** |
| `ideas[].return_on_capital` | yes | number, \|x\| <= 100 | EBIT / (NWC + net fixed assets), **a fraction** |
| `ideas[].market_cap` | yes | number `>= 1e6` | **in dollars** |
| `ideas[].sector` / `ebit_basis` | no | string | shown in the meta line; `ebit_basis` is `TTM` or `annual` |

### Two staleness axes, and why one is not enough

This is the only feed where `generated_at` being fresh does not mean the content is.

- **`generated_at`** — when the screen was re-ranked. A weekly job keeps this permanently
  fresh, by construction.
- **`universe_pulled`** — when the list of candidate names was last pasted in from
  magicformulainvesting.com. That is a manual step (the site has no API and must not be
  scraped), and its list only turns over when new quarterly filings reach its data
  provider.

Re-ranking a two-quarter-old universe every Monday produces a payload with an impeccable
`generated_at` and names that are two quarters behind. No freshness check on
`generated_at` could ever reveal that. So the front end gates on `universe_pulled`
separately: past a quarter plus a fortnight it shows the age and nothing else, the same
way it refuses to render a stale slate. The universe as of 2026-09-01 was pulled
2026-04-15, so this is the live state, not a hypothetical.

The validator deliberately does **not** reject an old `universe_pulled` — which stale
screens to display is the front end's decision, and gating it here would mean a stale
feed could not publish the very date that reveals it.

Nothing else from the pasted CSV reaches the payload. It supplies the ticker list and the
pull date; every number is computed at scan time.

### `unrankable`

Reported as a count rather than hidden. Most of these are not a data outage: they are
companies with **negative invested capital** (current liabilities exceed current assets by
more than net fixed assets), where return on capital has no meaningful denominator, or
with a negative enterprise value where the company holds more cash than its market cap.
The Magic Formula is undefined for them rather than the data being missing, and the reader
should know the screen is not covering them.

## `f1.json`

```json
{
  "generated_at": "2026-09-03T12:02:40Z",
  "year": 2026,
  "race_name": "Italian Grand Prix",
  "predictions": [
    {"driver": "Max Verstappen", "predicted_pos": 1.4}
  ]
}
```

`predictions` is in predicted finishing order (index 0 = P1). `year` is an int,
`race_name` a non-empty string, `driver` a non-empty string, and `predicted_pos` a
number rendered to one decimal.

## `funding.json`

Cross-exchange perpetual funding carry, from `AmarRSehgal/funding-rate-arb`.
Published **hourly** by a local launchd job (`run_hourly.sh`), not a GitHub Action --
several of the venues geo-block datacenter IPs, so this has to run from a residential
connection.

```json
{
  "generated_at": "2026-09-09T13:04:22Z",
  "status": "ok",
  "scans_seen": 24,
  "window_scans": 24,
  "min_hits": 18,
  "opportunities": [{
    "base": "BTC",
    "type": "spot-perp",
    "long_venue": "Binance",
    "short_venue": "Hyperliquid",
    "long_instrument": "spot",
    "min_hold_h": 8,
    "hits": 22,
    "scans": 24,
    "net_apr": 42.13,
    "net_at_hold": 0.03847,
    "cost_bps": 21.5
  }]
}
```

**The numbers here are PERCENTS, not probabilities.** `net_apr` is `42.13` for
42.13%/yr and routinely exceeds 100. The shared `[0, 1]` rule the sports feeds use
does not apply and must not be "restored" here.

### Why this board is not the scanner's top rows

The scanner ranks ~30,000 routes and its top rows are almost always one altcoin mid
funding spike -- at the time of writing, `+10,456% APR`. That figure is correct
arithmetic (an instantaneous rate, annualised) and a false promise: the rate reverts
long before the minimum hold completes. Publishing it would put an untrue claim on the
page.

So a route has to keep earning its place. Every scan stores its net-positive routes,
and only routes positive in **at least `min_hits` of the last `scans_seen` hourly
scans** are published, ranked by hit count and then by the **median** net APR across
those scans -- median, because a route published *for being steady* must not have its
headline number set by the one scan where it spiked.

Consequence: **an empty `opportunities` list is the normal state**, not a broken feed.

### `status`

| value | meaning |
|---|---|
| `ok` | The window holds enough scans to judge persistence. `opportunities` may still be empty. |
| `building_history` | Fewer than 12 scans collected. The hit rate is not yet a measurement. |

`building_history` **must** carry an empty `opportunities` list, and the validator
enforces it: publishing a board while saying there is no basis for one asserts both at
once, and the front end renders them as different things.

### Per-route rules (all enforced)

- `type` is `spot-perp` or `perp-perp`.
- A `perp-perp` route may not have both legs on the same venue -- that is a position
  against itself, not a carry. A same-venue `spot-perp` is legitimate and allowed.
- `hits <= scans`, both `>= 1`. A route cannot have been positive more often than it
  was looked at.
- `min_hold_h >= 1`.
- `net_apr > 0` and `net_at_hold > 0`. Only routes that were worth doing get
  published, so a non-positive one means the persistence filter let a losing route
  through -- a failure that is otherwise invisible, because it just looks like a thin
  board.
- `net_apr` and `net_at_hold` are the same return over different horizons and may not
  disagree in sign.

The front end leads with `net_at_hold` (what actually happens over one hold) and shows
`net_apr` as the smaller derived figure, so the annualised number reads as an
extrapolation rather than a claim.

## Publishing setup (required, currently missing)

Three things are missing, and they have to be done **in this order** — each step is
useless without the one before it.

### 1. Push the repo

`origin/main` is behind the local branch, so the fixed workflows, the validator and the
NFL section only exist locally. The remote still carries the original workflows, which
point at the wrong GitHub account. Nothing below takes effect until this is pushed.

### 2. Add the `REPO_ACCESS_TOKEN` secret

The workflows check out the private model repos. The repository currently has **zero
secrets**, so `secrets.REPO_ACCESS_TOKEN` is empty and `actions/checkout` aborts with
`Input required and not supplied: token` — which is exactly what happened to all 70 runs
between 2026-04-19 and 2026-06-18. Create a fine-grained PAT with `Contents: read` on
`AmarRSehgal/nba-prediction`, `AmarRSehgal/f1_prediction` and
`AmarRSehgal/nfl-prediction`, then:

```
gh secret set REPO_ACCESS_TOKEN --repo AmarRSehgal/AmarRSehgal.github.io
```

Each workflow fails fast with a named error if this is absent, so a missing secret can
no longer look like a checkout bug.

### 3. Re-enable the schedules

GitHub auto-disables scheduled workflows after 60 days of repository inactivity, which
is why the schedules stopped firing entirely on 2026-06-18. Both are currently in
`disabled_inactivity`, which also blocks `workflow_dispatch` — a manual dry run returns
`HTTP 422: Cannot trigger a 'workflow_dispatch' on a disabled workflow`, so they cannot
be tested until they are enabled.

```
gh workflow enable "Daily NBA Picks"     --repo AmarRSehgal/AmarRSehgal.github.io
gh workflow enable "F1 Race Predictions" --repo AmarRSehgal/AmarRSehgal.github.io
gh workflow enable "Weekly NFL Picks"    --repo AmarRSehgal/AmarRSehgal.github.io
```

("Weekly NFL Picks" only exists after step 1 — it has never been on the remote.)

### 4. The generators

Each model repo must expose the generator the workflow calls, writing the schema above
to `--output <path>`:

| repo | entrypoint |
|---|---|
| `nba-prediction` | `generate_web_picks.py --output PATH` |
| `f1_prediction` | `generate_web_predictions.py --output PATH` |
| `nfl-prediction` | `generate_web_picks.py --output PATH` (plus `weekly_update.py`) |
| `real_estate` | `generate_web_deals.py --output PATH` — **exists**, and publishes itself |

`real_estate` needs none of steps 1-3: it has no workflow, no secret and no schedule
here, because its launchd job commits and pushes the payload directly. The other three
do not exist yet. A generator that cannot produce a slate should still emit a
valid payload with a current `generated_at` and an empty list — that publishes an
honest "no games scheduled" rather than failing the run.

## `opportunities.json`

The cross-source board. **The only nested payload on the site**: its list holds per-source
*sections*, not items. Generated by `~/personal/opportunities/aggregate.py`, which merges
what each source repo already wrote on its own schedule — it runs no scanner itself, so a
slow or broken source can only make its own section go quiet.

```json
{
  "generated_at": "2026-09-01T08:06:52Z",
  "methodology": "Ranked within each source; no cross-source score. ...",
  "total_opportunities": 8,
  "fresh_sources": 1,
  "sources": [
    {
      "source": "funding_drift",
      "label": "Perp funding vs realized drift",
      "status": "fresh",
      "as_of": "2026-09-01T07:56:32Z",
      "age_hours": 0.1,
      "count": 15,
      "caveat": "An observation, NOT a trade recommendation. ...",
      "note": null,
      "opportunities": [
        {"rank": 1, "source": "funding_drift", "title": "BTR on HTX",
         "detail": "24h return +108.5%, funding -0.0%",
         "metric_value": 1.085, "metric_display": "+108.5%", "link": null}
      ]
    }
  ]
}
```

Rules the validator enforces on top of the shared ones:

- **`status` is one of `fresh | empty | stale | missing | error`.** They are not
  cosmetic. `empty` means the scan ran and nothing cleared the bar; `missing` means it
  never ran. Those mean opposite things and the page renders them differently.
- **A section outside `fresh`/`empty` may not carry items.** The whole purpose of the
  `stale` state is to stop old numbers being presented as live, so publishing items
  beside a stale marker defeats it. The aggregator drops the items itself; this is the
  backstop.
- **`caveat` is required and may not be empty**, on every section. The board mixes
  sources whose numbers mean very different things, and several of the generators
  feeding it exist mainly to warn about their own output — `funding-drift`'s own study
  found its ranking is ~99% price momentum. A board that dropped the caveat would be
  actively misleading, so it is a contract violation rather than a style choice.
- **`metric_value` must be a JSON number.** It is the sort key for the section; a string
  sorts lexicographically and silently reorders the board.
- **`source` keys must be unique** across sections.
- Every item needs `title` and `metric_display`. `detail` and `link` are optional.

**There is deliberately no cross-source score.** A crypto arb in basis points, an
earnings yield and a contract cadence are not commensurable; one combined leaderboard
over them would be invented. Sections are ranked internally and presented grouped.
