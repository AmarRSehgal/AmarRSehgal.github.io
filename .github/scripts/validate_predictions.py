#!/usr/bin/env python3
"""Gate a freshly generated predictions payload before it replaces the published one.

Usage: validate_predictions.py {nba|nfl|mlb|f1|real_estate|magicformula|opportunities
                               |business_hunter|funding|contracts}
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

# business_hunter publishes `multiple` alongside the asking price and cash flow it is
# derived from, rounded to 2dp -- so allow a rounding-sized disagreement and nothing more.
MULTIPLE_TOLERANCE = 0.02

# The screener refuses to score these earnings labels, and a refused row must never
# reach the page. Flippa's self-reported monthly "net_profit" has a median of 0.98x, so
# on a page ranked by discount those rows would place FIRST -- the least credible
# listings presented as the best finds. The generator excludes them; this is the
# independent check that they never come back.
REFUSED_CASH_FLOW_TYPES = frozenset({'net_profit', ''})
SCORABLE_CASH_FLOW_TYPES = frozenset({'SDE', 'EBITDA', 'cashflow'})
BUSINESS_TRAITS = frozenset({'absentee', 'recurring', 'online'})

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

# Evidence tiers from sam-contracts/lanes.py, strongest first. Only OBSERVED means this
# machine actually watched the buy repeat across snapshots; the other three are hints
# read off a single posting. The page words them differently, so a tier it does not
# know would render a guess as a finding.
EVIDENCE_TIERS = ('OBSERVED', 'POSTED-HISTORY', 'PERIOD-MARKER', 'CLUSTER')

# Recurrence inferred from one solicitation is not recurrence, and "recurring lane" is
# the entire value proposition of this feed -- a lane is worth a SAM registration only
# if the buy comes back.
MIN_OBSERVED_SOLICITATIONS = 2

# OPEN and small-business are self-certified. HUBZone / 8(a) / SDVOSB / WOSB are hard
# gates needing a formal certification that takes months, so publishing one as
# "biddable now" invites days of work on a bid that cannot be submitted at all.
REACHABLE_ACCESS = ('OPEN', 'small-biz')

# Every link in this feed points back to the authoritative notice. Anything else is
# either a bug or an untrusted URL being published under this site's name.
SAM_LINK_PREFIX = 'https://sam.gov/opp/'

# sport -> (required top-level keys, list key, per-item required keys)
TRADE_STATES = {'open', 'closing', 'closed', 'rejected', 'unfilled'}

SPECS = {
    'nba': (('generated_at', 'date', 'games'), 'games',
            ('away_team', 'home_team', 'pick', 'pred_spread', 'ml_win_prob', 'confidence')),
    'nfl': (('generated_at', 'season', 'week', 'games'), 'games',
            ('away_team', 'home_team', 'pick', 'pred_spread', 'ml_win_prob', 'confidence')),
    # MLB carries no pred_spread: the model predicts a win probability and not a
    # run margin, so there is no honest number to put there and a fabricated one
    # is exactly what this contract refuses elsewhere.
    'mlb': (('generated_at', 'date', 'games'), 'games',
            ('away_team', 'home_team', 'pick', 'ml_win_prob', 'confidence')),
    'f1': (('generated_at', 'year', 'race_name', 'predictions'), 'predictions',
           ('driver', 'predicted_pos')),
    # What the news is actually covering. `caveat` is REQUIRED: the ranking is by how
    # many independent outlets carry a topic, NOT by sentiment, because VADER mis-scores
    # news language -- a payload without that sentence would let the page read as a
    # sentiment index, which it is not.
    'news': (('generated_at', 'window_hours', 'articles_in_window', 'caveat', 'topics'),
             'topics', ('term', 'articles', 'sources', 'sentiment_direction')),
    # A snapshot of who is winning on Polymarket's 5-minute BTC markets, not a forecast.
    # `disclaimer` is REQUIRED: the project looked for manipulation, did not find any, and
    # deliberately carries no manipulation field. A payload that lost that sentence would
    # let the page imply the opposite of the finding.
    'polymarket_whales': (('generated_at', 'window', 'markets', 'headline',
                           'disclaimer', 'traders'), 'traders',
                          ('wallet', 'trades', 'win_rate', 'net_roi', 'edge')),
    'business_hunter': (('generated_at', 'sources', 'screened', 'scored', 'refused',
                         'flagged', 'businesses'), 'businesses',
                        ('title', 'source', 'url', 'asking_price', 'cash_flow',
                         'cash_flow_type', 'multiple', 'fair_value', 'discount',
                         'score')),
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
    # Cross-exchange funding carry. The numbers here are PERCENTS, not
    # probabilities -- net_apr is 42.1 for 42.1%/yr and routinely exceeds 100.
    # Do not "fix" it into the [0, 1] rule the sports feeds use.
    'funding': (('generated_at', 'status', 'scans_seen', 'opportunities'), 'opportunities',
                ('base', 'type', 'long_venue', 'short_venue', 'min_hold_h',
                 'hits', 'scans', 'net_apr', 'net_at_hold')),
    # The two live paper books, on their own dedicated Alpaca paper accounts. Same
    # shape, same checks, two feeds -- they are separate books and merging them into
    # one payload would make the strategies inseparable, which is the entire point of
    # running them in different accounts.
    #
    # `starting_equity` is required because a return with no base is unfalsifiable, and
    # `account` because a book published under the wrong account number is worse than
    # no book at all.
    'swing_book': (('generated_at', 'account', 'started', 'starting_equity', 'equity',
                    'positions'), 'positions',
                   ('ticker', 'qty', 'avg_entry', 'price', 'market_value', 'pnl',
                    'return_pct')),
    'mf_book': (('generated_at', 'account', 'started', 'starting_equity', 'equity',
                 'positions'), 'positions',
                ('ticker', 'qty', 'avg_entry', 'price', 'market_value', 'pnl',
                 'return_pct')),
    # Fourth paper book, and the successor to options_levels. Same book shape, plus two
    # keys no other book needs:
    #
    #   `strategies` -- five sleeves run in one account, two of them deliberately funded
    #                   at zero. A reader seeing only the blended P&L would have no way
    #                   to know which sleeves were actually live, so the roster travels
    #                   with the numbers.
    #   `research`   -- inherited from the feed this replaces. The book exists because a
    #                   prior strategy was researched and failed; without the note the
    #                   page becomes a claim rather than a record.
    'stock_levels': (('generated_at', 'account', 'paper', 'started', 'starting_equity',
                      'equity', 'strategies', 'research', 'positions'), 'positions',
                     ('ticker', 'qty', 'avg_entry', 'price', 'market_value', 'pnl',
                      'return_pct')),
    # Opening-range level breaks, third paper book. Two requirements no other feed has,
    # because this strategy BACKTESTED NEGATIVE and is published anyway:
    #
    #   `backtest.note`  -- the page's honesty depends on that caveat being present. If a
    #                       generator drops it, the site silently becomes a portfolio
    #                       asserting an edge the author's own research denies. Required
    #                       so that failure is loud rather than cosmetic.
    #   `gate_mode`      -- 'observe' means trades are taken whether or not the Rule Zero
    #                       gate approved them. A reader assuming 'strict' would badly
    #                       misread the P&L, so the mode travels with the numbers.
    'options_levels': (('generated_at', 'account', 'paper', 'started', 'starting_equity',
                        'equity', 'status', 'gate_mode', 'universe_size', 'backtest',
                        'day', 'performance', 'trades', 'levels'),
                       'levels',
                       ('symbol', 'or_high', 'or_low', 'long_trigger', 'short_trigger',
                        'width_pct', 'gap_pct', 'rank')),
    # Federal resale lanes from SAM.gov. The only feed here that CANNOT be regenerated
    # in CI: the daily extract carries just the currently-active notices, so recurrence
    # is visible only to a job that has been recording snapshots on one machine. That
    # makes `snapshots` / `observing_snapshots` the evidence behind every cadence claim
    # rather than decoration, which is why they are required keys.
    #
    # It also carries TWO lists. `lanes` is the ranked recurrence finding and is the
    # list_key; `open` is what a self-cert bidder could quote on today and shares no
    # field with it, so it is checked in the per-feed block below.
    'contracts': (('generated_at', 'snapshot_date', 'snapshots', 'observing_snapshots',
                   'notices_tracked', 'lanes', 'open'), 'lanes',
                  ('office', 'agency', 'group', 'lane', 'evidence', 'solicitations',
                   'cadence', 'states', 'link')),
}

# 'building_history' is not a failure: the funding board only publishes routes
# that stayed positive across most of the last day of scans, so a fresh install
# has nothing to say yet and must say that rather than "no opportunities".
FUNDING_STATUS = ('ok', 'building_history')

# A section may only carry items when its own scan is current. 'stale' and 'missing'
# exist precisely so the page can say "this source went quiet" instead of showing old
# numbers as though they were live; publishing items beside them defeats the point.
SOURCE_STATUS = ('fresh', 'empty', 'stale', 'missing', 'error')
PUBLISHABLE_STATUS = ('fresh', 'empty')

# The session state of the options book. A DOMAIN vocabulary, not a health one: these say
# what the book is doing, not whether the job ran. Named so test_status_vocabulary.py can
# prove it never collides with the health words the renderer suppresses on -- it once did
# not, and predictions.js rendered a book holding five live positions as "not reporting".
OPTIONS_SESSION_STATUS = ('armed', 'in_position', 'closed', 'no_session')


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


def check_team_game(where, g, spread_required=True):
    away = require_str(where, 'away_team', g['away_team'])
    home = require_str(where, 'home_team', g['home_team'])
    pick = require_str(where, 'pick', g['pick'])
    if pick not in (away, home):
        raise Invalid(f'{where} pick {pick!r} is neither team ({away!r}/{home!r}) -- '
                      f'it must be byte-equal to away_team or home_team')

    prob = require_probability(where, 'ml_win_prob', g['ml_win_prob'])
    conf = require_probability(where, 'confidence', g['confidence'])
    if spread_required or g.get('pred_spread') is not None:
        # Optional for a spread-less sport, but never unchecked: a string here
        # would render as literal text in the meta line.
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


def check_business(where, b):
    """A published acquisition candidate. Each check stops the page asserting
    something the screen does not actually support."""
    require_str(where, 'title', b['title'])
    require_str(where, 'source', b['source'])
    # The feed publishes links, so a row without one is a dead end on the page.
    require_str(where, 'url', b['url'])

    # Membership is tested BEFORE the non-empty check: the empty label is itself a
    # refused type, and the refused message tells a generator author what to do
    # about it where "must be a non-empty string" does not.
    raw_type = b['cash_flow_type']
    cf_type = raw_type.strip() if isinstance(raw_type, str) else raw_type
    if cf_type in REFUSED_CASH_FLOW_TYPES:
        raise Invalid(
            f'{where}.cash_flow_type={cf_type!r} is a refused earnings label -- the '
            f'screener will not score it, so it cannot be published as an opportunity. '
            f'Its multiple is not comparable to a vetted earnings stream and on a page '
            f'ranked by discount it would rank first. Filter it in the generator.')
    cf_type = require_str(where, 'cash_flow_type', raw_type).strip()
    if cf_type not in SCORABLE_CASH_FLOW_TYPES:
        raise Invalid(f'{where}.cash_flow_type={cf_type!r} is not one of '
                      f'{sorted(SCORABLE_CASH_FLOW_TYPES)}')

    price = require_positive(where, 'asking_price', b['asking_price'])
    cash_flow = require_positive(where, 'cash_flow', b['cash_flow'])
    multiple = require_positive(where, 'multiple', b['multiple'])
    fair_value = require_positive(where, 'fair_value', b['fair_value'])
    discount = require_number(where, 'discount', b['discount'])
    score = require_number(where, 'score', b['score'])

    # `multiple` is derived from two numbers published right beside it, so a
    # disagreement means the page is showing a ratio that contradicts its own figures.
    expected_multiple = price / cash_flow
    if abs(multiple - expected_multiple) > MULTIPLE_TOLERANCE:
        raise Invalid(f'{where}: multiple={multiple} does not match asking_price / '
                      f'cash_flow = {expected_multiple:.4f}')

    # The sign convention, enforced: positive means priced BELOW the band for this
    # listing's earnings type and size. A flipped subtraction turns every premium into
    # a bargain and still renders a completely plausible page.
    expected_discount = 1.0 - (multiple / fair_value)
    if abs(discount - expected_discount) > DISCOUNT_TOLERANCE:
        raise Invalid(
            f'{where}: discount={discount} does not match 1 - (multiple / fair_value) '
            f'= {expected_discount:.4f}. Positive means priced BELOW the fair-value '
            f'band; check for a flipped subtraction or a percent-vs-fraction mixup. '
            f'Emit a fraction (0.47), never a percent (47).')

    # A published row must actually be a candidate. The screener's own history is the
    # reason this is checked at the boundary: trait bonuses used to be additive, so
    # absentee/recurring/online keywords manufactured a positive score on businesses
    # priced at or above fair value -- 297 of 640 flagged rows were >= their band.
    if multiple >= fair_value:
        raise Invalid(f'{where}: multiple={multiple} is at or above its fair_value band '
                      f'({fair_value}), so it is not a discount and must not be '
                      f'published as an opportunity')
    if discount <= 0:
        raise Invalid(f'{where}: discount={discount} must be positive for a published '
                      f'opportunity')
    if score <= 0:
        raise Invalid(f'{where}: score={score} must be positive -- a zero score means '
                      f'the listing is at or above its band')

    if type(b.get('vetted')) is not bool:
        raise Invalid(f'{where}.vetted={b.get("vetted")!r} must be a JSON boolean. It '
                      f'means the source screened the P&L, NOT that anyone audited it.')

    traits = b.get('traits', [])
    if not isinstance(traits, list):
        raise Invalid(f'{where}.traits must be a list')
    for t in traits:
        if t not in BUSINESS_TRAITS:
            raise Invalid(f'{where}.traits contains {t!r}; expected one of '
                          f'{sorted(BUSINESS_TRAITS)}')


def check_business_counts(data, published):
    """The screen summary is the page's honesty about what it looked at.

    These counts are what let a reader see that 97 rows were refused rather than
    silently dropped, so an inconsistent set is worse than no set at all.
    """
    screened = require_int('<payload>', 'screened', data['screened'])
    scored = require_int('<payload>', 'scored', data['scored'])
    refused = require_int('<payload>', 'refused', data['refused'])
    flagged = require_int('<payload>', 'flagged', data['flagged'])
    for key, val in (('screened', screened), ('scored', scored),
                     ('refused', refused), ('flagged', flagged)):
        if val < 0:
            raise Invalid(f'<payload>.{key}={val} cannot be negative')

    if scored + refused > screened:
        raise Invalid(f'scored ({scored}) + refused ({refused}) exceeds screened '
                      f'({screened}) -- every scored or refused listing was screened')
    if flagged > scored:
        raise Invalid(f'flagged ({flagged}) exceeds scored ({scored}) -- a listing '
                      f'cannot be below its band without having been scored')
    if published > flagged:
        raise Invalid(f'{published} businesses published but only {flagged} flagged -- '
                      f'the page would be showing rows the screen did not flag')

    sources = data['sources']
    if not isinstance(sources, list):
        raise Invalid('sources must be a list of per-source count objects')
    totals = {'listings': 0, 'refused': 0, 'flagged': 0}
    for i, s in enumerate(sources):
        where = f'sources[{i}]'
        if not isinstance(s, dict):
            raise Invalid(f'{where} must be an object')
        require_str(where, 'name', s.get('name'))
        for key in ('listings', 'scored', 'refused', 'flagged'):
            if key not in s:
                raise Invalid(f'{where} missing {key!r}')
            require_int(where, key, s[key])
        for key in totals:
            totals[key] += s[key]
    if totals['listings'] != screened:
        raise Invalid(f'per-source listings sum to {totals["listings"]} but screened is '
                      f'{screened}')
    if totals['flagged'] != flagged:
        raise Invalid(f'per-source flagged sum to {totals["flagged"]} but flagged is '
                      f'{flagged}')


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


# Minimum games before an accuracy may be quoted at all, per sport. It is not one
# number because the sports are not one size: MLB plays 2,430 games a season, so 100 is
# a fortnight; the NFL plays 272, so a 100-game floor would mean no record until week 7
# of every season and none at all in the first six weeks a feed exists. 10 is most of a
# single NFL week, which is the smallest honest unit here. The floor exists
# to stop a number that is pure noise being read as skill -- below FRAGILE_SAMPLE the
# front end is required to say so in the same breath as the number.
MIN_TRACK_GAMES = {'mlb': 100, 'nfl': 10}
FRAGILE_SAMPLE = 100


def check_mlb_track_record(tr, sport='mlb'):
    """
    MLB's record is accuracy against a baseline, not a rank correlation.

    Deliberately a different shape from check_track_record: forcing an accuracy
    into a `spearman` field would be a false statement about what was measured.
    The calibration pair is the load-bearing part -- accuracy over the -110
    break-even of 0.524 is not an edge when the confident picks are lopsided
    matchups a book prices at short odds, so a page that quotes the model's
    skill has to be able to show realized against stated.
    """
    if tr is None:
        return
    if not isinstance(tr, dict):
        raise Invalid('track_record must be an object or null')
    where = 'track_record'
    for key in ('n_games', 'accuracy', 'baseline_accuracy', 'mcnemar_p_vs_baseline'):
        if key not in tr:
            raise Invalid(f'{where} is present but missing {key!r} -- emit null '
                          f'instead of a partial record')
    n = require_int(where, 'n_games', tr['n_games'])
    floor = MIN_TRACK_GAMES.get(sport, FRAGILE_SAMPLE)
    if n < floor:
        raise Invalid(f'{where}.n_games={n} is below {floor} for {sport}. Emit '
                      f'track_record=null rather than quoting an accuracy that is '
                      f'noise at that size.')
    acc = require_probability(where, 'accuracy', tr['accuracy'])
    base = require_probability(where, 'baseline_accuracy', tr['baseline_accuracy'])
    pval = require_number(where, 'mcnemar_p_vs_baseline', tr['mcnemar_p_vs_baseline'])
    if not 0.0 <= pval <= 1.0:
        raise Invalid(f'{where}.mcnemar_p_vs_baseline={pval} must be in [0, 1]')

    # beats_baseline is what the page would headline, so it may not disagree
    # with the two numbers next to it.
    if 'beats_baseline' in tr:
        claim = tr['beats_baseline']
        if not isinstance(claim, bool):
            raise Invalid(f'{where}.beats_baseline must be a boolean')
        truth = pval < 0.05 and acc > base
        if claim != truth:
            raise Invalid(
                f'{where}.beats_baseline={claim} contradicts accuracy={acc} vs '
                f'baseline={base} at p={pval}. It is true only when the model is '
                f'both better AND significant at p<0.05.')

    stated = tr.get('high_conf_stated')
    realized = tr.get('high_conf_realized')
    if (stated is None) != (realized is None):
        raise Invalid(f'{where}: high_conf_stated and high_conf_realized must be '
                      f'published together -- realized accuracy without the '
                      f'confidence it was stated at is the misleading half')
    if stated is not None:
        st = require_probability(where, 'high_conf_stated', stated)
        rz = require_probability(where, 'high_conf_realized', realized)
        if tr.get('high_conf_n') is None:
            raise Invalid(f'{where}: high_conf_n is required alongside the '
                          f'confidence pair')
        require_int(where, 'high_conf_n', tr['high_conf_n'])
        if tr.get('calibration_gap') is not None:
            gap = require_number(where, 'calibration_gap', tr['calibration_gap'])
            if abs(gap - (rz - st)) > 5e-4:
                raise Invalid(f'{where}.calibration_gap={gap} is not '
                              f'high_conf_realized - high_conf_stated '
                              f'({rz} - {st} = {round(rz - st, 4)})')


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


SENTIMENT_DIRECTION = ('positive', 'negative', 'mixed', 'unknown')


def check_news_topic(where: str, t: dict) -> None:
    """One topic. Coverage is the measurement; sentiment is a coarse direction at most."""
    require_str(where, 'term', t['term'])
    arts = require_int(where, 'articles', t['articles'])
    srcs = require_int(where, 'sources', t['sources'])
    if srcs > arts:
        raise Invalid(f'{where}: sources={srcs} exceeds articles={arts}')
    if t['sentiment_direction'] not in SENTIMENT_DIRECTION:
        raise Invalid(f"{where}: sentiment_direction={t['sentiment_direction']!r} must "
                      f"be one of {SENTIMENT_DIRECTION}")
    # A numeric mean is allowed but must not be the only thing carried: the direction is
    # what the page shows, because the mean implies a precision VADER does not have here.
    if 'sentiment_mean' in t and t['sentiment_mean'] is not None:
        require_number(where, 'sentiment_mean', t['sentiment_mean'])


# Must match tracker.py's classifier exactly. It emits four labels and the contract
# listed three of them plus a 'none' nothing produces, so every payload carrying an
# unprofitable wallet was rejected and the feed sat six days stale behind a passing job.
WHALE_EDGE = ('late-window', 'broad', 'unprofitable-overall', 'insufficient-history')


def check_whales_payload(data: dict) -> None:
    """The snapshot's own totals, and the sentence the project refuses to publish without."""
    w = data['window']
    if not isinstance(w, dict) or 'hours' not in w:
        raise Invalid('window must be an object with an hours field')
    m = data['markets']
    if not isinstance(m, dict):
        raise Invalid('markets must be an object')
    for key in ('resolved', 'late_flip'):
        require_int('markets', key, m[key])
    if m['late_flip'] > m['resolved']:
        raise Invalid(f"markets.late_flip={m['late_flip']} exceeds "
                      f"resolved={m['resolved']}")
    require_number('markets', 'traded_notional', m['traded_notional'])
    # The project looked for manipulation, did not find any, and deliberately carries no
    # manipulation field. If the page ever implies otherwise it will be because this
    # sentence went missing, so the contract refuses a payload without it.
    d = require_str('<payload>', 'disclaimer', data['disclaimer'])
    if 'NOT a manipulation report' not in d:
        raise Invalid('disclaimer must still state that this is NOT a manipulation '
                      'report -- that is the project\'s own finding')


