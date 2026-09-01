# Prediction payload contract

Each file here is generated in its model repo by a `generate_web_picks.py` /
`generate_web_predictions.py` entrypoint, validated by
`.github/scripts/validate_predictions.py`, and committed by the matching workflow in
`.github/workflows/`. The front end (`script.js`) renders them and nothing else — if a
field is not listed here, the site ignores it.

## Shared rules

- `generated_at` is **required and must be a real ISO 8601 timestamp with a timezone**
  (`2026-09-09T13:04:22Z`). `null` means "the generator never ran"; the validator rejects
  it and the site shows an explicit "not published yet" state rather than pretending the
  slate is empty.
- An empty list (`games: []` / `predictions: []`) is a **valid** payload meaning "no
  fixtures in this window" (off day, bye week). It is not the same as a missing file.
- The site treats a payload as **stale** if `generated_at` is older than the sport's
  refresh cadence plus slack (NBA 36h, NFL 10d, F1 10d) and says so instead of
  presenting old numbers as current.
- Optional `season_status` (`"preseason" | "in_season" | "offseason"`) and
  `next_season_start` (ISO date) override the front end's built-in season windows. Emit
  them if the model repo knows the real schedule — the front end's fallback dates are
  approximate.

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
| `generated_at` | yes | ISO 8601 + tz | when the payload was produced |
| `season` | yes | int | e.g. `2026` |
| `week` | yes | int | 1-18 regular season; continues 19+ for playoffs |
| `season_type` | no | `"preseason"`\|`"regular"`\|`"postseason"` | defaults to `"regular"` |
| `games[].kickoff` | no | ISO 8601 + tz | rendered as local kickoff time when present |
| `games[].away_team` / `home_team` | yes | string | short code (`DAL`) — used as the display label |
| `games[].away_team_full` / `home_team_full` | no | string | full name, used for `title=` tooltips |
| `games[].pick` | yes | string | **must be byte-equal to `away_team` or `home_team`** — the front end bolds the pick by exact match, and the validator rejects anything else |
| `games[].pred_spread` | yes | number | **home-team perspective**; negative = home favoured (`-6.5` = home by 6.5) |
| `games[].pred_total` | no | number | predicted combined points |
| `games[].ml_win_prob` | yes | number in `[0,1]` | **home team's** win probability |
| `games[].confidence` | yes | number in `[0,1]` | model confidence in `pick`, i.e. `max(p, 1-p)` |

Sort `games` in kickoff order. Cap at ~16 entries (one week's slate).

## `nba.json`

Same shape, minus `season`/`week`/`kickoff`, plus a slate `date`:

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

`pred_spread` / `ml_win_prob` conventions are identical to NFL (home perspective).

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

`predictions` is in predicted finishing order (index 0 = P1); `predicted_pos` is the raw
model output, rendered to one decimal.

## Publishing setup (required, currently missing)

The workflows in `.github/workflows/` check out the private model repos, so they need a
repository secret named **`REPO_ACCESS_TOKEN`** — a fine-grained PAT with `Contents: read`
on `AmarRSehgal/nba-prediction`, `AmarRSehgal/f1_prediction` and
`AmarRSehgal/nfl-prediction`. Without it every run dies at checkout with
`Input required and not supplied: token`, which is exactly what happened to all 70 runs
between 2026-04-19 and 2026-06-18.

```
gh secret set REPO_ACCESS_TOKEN --repo AmarRSehgal/AmarRSehgal.github.io
```

GitHub also auto-disables scheduled workflows after 60 days of repository inactivity, which
is why the schedules stopped firing entirely on 2026-06-18. Re-enable them with:

```
gh workflow enable "Daily NBA Picks"     --repo AmarRSehgal/AmarRSehgal.github.io
gh workflow enable "F1 Race Predictions" --repo AmarRSehgal/AmarRSehgal.github.io
gh workflow enable "Weekly NFL Picks"    --repo AmarRSehgal/AmarRSehgal.github.io
```

Each model repo must expose the generator the workflow calls, writing the schema above to
`--output <path>`:

| repo | entrypoint |
|---|---|
| `nba-prediction` | `generate_web_picks.py --output PATH` |
| `f1_prediction` | `generate_web_predictions.py --output PATH` |
| `nfl-prediction` | `generate_web_picks.py --output PATH` (plus `weekly_update.py`) |

None of these exist yet — that is the second blocker after the token.
