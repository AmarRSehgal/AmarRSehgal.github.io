# Prediction payload contract

Each file here is generated in its model repo by a `generate_web_picks.py` /
`generate_web_predictions.py` entrypoint, validated by
`.github/scripts/validate_predictions.py`, and committed by the matching workflow in
`.github/workflows/`. The front end (`script.js`) renders them and nothing else — if a
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

None of these exist yet. A generator that cannot produce a slate should still emit a
valid payload with a current `generated_at` and an empty list — that publishes an
honest "no games scheduled" rather than failing the run.
