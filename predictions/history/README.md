# Published-run ledger

One JSONL file per feed. **One line per model run that was actually published to this
site**, oldest first: the payload's own metadata, the git sha that published it, the
commit time, and the forecast rows under `_items`.

Rebuild or update with:

```bash
python3 tools/archive_history.py          # rewrite every ledger from git
python3 tools/archive_history.py --check  # exit 1 if a ledger is behind; writes nothing
```

## Why this exists

The front end refuses to show a feed once it is stale, and a detail page archives it
after a longer window. Neither is a place a model's history can live, and the history is
the only thing that makes a model auditable: what it forecast, when it said so publicly,
and what happened afterwards. That has to outlive whatever the page will currently
render.

## It is derived, not accumulated

Every payload is committed to this repo by its publishing job, so git already holds the
complete series. `archive_history.py` walks `git log -- predictions/<feed>.json` and
writes the ledger from it. That makes the script **idempotent and late-safe**: run it
tonight, next month, or on another clone, and it produces the same file. A ledger that
were appended to live would have exactly one failure mode -- a missed run is a permanent
hole -- and this design has none. The daily `com.amar.fleet_watchdog` run keeps it
current; nothing breaks if it doesn't.

Runs are keyed on `generated_at`, so a commit that reformatted a payload without
re-running the model does not produce a second line.

## Who reads it

`nfl-prediction/track_record.py` scores the picks in `nfl.jsonl` against final scores
from its own database, and that record is published back into `nfl.json` as
`track_record`. This is deliberately not a backtest: every graded row was a public,
timestamped forecast made before kickoff, so it cannot be tuned after the fact.

Reading it here is also what keeps it honest -- an archive nothing consumes is an
archive nobody notices has stopped being written.