def check_whale(where: str, t: dict) -> None:
    """One audited wallet. Every field here is measured, none is inferred."""
    require_str(where, 'wallet', t['wallet'])
    for key in ('trades', 'wins', 'losses'):
        if key in t and not isinstance(t[key], int):
            raise Invalid(f'{where}: {key} must be an integer')
    for key in ('win_rate', 'net_roi'):
        require_number(where, key, t[key])
    if not 0.0 <= float(t['win_rate']) <= 1.0:
        raise Invalid(f"{where}: win_rate={t['win_rate']} outside [0, 1]")
    if t['edge'] not in WHALE_EDGE:
        raise Invalid(f"{where}: edge={t['edge']!r} must be one of {WHALE_EDGE}")
    # The wallet address must be truncated. Publishing a full address on a portfolio
    # page points a crowd at one identifiable trader over behaviour the project itself
    # concluded was legal and unremarkable.
    if len(t['wallet']) > 24 or '...' not in t['wallet']:
        raise Invalid(f"{where}: wallet={t['wallet']!r} must be truncated (0xabc...1234)")


def check_funding_route(where, r):
    """A published route claims it was worth doing repeatedly, so check that.

    The generator only publishes routes that stayed net-positive across most of
    the last day's scans. If a non-positive or impossible route reaches here the
    persistence filter has broken, and that failure is invisible on the page --
    it just looks like a thin board.
    """
    require_str(where, 'base', r['base'])
    long_venue = require_str(where, 'long_venue', r['long_venue'])
    short_venue = require_str(where, 'short_venue', r['short_venue'])
    opp_type = require_str(where, 'type', r['type'])

    if opp_type not in ('spot-perp', 'perp-perp'):
        raise Invalid(f"{where}.type={opp_type!r} must be 'spot-perp' or 'perp-perp'")
    # A same-venue spot+perp is a real strategy; a same-venue perp+perp is a
    # position against itself and earns exactly nothing.
    if opp_type == 'perp-perp' and long_venue == short_venue:
        raise Invalid(f'{where} is perp-perp with both legs on {long_venue!r} -- '
                      f'that is a position against itself, not a carry')

    hold = require_int(where, 'min_hold_h', r['min_hold_h'])
    if hold < 1:
        raise Invalid(f'{where}.min_hold_h={hold} must be at least 1 hour')

    hits = require_int(where, 'hits', r['hits'])
    scans = require_int(where, 'scans', r['scans'])
    if hits < 1 or scans < 1:
        raise Invalid(f'{where} hits={hits} scans={scans} must both be >= 1')
    if hits > scans:
        raise Invalid(f'{where} hits={hits} exceeds scans={scans} -- a route cannot '
                      f'have been positive more often than it was looked at')

    apr = require_number(where, 'net_apr', r['net_apr'])
    at_hold = require_number(where, 'net_at_hold', r['net_at_hold'])
    if apr <= 0:
        raise Invalid(f'{where}.net_apr={apr} is not positive. Only routes that were '
                      f'worth doing get published, so a non-positive one means the '
                      f'persistence filter let a losing route through.')
    if at_hold <= 0:
        raise Invalid(f'{where}.net_at_hold={at_hold} is not positive but net_apr is '
                      f'{apr} -- these are the same return over different horizons '
                      f'and cannot disagree in sign')


