#!/usr/bin/env python3
"""Gate a freshly generated predictions payload before it replaces the published one.

Usage: validate_predictions.py {nba|nfl|f1} <candidate.json>

Exits non-zero on anything the front end cannot render honestly. The point is that a
half-broken generator run fails the workflow loudly instead of publishing a file that
makes the site claim "no games today".
"""
import json
import sys
from datetime import datetime, timedelta, timezone

# sport -> (required top-level keys, list key, per-item required keys, max age of generated_at)
SPECS = {
    'nba': (('generated_at', 'date', 'games'), 'games',
            ('away_team', 'home_team', 'pick', 'pred_spread', 'ml_win_prob', 'confidence'),
            timedelta(hours=6)),
    'nfl': (('generated_at', 'season', 'week', 'games'), 'games',
            ('away_team', 'home_team', 'pick', 'pred_spread', 'ml_win_prob', 'confidence'),
            timedelta(hours=6)),
    'f1': (('generated_at', 'year', 'race_name', 'predictions'), 'predictions',
           ('driver', 'predicted_pos'),
           timedelta(hours=6)),
}


def fail(msg):
    print(f'::error::{msg}')
    sys.exit(1)


def main():
    if len(sys.argv) != 3:
        fail('usage: validate_predictions.py {nba|nfl|f1} <candidate.json>')
    sport, path = sys.argv[1], sys.argv[2]
    if sport not in SPECS:
        fail(f'unknown sport {sport!r}')
    required, list_key, item_keys, max_age = SPECS[sport]

    try:
        with open(path) as fh:
            data = json.load(fh)
    except Exception as exc:
        fail(f'{path}: not readable as JSON ({exc})')

    if not isinstance(data, dict):
        fail(f'{path}: top level must be an object')

    missing = [k for k in required if k not in data]
    if missing:
        fail(f'{path}: missing required keys {missing}')

    stamp = data['generated_at']
    if not stamp:
        fail(f'{path}: generated_at is null/empty -- the generator did not actually run')
    try:
        gen = datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))
    except ValueError:
        fail(f'{path}: generated_at {stamp!r} is not ISO 8601')
    if gen.tzinfo is None:
        gen = gen.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - gen
    if age > max_age:
        fail(f'{path}: generated_at is {age} old -- stale payload, refusing to publish')
    if age < timedelta(hours=-1):
        fail(f'{path}: generated_at {stamp} is in the future')

    items = data[list_key]
    if not isinstance(items, list):
        fail(f'{path}: {list_key} must be a list')

    for i, item in enumerate(items):
        if not isinstance(item, dict):
            fail(f'{path}: {list_key}[{i}] must be an object')
        item_missing = [k for k in item_keys if k not in item]
        if item_missing:
            fail(f'{path}: {list_key}[{i}] missing {item_missing}')
        if sport in ('nba', 'nfl'):
            if item['pick'] not in (item['away_team'], item['home_team']):
                fail(f'{path}: {list_key}[{i}] pick {item["pick"]!r} is neither team '
                     f'({item["away_team"]!r}/{item["home_team"]!r})')
            for key in ('ml_win_prob', 'confidence'):
                val = item[key]
                if not isinstance(val, (int, float)) or not 0.0 <= float(val) <= 1.0:
                    fail(f'{path}: {list_key}[{i}].{key}={val!r} must be a probability in [0, 1]')

    # An empty slate is legitimate (off day, bye week) but should be deliberate, not a
    # silent generator failure -- so it is allowed and only logged.
    if not items:
        print(f'::notice::{path}: empty {list_key} -- publishing an explicit "no slate" payload')

    print(f'{path}: OK ({len(items)} {list_key}, generated {stamp})')


if __name__ == '__main__':
    main()
