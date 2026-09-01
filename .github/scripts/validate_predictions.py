#!/usr/bin/env python3
"""Gate a freshly generated predictions payload before it replaces the published one.

Usage: validate_predictions.py {nba|nfl|f1|real_estate|magicformula|opportunities}
           <candidate.json>

Exits non-zero on anything the front end cannot render honestly. The point is that a
half-broken generator run fails the workflow loudly instead of publishing a file that
makes the site claim "no games today".

The rules here ARE the contract in predictions/README.md. Four external model repos
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

# Sale prices are not public record in these twelve states, so Realtor.com reports no
# sold price and the real_estate model's comps silently fall back to the last ASKING
# price. A "38% below comparable value" computed that way is a list-to-list comparison
# wearing the language of a sale, and the page has no way to signal the difference --
# so such a deal may not be published at all. 7,281 of the model's stored deals are
# Texan; this is the check that keeps every one of them off the site.
NON_DISCLOSURE_STATES = frozenset({
    'AK', 'ID', 'KS', 'LA', 'MS', 'MO', 'MT', 'NM', 'ND', 'TX', 'UT', 'WY',
})

# discount_vs_comps is derived, so it can disagree with the two numbers it is derived
# from. Allow rounding only: the generator rounds price and value to whole dollars and
# the ratio to 4dp.
DISCOUNT_TOLERANCE = 0.005

# Earnings yield is a fraction, not a percent, and the two are indistinguishable by
# type. A realistic EY never leaves this band, so 23.0 (meaning 23%) fails here instead
# of rendering as 2300% on the page. Return on capital is genuinely unbounded -- a
# near-zero capital base gives a huge honest number -- so its bound is only a sanity
# check; the EY band is what actually catches a unit error, and since both ratios come
# off the same code path, catching one catches the other.
MAX_EARNINGS_YIELD = 5.0
MAX_RETURN_ON_CAPITAL = 100.0

# Market cap is in dollars. Quoting it in millions ($5722 for a $5.7B company) renders
# as "$5.7K" -- plausible-looking and completely wrong.
MIN_MARKET_CAP = 1e6

# sport -> (required top-level keys, list key, per-item required keys)
SPECS = {
    'nba': (('generated_at', 'date', 'games'), 'games',
            ('away_team', 'home_team', 'pick', 'pred_spread', 'ml_win_prob', 'confidence')),
    'nfl': (('generated_at', 'season', 'week', 'games'), 'games',
            ('away_team', 'home_team', 'pick', 'pred_spread', 'ml_win_prob', 'confidence')),
    'f1': (('generated_at', 'year', 'race_name', 'predictions'), 'predictions',
           ('driver', 'predicted_pos')),
    'real_estate': (('generated_at', 'markets', 'deals'), 'deals',
                    ('address', 'city', 'state', 'score', 'list_price',
                     'comp_implied_value', 'discount_vs_comps')),
    'magicformula': (('generated_at', 'universe_pulled', 'universe_size', 'screened',
                      'ideas'), 'ideas',
                     ('ticker', 'name', 'rank', 'earnings_yield', 'return_on_capital',
                      'market_cap')),
    # The opportunities board is the only NESTED payload: its list holds per-source
    # sections, each with its own status, caveat and item list.
    'opportunities': (('generated_at', 'sources', 'methodology'), 'sources',
                      ('source', 'label', 'status', 'caveat', 'opportunities')),
}

# A section may only carry items when its own scan is current. 'stale' and 'missing'
# exist precisely so the page can say "this source went quiet" instead of showing old
# numbers as though they were live; publishing items beside them defeats the point.
SOURCE_STATUS = ('fresh', 'empty', 'stale', 'missing', 'error')
PUBLISHABLE_STATUS = ('fresh', 'empty')


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


def require_positive(where, key, val):
    num = require_number(where, key, val)
    if num <= 0:
        raise Invalid(f'{where}.{key}={val!r} must be greater than zero')
    return num


def check_deal(where, d):
    """A published opportunity. Every check here stops the page stating a falsehood."""
    require_str(where, 'address', d['address'])
    require_str(where, 'city', d['city'])
    state = require_str(where, 'state', d['state']).strip().upper()

    if state in NON_DISCLOSURE_STATES:
        raise Invalid(f'{where}: {state} is a non-disclosure state, so its comps carry '
                      f'LIST prices, not sale prices. discount_vs_comps would be a '
                      f'list-to-list comparison presented as a discount to market value. '
                      f'Filter these out in the generator.')

    score = require_number(where, 'score', d['score'])
    if not 0.0 <= score <= 100.0:
        raise Invalid(f'{where}.score={score} must be on the model\'s 0-100 scale')

    price = require_positive(where, 'list_price', d['list_price'])
    value = require_positive(where, 'comp_implied_value', d['comp_implied_value'])
    discount = require_number(where, 'discount_vs_comps', d['discount_vs_comps'])

    # The sign convention, enforced: positive means listed BELOW comparable value.
    # An inverted subtraction turns every bargain into a premium and still renders
    # a completely plausible-looking page.
    expected = (value - price) / value
    if abs(discount - expected) > DISCOUNT_TOLERANCE:
        raise Invalid(
            f'{where}: discount_vs_comps={discount} does not match '
            f'(comp_implied_value - list_price) / comp_implied_value = {expected:.4f}. '
            f'Positive means listed BELOW comparable value; check for a flipped '
            f'subtraction or a percent-vs-fraction mixup. Emit a fraction (0.47), '
            f'never a percent (47).')

    for key in ('reno_mid', 'sqft', 'year_built', 'beds', 'baths'):
        if d.get(key) is not None:
            require_number(where, key, d[key])
    if d.get('url') is not None:
        require_str(where, 'url', d['url'])


def check_track_record(tr):
    """Optional, but if the page is going to quote the model's skill it must be real."""
    if tr is None:
        return
    if not isinstance(tr, dict):
        raise Invalid('track_record must be an object or null')
    where = 'track_record'
    for key in ('resolved', 'spearman', 'ci_low', 'ci_high'):
        if key not in tr:
            raise Invalid(f'{where} is present but missing {key!r} -- emit null instead '
                          f'of a partial record')
    resolved = require_int(where, 'resolved', tr['resolved'])
    if resolved < 30:
        raise Invalid(f'{where}.resolved={resolved} is below 30. Emit track_record=null '
                      f'rather than quoting a correlation that is noise at that size.')
    rho = require_number(where, 'spearman', tr['spearman'])
    lo = require_number(where, 'ci_low', tr['ci_low'])
    hi = require_number(where, 'ci_high', tr['ci_high'])
    for key, val in (('spearman', rho), ('ci_low', lo), ('ci_high', hi)):
        if not -1.0 <= val <= 1.0:
            raise Invalid(f'{where}.{key}={val} must be a correlation in [-1, 1]')
    if not lo <= rho <= hi:
        raise Invalid(f'{where}: spearman={rho} is outside its own CI [{lo}, {hi}]')
    for key in ('mean_edge', 'median_edge', 'share_below_comp_value'):
        if tr.get(key) is not None:
            require_number(where, key, tr[key])