def check_game_result(where, g):
    """The final score attached to a game that has already been played.

    `correct` is the field the page renders a hit/miss mark from, and it is derivable
    from the other three -- so it is checked against them rather than trusted. A
    generator that computed it from a stale pick would otherwise publish a green tick
    on a game it got wrong, which is the single worst thing this feed could do.
    """
    r = g.get('result')
    if r is None:
        return
    if not isinstance(r, dict):
        raise Invalid(f'{where}.result must be an object or absent')
    for key in ('away_pts', 'home_pts', 'winner', 'correct'):
        if key not in r:
            raise Invalid(f'{where}.result missing {key!r} -- omit result entirely '
                          f'rather than publishing a partial one')
    away = require_int(f'{where}.result', 'away_pts', r['away_pts'])
    home = require_int(f'{where}.result', 'home_pts', r['home_pts'])
    if away < 0 or home < 0:
        raise Invalid(f'{where}.result has a negative score')
    winner = require_str(f'{where}.result', 'winner', r['winner'])
    if winner not in (g['away_team'], g['home_team']):
        raise Invalid(f'{where}.result.winner={winner!r} is not one of the two teams')
    if away != home and winner != (g['home_team'] if home > away else g['away_team']):
        raise Invalid(f'{where}.result.winner={winner!r} contradicts the score '
                      f'{away}-{home}')
    if type(r['correct']) is not bool:
        raise Invalid(f'{where}.result.correct must be a boolean')
    if r['correct'] != (g['pick'] == winner):
        raise Invalid(f'{where}.result.correct={r["correct"]} contradicts pick='
                      f'{g["pick"]!r} against winner={winner!r}')


