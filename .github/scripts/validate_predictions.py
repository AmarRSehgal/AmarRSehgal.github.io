#!/usr/bin/env python3
"""Gate a freshly generated predictions payload before it replaces the published one.

Usage: validate_predictions.py {nba|nfl|f1} <candidate.json>

Exits non-zero on anything the front end cannot render honestly. The point is that a
half-broken generator run fails the workflow loudly instead of publishing a file that
makes the site claim "no games today".

The rules here ARE the contract in predictions/README.md. Three external model repos
generate against it, so every check has to fail with a message that says what to emit,
not just that something was wrong.
"""
import json
import sys
from datetime import date, datetime, timedelta, timezone

# generated_at is stamped by the generator in the same workflow run, so anything older
# than this means the generator reported a cached/derived time instead of "now".
MAX_AGE = timedelta(hours=6)
FUTURE_SLACK = timedelta(hours=1)

SEASON_STATUS = ('preseason', 'in_season', 'offseason')
SEASON_TYPE = ('preseason', 'regular', 'postseason')

# sport -> (required top-level keys, list key, per-item required keys)
SPECS = {
    'nba': (('generated_at', 'date', 'games'), 'games',
            ('away_team', 'home_team', 'pick', 'pred_spread', 'ml_win_prob', 'confidence')),
    'nfl': (('generated_at', 'season', 'week', 'games'), 'games',
            ('away_team', 'home_team', 'pick', 'pred_spread', 'ml_win_prob', 'confidence')),
    'f1': (('generated_at', 'year', 'race_name', 'predictions'), 'predictions',
           ('driver', 'predicted_pos')),
}


class Invalid(Exception):
    """A contract violation. Carries the operator-facing message."""


def require_number(where, key, val):
    # bool is an int subclass; True would sail through an isinstance(val, (int, float)).
    if type(val) is bool or not isinstance(val, (int, float)):
        raise Invalid(f'{where}.{key}={val!r} must be a JSON number, not {type(val).__name__}')
    return float(val)


def require_probability(where, key, val):
    num = require_number(where, key, val)
    if not 0.0 <= num <= 1.0:
        raise Invalid(f'{where}.{key}={val!r} must be a probability in [0, 1] '
                      f'(emit 0.68, not 68)')
    return num


def require_str(where, key, val):
    if not isinstance(val, str) or not val.strip():
        raise Invalid(f'{where}.{key}={val!r} must be a non-empty string')
    return val


def require_int(where, key, val):
    if type(val) is bool or not isinstance(val, int):
        raise Invalid(f'{where}.{key}={val!r} must be a JSON integer')
    return val


def parse_timestamp(stamp):
    """generated_at must carry an offset -- a naive stamp is silently wrong twice.

    The validator would have to guess UTC (mislabelling a run from any other zone as
    stale), and the browser's Date() parses a naive ISO string as *viewer-local*, so the
    published "Updated:" line would shift by every visitor's own UTC offset.
    """
    if not stamp:
        raise Invalid('generated_at is null/empty -- the generator did not actually run')
    try:
        gen = datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))
    except ValueError:
        raise Invalid(f'generated_at {stamp!r} is not ISO 8601 '
                      f'(emit datetime.now(timezone.utc).isoformat())')
    if gen.tzinfo is None:
        raise Invalid(f'generated_at {stamp!r} has no UTC offset. Emit '
                      f'datetime.now(timezone.utc).isoformat() or a "Z" suffix -- a naive '
                      f'stamp renders in each visitor\'s own timezone.')
    return gen


def check_freshness(gen, now):
    age = now - gen
    if age > MAX_AGE:
        raise Invalid(f'generated_at is {age} old -- stale payload, refusing to publish. '
                      f'Stamp the moment the generator ran, not the slate date.')
    if age < -FUTURE_SLACK:
        raise Invalid(f'generated_at {gen.isoformat()} is in the future')


def check_date_string(where, key, val):
    require_str(where, key, val)
    try:
        date.fromisoformat(val)
    except ValueError:
        raise Invalid(f'{where}.{key}={val!r} must be an ISO date (YYYY-MM-DD)')


def check_optional_season_fields(data):
    if 'season_status' in data and data['season_status'] not in SEASON_STATUS:
        # The front end treats anything != 'in_season' as off-season, so a typo here
        # hides a live slate behind a "between seasons" message.
        raise Invalid(f'season_status={data["season_status"]!r} must be one of '
                      f'{list(SEASON_STATUS)} -- any other value forces the site into its '
                      f'off-season state and hides the slate')
    if 'next_season_start' in data and data['next_season_start'] is not None:
        check_date_string('<payload>', 'next_season_start', data['next_season_start'])
    if 'season_type' in data and data['season_type'] is not None:
        if data['season_type'] not in SEASON_TYPE:
            raise Invalid(f'season_type={data["season_type"]!r} must be one of {list(SEASON_TYPE)}')