def check_idea(where, item):
    require_str(where, 'ticker', item['ticker'])
    require_str(where, 'name', item['name'])

    ey = require_number(where, 'earnings_yield', item['earnings_yield'])
    if abs(ey) > MAX_EARNINGS_YIELD:
        raise Invalid(f'{where}.earnings_yield={ey} is outside +/-{MAX_EARNINGS_YIELD}. '
                      f'Emit a fraction (0.23), not a percent (23).')

    roc = require_number(where, 'return_on_capital', item['return_on_capital'])
    if abs(roc) > MAX_RETURN_ON_CAPITAL:
        raise Invalid(f'{where}.return_on_capital={roc} is outside '
                      f'+/-{MAX_RETURN_ON_CAPITAL}. Emit a fraction, not a percent.')

    cap = require_number(where, 'market_cap', item['market_cap'])
    if cap < MIN_MARKET_CAP:
        raise Invalid(f'{where}.market_cap={cap} is below {MIN_MARKET_CAP:.0f}. '
                      f'Market cap is in dollars, not millions.')

    rank = require_int(where, 'rank', item['rank'])
    if rank < 1:
        raise Invalid(f'{where}.rank={rank} must be 1-based')


def check_f1_entry(where, p):
    require_str(where, 'driver', p['driver'])
    require_number(where, 'predicted_pos', p['predicted_pos'])