def check_portfolio(port):
    """Real positions marked against live prices, published beside the screen.

    A ranking has no outcome, so a screen can look good indefinitely on its own. These
    are the entries actually taken off it, which is the only part that can be wrong in
    a way that costs something -- so the totals are checked against the rows.
    """
    if port is None:
        return
    if not isinstance(port, dict):
        raise Invalid('portfolio must be an object or null')
    rows = port.get('positions')
    if not isinstance(rows, list) or not rows:
        raise Invalid('portfolio.positions must be a non-empty list')
    for i, r in enumerate(rows):
        w = f'portfolio.positions[{i}]'
        require_str(w, 'ticker', r.get('ticker'))
        require_str(w, 'buy_date', r.get('buy_date'))
        check_date_string(w, 'buy_date', r['buy_date'])
        if type(r.get('open')) is not bool:
            raise Invalid(f'{w}.open must be a boolean')
        # A position with no fetchable quote must say so rather than be carried at
        # cost, which would score it as exactly flat and drag the total toward zero.
        if r.get('price_unavailable'):
            continue
        require_number(w, 'return_pct', r.get('return_pct'))
        require_number(w, 'pnl', r.get('pnl'))

    cost = require_number('portfolio', 'cost_basis', port.get('cost_basis'))
    value = require_number('portfolio', 'market_value', port.get('market_value'))
    if cost <= 0:
        raise Invalid('portfolio.cost_basis must be positive')
    ret = port.get('return_pct')
    if ret is not None:
        derived = (value - cost) / cost
        if abs(require_number('portfolio', 'return_pct', ret) - derived) > 0.0005:
            raise Invalid(f'portfolio.return_pct={ret} disagrees with market_value '
                          f'{value} against cost_basis {cost} (={derived:.4f})')
    excess = port.get('excess_return_pct')
    if excess is not None and ret is not None:
        bench = require_number('portfolio', 'benchmark_return_pct',
                               port.get('benchmark_return_pct'))
        if abs(excess - (ret - bench)) > 0.0005:
            raise Invalid(f'portfolio.excess_return_pct={excess} is not return_pct '
                          f'minus benchmark_return_pct')


