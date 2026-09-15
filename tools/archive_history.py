#!/usr/bin/env python3
"""Materialise every payload this site has ever published into a tracked ledger.

    python3 tools/archive_history.py            # rebuild predictions/history/*.jsonl
    python3 tools/archive_history.py --check    # non-zero if the ledger is behind

Why this exists: the front end deliberately stops showing a feed once it is old, and a
detail page eventually archives it too. Neither is a place to keep a record. A model's
history is the only thing that makes it auditable -- what it forecast, when it said so,
and what actually happened -- and that must outlive whatever the page is currently
willing to render.

**The ledger is DERIVED, not accumulated.** Every payload is committed to this repo by
the publishing job, so git already holds the full series; this walks
`git log -- predictions/<feed>.json` and writes one JSONL line per published run. That
property is the important one: the script is idempotent, it can be run late, on another
machine, or never for a month, and it reconstructs the same file either way. A ledger
that were appended to live would have exactly one failure mode -- a missed run is a
permanent hole -- and this has none.

What is kept per run is the payload's identity and the numbers, not the prose: the
stamp, the git sha that published it, and the item list. Caveats and methodology are
re-readable in the repo at that sha.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "predictions", "history")

# feed -> the list key whose rows are the forecast itself.
FEEDS = {
    "nfl": "games", "nba": "games", "mlb": "games", "f1": "predictions",
    "real_estate": "deals", "magicformula": "ideas", "businesses": "businesses",
    "funding": "opportunities", "contracts": "lanes", "opportunities": "sources",
    # The three live paper books. The list key is each one's FORECAST -- the positions it
    # chose to hold, the levels it armed. Everything else in the payload (trades, day,
    # performance, equity_curve) is kept at the top level of the record regardless, so
    # the outcome is archived beside the call rather than in place of it.
    "swing_book": "positions", "mf_book": "positions", "options_levels": "levels",
}


def git(*args: str) -> str:
    return subprocess.run(("git", "-C", REPO, *args),
                          capture_output=True, text=True, check=True).stdout


def runs(feed: str) -> list[dict]:
    path = f"predictions/{feed}.json"
    out, seen = [], set()
    log = git("log", "--format=%H %aI", "--reverse", "--", path).strip()
    for line in log.split("\n"):
        if not line.strip():
            continue
        sha, committed = line.split(None, 1)
        try:
            data = json.loads(git("show", f"{sha}:{path}"))
        except Exception:
            continue
        stamp = data.get("generated_at")
        # A commit that did not change generated_at is the same run (a reformat, a
        # rebase). Keying on the stamp keeps one line per actual model run.
        if not stamp or stamp in seen:
            continue
        seen.add(stamp)
        rec = {k: v for k, v in data.items()
               if k not in (FEEDS[feed], "methodology", "caveat")}
        rec["_sha"] = sha
        rec["_committed_at"] = committed
        rec["_items"] = data.get(FEEDS[feed]) or []
        out.append(rec)
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if any ledger is out of date; write nothing")
    args = ap.parse_args(argv[1:])

    os.makedirs(OUT_DIR, exist_ok=True)
    behind, total = [], 0
    for feed in sorted(FEEDS):
        rows = runs(feed)
        if not rows:
            continue
        body = "".join(json.dumps(r, sort_keys=True) + "\n" for r in rows)
        dest = os.path.join(OUT_DIR, f"{feed}.jsonl")
        current = open(dest).read() if os.path.exists(dest) else None
        total += len(rows)
        if current == body:
            print(f"{feed:14} {len(rows):4} runs  up to date")
            continue
        behind.append(feed)
        if args.check:
            print(f"{feed:14} {len(rows):4} runs  LEDGER BEHIND")
            continue
        # Write whole, not append: the file is a pure function of git history, so a
        # rewrite is always correct and never doubles a run.
        tmp = dest + ".tmp"
        with open(tmp, "w") as fh:
            fh.write(body)
        os.replace(tmp, dest)
        print(f"{feed:14} {len(rows):4} runs  written")

    print(f"\n{total} published runs across {len(FEEDS)} feeds -> {OUT_DIR}")
    # Findings are output, not failure: a rebuild that ran is a success even when it
    # found the ledger stale. --check is the opt-in gate for a caller that wants one.
    return 1 if (args.check and behind) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