def check_source_section(where, sec):
    """One per-source section of the opportunities board."""
    status = require_str(where, 'status', sec['status'])
    if status not in SOURCE_STATUS:
        raise Invalid(f'{where}: status={status!r} must be one of {SOURCE_STATUS}')
    require_str(where, 'source', sec['source'])
    require_str(where, 'label', sec['label'])
    # Every section carries a caveat by construction. The board mixes sources whose
    # numbers mean very different things, and several generators feeding it exist to
    # warn about their own output -- dropping the caveat is how a page ends up
    # presenting a momentum ranking as a trade signal.
    require_str(where, 'caveat', sec['caveat'])

    items = sec['opportunities']
    if not isinstance(items, list):
        raise Invalid(f'{where}: opportunities must be a list')
    if items and status not in PUBLISHABLE_STATUS:
        raise Invalid(f'{where}: status={status!r} but {len(items)} item(s) published; '
                      f'a section outside {PUBLISHABLE_STATUS} must show nothing')

    for i, item in enumerate(items):
        iw = f'{where}.opportunities[{i}]'
        if not isinstance(item, dict):
            raise Invalid(f'{iw} must be an object')
        missing = [k for k in ('title', 'metric_value', 'metric_display') if k not in item]
        if missing:
            raise Invalid(f'{iw} missing {missing}')
        require_str(iw, 'title', item['title'])
        require_str(iw, 'metric_display', item['metric_display'])
        # metric_value is what the section is sorted by. A string here sorts
        # lexicographically and silently reorders the board.
        require_number(iw, 'metric_value', item['metric_value'])


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
    elif sport == 'real_estate':
        markets = data['markets']
        if not isinstance(markets, list):
            raise Invalid('markets must be a list of "City, ST" strings')
        for i, m in enumerate(markets):
            require_str(f'markets[{i}]', 'value', m)
        check_track_record(data.get('track_record'))
    elif sport == 'opportunities':
        require_str('<payload>', 'methodology', data['methodology'])
        keys = [x.get('source') for x in data['sources'] if isinstance(x, dict)]
        if len(set(keys)) != len(keys):
            raise Invalid(f'duplicate source keys in sources: {keys}')
    elif sport == 'magicformula':
        check_date_string('<payload>', 'universe_pulled', data['universe_pulled'])
        size = require_int('<payload>', 'universe_size', data['universe_size'])
        screened = require_int('<payload>', 'screened', data['screened'])
        if not 0 <= screened <= size:
            raise Invalid(f'screened={screened} must be between 0 and '
                          f'universe_size={size}')
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
        if sport == 'opportunities':
            check_source_section(where, item)
        elif sport == 'f1':
            check_f1_entry(where, item)
        elif sport == 'magicformula':
            check_idea(where, item)
        elif sport == 'real_estate':
            check_deal(where, item)
        else:
            check_team_game(where, item)

    if sport == 'magicformula':
        if len(items) > data['screened']:
            raise Invalid(f'{len(items)} ideas published but only {data["screened"]} '
                          f'names passed the screen')
        # A list labelled by rank that is not in rank order renders as a ranking that
        # is not one, and nothing about the output looks wrong.
        ranks = [item['rank'] for item in items]
        if ranks != sorted(ranks):
            raise Invalid(f'ideas are not in ascending rank order: {ranks}')

    return items


def main(argv):
    if len(argv) != 3:
        print('::error::usage: validate_predictions.py '
              '{nba|nfl|f1|real_estate|magicformula} <candidate.json>')
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