def check_f1_entry(where, p):
    require_str(where, 'driver', p['driver'])
    require_number(where, 'predicted_pos', p['predicted_pos'])


# A paper book must never be published as though it were traded. Every number in
# these feeds comes from simulated fills with no queue position, and the page has to
# say so -- so the flag is required and required to be true, not merely allowed.
def check_book_payload(data, sport):
    """Payload-level checks for a live paper book."""
    if data.get('paper') is not True:
        raise Invalid(f'{sport}: paper must be true. These feeds are simulated fills '
                      f'on a paper account and may not be published as anything else')
    require_str('<payload>', 'account', data['account'])
    check_date_string('<payload>', 'started', data['started'])

    base = require_number('<payload>', 'starting_equity', data['starting_equity'])
    equity = require_number('<payload>', 'equity', data['equity'])
    if base <= 0:
        raise Invalid('starting_equity must be positive -- a return with no base '
                      'cannot be checked')
    ret = data.get('return_pct')
    if ret is not None:
        derived = (equity - base) / base
        if abs(require_number('<payload>', 'return_pct', ret) - derived) > 0.0005:
            raise Invalid(f'return_pct={ret} disagrees with equity {equity} against '
                          f'starting_equity {base} (={derived:.4f})')
    excess = data.get('excess_return_pct')
    if excess is not None and ret is not None:
        bench = require_number('<payload>', 'benchmark_return_pct',
                               data.get('benchmark_return_pct'))
        if abs(excess - (ret - bench)) > 0.0005:
            raise Invalid('excess_return_pct is not return_pct minus '
                          'benchmark_return_pct')

    curve = data.get('equity_curve')
    if curve is not None:
        if not isinstance(curve, list):
            raise Invalid('equity_curve must be a list')
        last = None
        for i, pt in enumerate(curve):
            if not isinstance(pt, dict) or 'date' not in pt or 'equity' not in pt:
                raise Invalid(f'equity_curve[{i}] needs date and equity')
            check_date_string(f'equity_curve[{i}]', 'date', pt['date'])
            require_number(f'equity_curve[{i}]', 'equity', pt['equity'])
            # Out-of-order points render as a line that doubles back on itself, which
            # reads as a crash rather than as bad data.
            if last is not None and pt['date'] < last:
                raise Invalid(f'equity_curve[{i}].date={pt["date"]} is before the '
                              f'previous point {last} -- the curve must be ascending')
            last = pt['date']

    # The whole reason the swing book exists is the gap between a backtest that says
    # the strategy loses and a live result. Publishing the live number without the
    # backtest beside it is how that framing quietly disappears.
    if sport == 'stock_levels':
        if not data['research'].get('note'):
            raise Invalid('research.note is required: the book publishes a record, not a claim')
        funded = [x for x in data['strategies'] if x.get('funded')]
        if not funded:
            raise Invalid('no strategy is funded -- publishing a book nothing trades')

    if sport == 'swing_book' and data.get('backtest') is not None:
        bt = data['backtest']
        if not isinstance(bt, dict):
            raise Invalid('backtest must be an object or null')
        for key in ('strategy_return', 'benchmark_return'):
            if key not in bt:
                raise Invalid(f'backtest is present but missing {key!r}')