def check_team_game(where, g):
    away = require_str(where, 'away_team', g['away_team'])
    home = require_str(where, 'home_team', g['home_team'])
    pick = require_str(where, 'pick', g['pick'])
    if pick not in (away, home):
        raise Invalid(f'{where} pick {pick!r} is neither team ({away!r}/{home!r}) -- '
                      f'it must be byte-equal to away_team or home_team')

    prob = require_probability(where, 'ml_win_prob', g['ml_win_prob'])
    conf = require_probability(where, 'confidence', g['confidence'])
    require_number(where, 'pred_spread', g['pred_spread'])
    if g.get('pred_total') is not None:
        require_number(where, 'pred_total', g['pred_total'])

    # ml_win_prob is the HOME team's probability, so picking the side the model itself
    # rates as the underdog is a sign convention bug -- usually an away/home flip.
    if prob > 0.5 and pick != home:
        raise Invalid(f'{where}: ml_win_prob={prob} favours the home team {home!r} but '
                      f'pick is {pick!r}. ml_win_prob is the HOME win probability.')
    if prob < 0.5 and pick != away:
        raise Invalid(f'{where}: ml_win_prob={prob} favours the away team {away!r} but '
                      f'pick is {pick!r}. ml_win_prob is the HOME win probability.')

    # confidence is confidence in `pick`, i.e. max(p, 1-p) -- never below a coin flip.
    if conf < 0.5:
        raise Invalid(f'{where}: confidence={conf} is below 0.5. It is confidence in '
                      f'`pick`, i.e. max(ml_win_prob, 1 - ml_win_prob), not the home '
                      f'team\'s probability.')

    if g.get('kickoff') is not None:
        try:
            datetime.fromisoformat(str(g['kickoff']).replace('Z', '+00:00'))
        except ValueError:
            raise Invalid(f'{where}.kickoff={g["kickoff"]!r} is not ISO 8601')


def check_f1_entry(where, p):
    require_str(where, 'driver', p['driver'])
    require_number(where, 'predicted_pos', p['predicted_pos'])


def validate(sport, data, now=None):
    """Raise Invalid on the first contract violation. Returns the item list on success."""
    now = now or datetime.now(timezone.utc)
    if sport not in SPECS:
        raise Invalid(f'unknown sport {sport!r}')
    required, list_key, item_keys = SPECS[sport]

    if not isinstance(data, dict):
        raise Invalid('top level must be an object')

    missing = [k for k in required if k not in data]
    if missing:
        raise Invalid(f'missing required keys {missing}')

    check_freshness(parse_timestamp(data['generated_at']), now)
    check_optional_season_fields(data)

    if sport == 'nba':
        check_date_string('<payload>', 'date', data['date'])
    elif sport == 'nfl':
        require_int('<payload>', 'season', data['season'])
        week = require_int('<payload>', 'week', data['week'])
        if not 1 <= week <= 25:
            raise Invalid(f'week={week} is out of range (1-18 regular, 19+ playoffs)')
    else:
        require_int('<payload>', 'year', data['year'])
        require_str('<payload>', 'race_name', data['race_name'])

    items = data[list_key]
    if not isinstance(items, list):
        raise Invalid(f'{list_key} must be a list')

    for i, item in enumerate(items):
        where = f'{list_key}[{i}]'
        if not isinstance(item, dict):
            raise Invalid(f'{where} must be an object')
        item_missing = [k for k in item_keys if k not in item]
        if item_missing:
            raise Invalid(f'{where} missing {item_missing}')
        if sport == 'f1':
            check_f1_entry(where, item)
        else:
            check_team_game(where, item)

    return items


def main(argv):
    if len(argv) != 3:
        print('::error::usage: validate_predictions.py {nba|nfl|f1} <candidate.json>')
        return 1
    sport, path = argv[1], argv[2]

    try:
        with open(path) as fh:
            data = json.load(fh)
    except Exception as exc:
        print(f'::error::{path}: not readable as JSON ({exc})')
        return 1

    try:
        items = validate(sport, data)
    except Invalid as exc:
        print(f'::error::{path}: {exc}')
        return 1

    list_key = SPECS[sport][1]
    # An empty slate is legitimate (off day, bye week) but should be deliberate, not a
    # silent generator failure -- so it is allowed and only logged.
    if not items:
        print(f'::notice::{path}: empty {list_key} -- publishing an explicit "no slate" payload')

    print(f'{path}: OK ({len(items)} {list_key}, generated {data["generated_at"]})')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
