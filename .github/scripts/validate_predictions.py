#!/usr/bin/env python3
"""Gate a freshly generated predictions payload before it replaces the published one.

Usage: validate_predictions.py {nba|nfl|f1|real_estate|magicformula|opportunities|business_hunter}
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

# sport -> (required top-level keys, list key, per-item required keys)
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


def check_mlb_track_record(tr):
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
    if n < 100:
        raise Invalid(f'{where}.n_games={n} is below 100. Emit track_record=null '
                      f'rather than quoting an accuracy that is noise at that size.')
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