def check_level(where, lv):
    """One armed opening-range level.

    The buffer is the whole rule (Rulebook Sec.10): a trigger sitting inside the opening
    range would fire on exactly the marginal tag the buffer exists to reject, so a payload
    like that describes a different strategy than the one the page names.
    """
    require_str(where, 'symbol', lv['symbol'])
    hi = require_number(where, 'or_high', lv['or_high'])
    lo = require_number(where, 'or_low', lv['or_low'])
    lng = require_number(where, 'long_trigger', lv['long_trigger'])
    sht = require_number(where, 'short_trigger', lv['short_trigger'])
    require_number(where, 'width_pct', lv['width_pct'])
    require_number(where, 'gap_pct', lv['gap_pct'])
    require_int(where, 'rank', lv['rank'])
    if lo > hi:
        raise Invalid(f'{where}: or_low={lo} is above or_high={hi}')
    if lng <= hi:
        raise Invalid(f'{where}: long_trigger={lng} is not above or_high={hi}')
    if sht >= lo:
        raise Invalid(f'{where}: short_trigger={sht} is not below or_low={lo}')


def check_book_position(where, pos):
    require_str(where, 'ticker', pos['ticker'])
    for key in ('qty', 'avg_entry', 'price', 'market_value', 'pnl', 'return_pct'):
        require_number(where, key, pos[key])
    if pos['qty'] <= 0:
        raise Invalid(f'{where}.qty={pos["qty"]} -- these books are long only, and a '
                      f'zero or short quantity means the reconcile went wrong')
    if pos['avg_entry'] <= 0 or pos['price'] <= 0:
        raise Invalid(f'{where} has a non-positive price')


def check_contracts_payload(data):
    """Payload-level checks for the federal-lanes feed: the counters and the `open` list.

    The counters are not decoration. Every cadence on the page is an inference from how
    many days this machine has actually recorded, so a payload claiming observed
    recurrence off one snapshot is claiming something it cannot know.
    """
    check_date_string('<payload>', 'snapshot_date', data['snapshot_date'])
    snapshot_day = data['snapshot_date']

    snapshots = require_int('<payload>', 'snapshots', data['snapshots'])
    observing = require_int('<payload>', 'observing_snapshots', data['observing_snapshots'])
    tracked = require_int('<payload>', 'notices_tracked', data['notices_tracked'])
    if snapshots < 1:
        raise Invalid('snapshots=0 -- nothing has been recorded, so there is nothing to publish')
    if not 0 <= observing <= snapshots:
        raise Invalid(f'observing_snapshots={observing} must be between 0 and '
                      f'snapshots={snapshots}. It counts the snapshots that actually saw '
                      f'new data; re-ingesting an unchanged extract is not a day of history')
    if tracked < 1:
        raise Invalid('notices_tracked=0 with a payload to publish')

    # OBSERVED means "seen repeat across distinct snapshot days". With fewer than two
    # days of real history no lane can honestly carry it, whatever the generator said.
    if observing < MIN_OBSERVED_SOLICITATIONS:
        claimed = [i for i, l in enumerate(data['lanes'])
                   if isinstance(l, dict) and l.get('evidence') == 'OBSERVED']
        if claimed:
            raise Invalid(f'lanes{claimed} claim evidence=OBSERVED on only {observing} '
                          f'snapshot(s) with new data -- recurrence cannot have been '
                          f'observed yet')

    notices = data['open']
    if not isinstance(notices, list):
        raise Invalid('open must be a list of currently-biddable notices')
    for i, n in enumerate(notices):
        where = f'open[{i}]'
        if not isinstance(n, dict):
            raise Invalid(f'{where} must be an object')
        missing = [k for k in ('title', 'office', 'group', 'deadline', 'access', 'link')
                   if k not in n]
        if missing:
            raise Invalid(f'{where} missing {missing}')
        check_open_notice(where, n, snapshot_day)


def check_lane(where, lane):
    """One recurring-buy lane. The evidence tier is the load-bearing field."""
    require_str(where, 'office', lane['office'])
    require_str(where, 'agency', lane['agency'])
    require_str(where, 'group', lane['group'])
    require_str(where, 'lane', lane['lane'])
    check_sam_link(where, lane['link'])

    evidence = require_str(where, 'evidence', lane['evidence'])
    if evidence not in EVIDENCE_TIERS:
        raise Invalid(f'{where}: evidence={evidence!r} must be one of {EVIDENCE_TIERS} -- '
                      f'the page words each tier differently and cannot render an '
                      f'unknown one without overstating it')

    n = require_int(where, 'solicitations', lane['solicitations'])
    if n < 1:
        raise Invalid(f'{where}: solicitations={n} -- a lane nothing was seen in is not a lane')
    if evidence == 'OBSERVED' and n < MIN_OBSERVED_SOLICITATIONS:
        raise Invalid(f'{where}: evidence=OBSERVED on {n} solicitation(s). OBSERVED asserts '
                      f'this machine watched the buy REPEAT; emit a weaker tier instead')

    states = lane['states']
    if not isinstance(states, list):
        raise Invalid(f'{where}: states must be a list of two-letter codes')
    for i, st in enumerate(states):
        require_str(f'{where}.states[{i}]', 'value', st)

    # cadence may be '' (unknown), but if a cadence is claimed it has to be backed by a
    # measured gap. "biweekly" with no cadence_days is a label with nothing behind it.
    cadence = lane['cadence']
    if not isinstance(cadence, str):
        raise Invalid(f'{where}: cadence={cadence!r} must be a string ("" when unknown)')
    if cadence and lane.get('cadence_days') is None:
        raise Invalid(f'{where}: cadence={cadence!r} claimed with cadence_days=null -- '
                      f'emit the measured gap or emit no cadence')


def check_open_notice(where, n, snapshot_day):
    """One notice presented as biddable RIGHT NOW."""
    require_str(where, 'title', n['title'])
    require_str(where, 'office', n['office'])
    check_sam_link(where, n['link'])
    check_date_string(where, 'deadline', n['deadline'])

    access = require_str(where, 'access', n['access'])
    if access not in REACHABLE_ACCESS:
        raise Invalid(f'{where}: access={access!r} must be one of {REACHABLE_ACCESS}. A '
                      f'set-aside needing formal certification is not biddable by a '
                      f'self-cert bidder and must not be published as an opportunity')

    # Compared against the payload's own snapshot date rather than the wall clock, so
    # the check is about generator correctness and cannot fail on a midnight race.
    if n['deadline'] < snapshot_day:
        raise Invalid(f'{where}: deadline={n["deadline"]} already closed as of '
                      f'snapshot_date={snapshot_day} -- publishing it as open is the '
                      f'one thing this panel must never do')


def check_sam_link(where, link):
    require_str(where, 'link', link)
    if not link.startswith(SAM_LINK_PREFIX):
        raise Invalid(f'{where}: link={link!r} must point at {SAM_LINK_PREFIX}...')


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

    if sport == 'funding':
        if data['status'] not in FUNDING_STATUS:
            raise Invalid(f'status={data["status"]!r} must be one of {list(FUNDING_STATUS)}')
        seen = require_int('<payload>', 'scans_seen', data['scans_seen'])
        if seen < 0:
            raise Invalid(f'scans_seen={seen} cannot be negative')
        # "Still building history" and "nothing is worth doing" are different
        # claims and the page renders them differently. Publishing a board while
        # status says the history is too thin to judge asserts both at once.
        if data['status'] == 'building_history' and data['opportunities']:
            raise Invalid(f'status=building_history but {len(data["opportunities"])} '
                          f'opportunities are published -- the page would show a board '
                          f'while saying it has no basis for one')
    elif sport == 'nba':
        check_date_string('<payload>', 'date', data['date'])
    elif sport == 'mlb':
        check_date_string('<payload>', 'date', data['date'])
        check_mlb_track_record(data.get('track_record'))
    elif sport == 'nfl':
        # Same shape as mlb's, and checked by the same function on purpose: both are
        # "accuracy against a baseline, plus calibration of the confident picks", and
        # two copies of that rule would drift.
        check_mlb_track_record(data.get('track_record'), sport='nfl')
        require_int('<payload>', 'season', data['season'])
        week = require_int('<payload>', 'week', data['week'])
        if not 1 <= week <= 25:
            raise Invalid(f'week={week} is out of range (1-18 regular, 19+ playoffs)')
    elif sport == 'business_hunter':
        check_business_counts(data, len(data['businesses'])
                              if isinstance(data.get('businesses'), list) else 0)
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
    elif sport == 'options_levels':
        if data['paper'] is not True:
            raise Invalid('paper must be true: this book may not be published as anything else')
        if data['gate_mode'] not in ('observe', 'strict'):
            raise Invalid(f"gate_mode={data['gate_mode']!r} must be 'observe' or 'strict'")
        if data['status'] not in OPTIONS_SESSION_STATUS:
            raise Invalid(f"status={data['status']!r} is not a known session state")
        for key in ('day', 'performance'):
            if not isinstance(data[key], dict):
                raise Invalid(f'{key} must be an object')
        require_number('<payload>', 'equity', data['equity'])
        require_number('<payload>', 'starting_equity', data['starting_equity'])
        require_number('day', 'realized_pnl', data['day']['realized_pnl'])
        perf = data['performance']
        require_number('performance', 'realized_pnl', perf['realized_pnl'])
        # A hit rate off a handful of trades is noise presented as a statistic, so the
        # generator publishes null until the sample is worth quoting. Enforce the range
        # when it is present, and allow the null.
        hr = perf.get('hit_rate')
        if hr is not None:
            hr = require_number('performance', 'hit_rate', hr)
            if not 0.0 <= hr <= 1.0:
                raise Invalid(f'performance.hit_rate={hr} is outside [0, 1]')
        closed = require_int('performance', 'closed', perf['closed'])
        wins = require_int('performance', 'wins', perf['wins'])
        if wins > closed:
            raise Invalid(f'performance.wins={wins} exceeds closed={closed}')
        if not isinstance(data['trades'], list):
            raise Invalid('trades must be a list')
        for i, t in enumerate(data['trades']):
            where = f'trades[{i}]'
            if not isinstance(t, dict):
                raise Invalid(f'{where} must be an object')
            require_str(where, 'symbol', t.get('symbol'))
            if t.get('status') not in TRADE_STATES:
                raise Invalid(f'{where}: status={t.get("status")!r} not in '
                              f'{sorted(TRADE_STATES)}')
            # A closed trade with no realised number renders a blank where a P&L belongs,
            # which reads as break-even rather than as unknown.
            if t['status'] == 'closed' and t.get('realized_pnl') is None:
                raise Invalid(f'{where}: closed trade has no realized_pnl')
        bt = data['backtest']
        if not isinstance(bt, dict) or not str(bt.get('note', '')).strip():
            raise Invalid('backtest.note is required: this strategy tested negative and '
                          'the page has to say so on every load')
    elif sport == 'magicformula':
        check_date_string('<payload>', 'universe_pulled', data['universe_pulled'])
        size = require_int('<payload>', 'universe_size', data['universe_size'])
        screened = require_int('<payload>', 'screened', data['screened'])
        if not 0 <= screened <= size:
            raise Invalid(f'screened={screened} must be between 0 and '
                          f'universe_size={size}')
        check_portfolio(data.get('portfolio'))
    elif sport == 'contracts':
        check_contracts_payload(data)
    elif sport == 'stock_levels':
        check_book_payload(data, sport)
        if not isinstance(data['strategies'], list) or not data['strategies']:
            raise Invalid('strategies must be a non-empty list')
        for st in data['strategies']:
            for k in ('name', 'alloc_pct', 'funded'):
                if k not in st:
                    raise Invalid(f'strategy entry missing {k!r}')
        if not isinstance(data['research'], dict):
            raise Invalid('research must be an object')
    elif sport in ('swing_book', 'mf_book'):
        check_book_payload(data, sport)
    elif sport == 'polymarket_whales':
        check_whales_payload(data)
    elif sport == 'news':
        require_int('<payload>', 'window_hours', data['window_hours'])
        require_int('<payload>', 'articles_in_window', data['articles_in_window'])
        c = require_str('<payload>', 'caveat', data['caveat'])
        if 'not by sentiment' not in c:
            raise Invalid('caveat must still say the ranking is not by sentiment -- '
                          'that is what stops the page reading as a sentiment index')
    elif sport == 'f1':
        require_int('<payload>', 'year', data['year'])
        require_str('<payload>', 'race_name', data['race_name'])
    else:
        # Was an `else` that assumed F1, so every feed added after it was silently
        # checked against F1's top-level keys and failed on a missing 'year'. An
        # unrecognised sport is a contract gap and must say so.
        raise Invalid(f'no top-level checks defined for sport={sport!r}; add a branch '
                      f'rather than letting it fall through')

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
        elif sport == 'contracts':
            check_lane(where, item)
        elif sport in ('swing_book', 'mf_book', 'stock_levels'):
            check_book_position(where, item)
        elif sport == 'options_levels':
            check_level(where, item)
        elif sport == 'f1':
            check_f1_entry(where, item)
        elif sport == 'polymarket_whales':
            check_whale(where, item)
        elif sport == 'news':
            check_news_topic(where, item)
        elif sport == 'funding':
            check_funding_route(where, item)
        elif sport == 'magicformula':
            check_idea(where, item)
        elif sport == 'business_hunter':
            check_business(where, item)
        elif sport == 'real_estate':
            check_deal(where, item)
        elif sport == 'mlb':
            check_team_game(where, item, spread_required=False)
            check_game_result(where, item)
        else:
            check_team_game(where, item)
            if sport in ('nfl', 'nba'):
                check_game_result(where, item)

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
        # Derived from SPECS, not typed: a hand-maintained list here silently
        # drops a feed every time two people add one at once.
        print('::error::usage: validate_predictions.py '
              '{' + '|'.join(sorted(SPECS)) + '} <candidate.json>')
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
