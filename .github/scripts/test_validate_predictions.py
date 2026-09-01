#!/usr/bin/env python3
"""Tests for the predictions contract gate.

    env -u PYTHONPATH python3.13 -m unittest discover -s .github/scripts -p 'test_*.py'

Four external model repos generate against validate_predictions.py, so a rule that
silently stops firing means a bad payload reaches the published site. Every case below
is a failure this gate has to keep catching; the "README example" cases assert the
documented payloads in predictions/README.md stay valid.
"""
import copy
import unittest
from datetime import datetime, timedelta, timezone

from validate_predictions import Invalid, validate

NOW = datetime(2026, 9, 9, 13, 4, 22, tzinfo=timezone.utc)
STAMP = '2026-09-09T13:04:22Z'

# Verbatim from predictions/README.md.
NFL = {
    'generated_at': STAMP, 'season': 2026, 'week': 1, 'season_type': 'regular',
    'season_status': 'in_season', 'next_season_start': '2026-09-10',
    'games': [{
        'kickoff': '2026-09-11T00:20:00Z', 'away_team': 'DAL', 'home_team': 'PHI',
        'away_team_full': 'Dallas Cowboys', 'home_team_full': 'Philadelphia Eagles',
        'pick': 'PHI', 'pred_spread': -6.5, 'pred_total': 47.5,
        'ml_win_prob': 0.68, 'confidence': 0.68,
    }],
}
NBA = {
    'generated_at': STAMP, 'date': '2026-10-22',
    'games': [{'away_team': 'BOS', 'home_team': 'NYK', 'pick': 'NYK',
               'pred_spread': -3.5, 'ml_win_prob': 0.63, 'confidence': 0.63}],
}
F1 = {
    'generated_at': STAMP, 'year': 2026, 'race_name': 'Italian Grand Prix',
    'predictions': [{'driver': 'Max Verstappen', 'predicted_pos': 1.4}],
}
REAL_ESTATE = {
    'generated_at': STAMP,
    'markets': ['Phoenix, AZ', 'Tampa, FL'],
    'track_record': {
        'resolved': 498, 'spearman': 0.309, 'ci_low': 0.227, 'ci_high': 0.386,
        'mean_edge': 0.0805, 'median_edge': 0.0823, 'share_below_comp_value': 0.6386,
    },
    'deals': [{
        'address': '926 W Cocopah St', 'city': 'Phoenix', 'state': 'AZ',
        'zip_code': '85007', 'score': 79.1, 'list_price': 270000,
        'comp_implied_value': 514009, 'discount_vs_comps': 0.4747,
        'property_type': 'SINGLE_FAMILY', 'beds': 2, 'baths': 2.0, 'sqft': 1512,
        'year_built': 1940, 'reno_scope': 'full', 'reno_mid': 149688,
        'comp_basis': '85007 SINGLE_FAMILY n=51 from sold prices',
        'rationale': '47% below single family comp median $/sqft', 'url': 'https://x',
    }],
}


def payload(base, **top):
    d = copy.deepcopy(base)
    d.update(top)
    return d


def game(base, **fields):
    d = copy.deepcopy(base)
    d['games'][0].update(fields)
    return d


class ContractBase(unittest.TestCase):
    def ok(self, sport, data):
        return validate(sport, data, now=NOW)

    def rejects(self, sport, data, contains):
        with self.assertRaises(Invalid) as cm:
            validate(sport, data, now=NOW)
        self.assertIn(contains, str(cm.exception))


class ReadmeExamples(ContractBase):
    def test_documented_payloads_validate(self):
        for sport, data in (('nfl', NFL), ('nba', NBA), ('f1', F1),
                            ('real_estate', REAL_ESTATE)):
            with self.subTest(sport=sport):
                self.assertEqual(len(self.ok(sport, data)), 1)

    def test_empty_slate_is_valid(self):
        # Off day / bye week / no race is a real statement, not a failure.
        self.assertEqual(self.ok('nfl', payload(NFL, games=[])), [])
        self.assertEqual(self.ok('nba', payload(NBA, games=[])), [])
        self.assertEqual(self.ok('f1', payload(F1, predictions=[])), [])
        # "nothing clears the bar right now" is a real statement too.
        self.assertEqual(self.ok('real_estate', payload(REAL_ESTATE, deals=[])), [])

    def test_optional_fields_may_be_omitted(self):
        minimal = payload(NFL, games=[{
            'away_team': 'DAL', 'home_team': 'PHI', 'pick': 'PHI',
            'pred_spread': -6.5, 'ml_win_prob': 0.68, 'confidence': 0.68}])
        for key in ('season_type', 'season_status', 'next_season_start'):
            minimal.pop(key, None)
        self.assertEqual(len(self.ok('nfl', minimal)), 1)


class Timestamp(ContractBase):
    def test_null_generated_at_rejected(self):
        # The state every one of the 70 failed 2026 runs would have published.
        self.rejects('nfl', payload(NFL, generated_at=None), 'did not actually run')

    def test_naive_timestamp_rejected(self):
        # Browsers parse a naive ISO string as viewer-local, so the published
        # "Updated:" line would shift by every visitor's own UTC offset.
        self.rejects('nfl', payload(NFL, generated_at='2026-09-09T13:04:22'), 'no UTC offset')

    def test_unparseable_timestamp_rejected(self):
        self.rejects('nfl', payload(NFL, generated_at='last tuesday'), 'not ISO 8601')

    def test_stale_timestamp_rejected(self):
        old = (NOW - timedelta(days=3)).isoformat()
        self.rejects('nfl', payload(NFL, generated_at=old), 'stale payload')

    def test_future_timestamp_rejected(self):
        ahead = (NOW + timedelta(days=2)).isoformat()
        self.rejects('nfl', payload(NFL, generated_at=ahead), 'in the future')

    def test_small_clock_skew_tolerated(self):
        ahead = (NOW + timedelta(minutes=20)).isoformat()
        self.assertEqual(len(self.ok('nfl', payload(NFL, generated_at=ahead))), 1)

    def test_non_utc_offset_accepted(self):
        self.assertEqual(len(self.ok('nfl', payload(NFL, generated_at='2026-09-09T09:04:22-04:00'))), 1)


class Pick(ContractBase):
    def test_pick_must_be_one_of_the_two_teams(self):
        self.rejects('nfl', game(NFL, pick='NYG'), 'is neither team')

    def test_pick_match_is_byte_equal(self):
        # The front end bolds the pick by exact string match, so 'phi' silently
        # renders a slate where no team is highlighted.
        self.rejects('nfl', game(NFL, pick='phi'), 'is neither team')
        self.rejects('nfl', game(NFL, pick='Philadelphia Eagles'), 'is neither team')

    def test_pick_must_agree_with_home_win_probability(self):
        # The away/home sign flip: model rates PHI at 0.68 but picks the underdog.
        self.rejects('nfl', game(NFL, pick='DAL'), 'HOME win probability')
        self.rejects('nfl', game(NFL, pick='PHI', ml_win_prob=0.32, confidence=0.68),
                     'HOME win probability')

    def test_away_pick_with_away_favoured_is_valid(self):
        self.assertEqual(len(self.ok('nfl', game(NFL, pick='DAL', ml_win_prob=0.32,
                                                 confidence=0.68))), 1)

    def test_pick_em_allows_either_side(self):
        for side in ('DAL', 'PHI'):
            self.assertEqual(len(self.ok('nfl', game(NFL, pick=side, ml_win_prob=0.5,
                                                     confidence=0.5))), 1)


class Numbers(ContractBase):
    def test_probability_must_not_be_a_percentage(self):
        self.rejects('nfl', game(NFL, ml_win_prob=68), 'probability in [0, 1]')

    def test_probability_must_be_a_number(self):
        self.rejects('nfl', game(NFL, ml_win_prob='0.68'), 'must be a JSON number')

    def test_booleans_are_not_numbers(self):
        self.rejects('nfl', game(NFL, pred_spread=True), 'must be a JSON number')

    def test_pred_spread_must_be_numeric(self):
        # null would render as "Spread: 0" -- a fabricated number, not a blank.
        self.rejects('nfl', game(NFL, pred_spread=None), 'must be a JSON number')
        self.rejects('nfl', game(NFL, pred_spread='-6.5'), 'must be a JSON number')

    def test_pred_total_checked_only_when_present(self):
        self.rejects('nfl', game(NFL, pred_total='47.5'), 'must be a JSON number')
        no_total = game(NFL)
        del no_total['games'][0]['pred_total']
        self.assertEqual(len(self.ok('nfl', no_total)), 1)

    def test_confidence_below_a_coin_flip_rejected(self):
        self.rejects('nfl', game(NFL, confidence=0.32), 'below 0.5')

    def test_bad_kickoff_rejected(self):
        self.rejects('nfl', game(NFL, kickoff='Sunday 8:20pm'), 'not ISO 8601')


class SeasonFields(ContractBase):
    def test_bogus_season_status_rejected(self):
        # The front end treats anything != 'in_season' as off-season, so a typo here
        # hides a live slate behind a "between seasons" message.
        self.rejects('nfl', payload(NFL, season_status='mid_season'), 'must be one of')
        self.rejects('nfl', payload(NFL, season_status='In_Season'), 'must be one of')

    def test_bogus_season_type_rejected(self):
        self.rejects('nfl', payload(NFL, season_type='regular season'), 'must be one of')

    def test_unparseable_next_season_start_rejected(self):
        # Renders as "resume when the season starts, early September NaN" otherwise.
        self.rejects('nfl', payload(NFL, next_season_start='September 2026'), 'ISO date')

    def test_week_range_enforced(self):
        self.rejects('nfl', payload(NFL, week=0), 'out of range')
        self.rejects('nfl', payload(NFL, week=40), 'out of range')
        self.rejects('nfl', payload(NFL, week='1'), 'must be a JSON integer')

    def test_nba_date_must_be_an_iso_date(self):
        self.rejects('nba', payload(NBA, date=None), 'non-empty string')
        self.rejects('nba', payload(NBA, date='10/22/2026'), 'ISO date')


class Structure(ContractBase):
    def test_missing_top_level_keys_rejected(self):
        for sport, base, key in (('nfl', NFL, 'week'), ('nba', NBA, 'date'),
                                 ('f1', F1, 'race_name')):
            with self.subTest(key=key):
                trimmed = {k: v for k, v in base.items() if k != key}
                self.rejects(sport, trimmed, f"missing required keys ['{key}']")

    def test_list_key_must_be_a_list(self):
        self.rejects('nfl', payload(NFL, games={}), 'must be a list')

    def test_items_must_be_objects(self):
        self.rejects('nfl', payload(NFL, games=['DAL @ PHI']), 'must be an object')

    def test_missing_per_item_keys_rejected(self):
        stripped = copy.deepcopy(NFL)
        del stripped['games'][0]['confidence']
        self.rejects('nfl', stripped, "missing ['confidence']")

    def test_unknown_sport_rejected(self):
        self.rejects('nhl', NFL, 'unknown sport')

    def test_top_level_must_be_an_object(self):
        self.rejects('nfl', [NFL], 'must be an object')


class Formula1(ContractBase):
    def test_driver_and_position_must_be_populated(self):
        self.rejects('f1', payload(F1, predictions=[{'driver': None, 'predicted_pos': 1.4}]),
                     'non-empty string')
        self.rejects('f1', payload(F1, predictions=[{'driver': 'VER', 'predicted_pos': None}]),
                     'must be a JSON number')

    def test_race_name_and_year_validated(self):
        self.rejects('f1', payload(F1, race_name=''), 'non-empty string')
        self.rejects('f1', payload(F1, year='2026'), 'must be a JSON integer')


class RealEstateDeals(ContractBase):
    """The published-opportunity payload. Each case is a falsehood on the page."""

    def deals(self, **over):
        d = copy.deepcopy(REAL_ESTATE['deals'][0])
        d.update(over)
        return payload(REAL_ESTATE, deals=[d])

    def test_non_disclosure_state_deals_are_refused(self):
        # TX sold prices are not public record, so the model's comps hold LIST
        # prices there and discount_vs_comps is a list-to-list comparison. 7,281
        # of the model's stored deals are Texan and none may reach the page.
        for state in ('TX', 'MO', 'UT', 'tx'):
            with self.subTest(state=state):
                self.rejects('real_estate', self.deals(state=state, city='Dallas'),
                             'non-disclosure state')

    def test_disclosure_state_deals_pass(self):
        for state in ('AZ', 'FL', 'CA', 'NY'):
            with self.subTest(state=state):
                self.assertEqual(len(self.ok('real_estate', self.deals(state=state))), 1)

    def test_discount_must_match_the_numbers_it_is_derived_from(self):
        # An inverted subtraction turns every bargain into a premium and still
        # renders a page that looks entirely plausible.
        self.rejects('real_estate', self.deals(discount_vs_comps=-0.4747),
                     'does not match')
        # (514009 - 270000) / 514009 = 0.4747, not 0.9
        self.rejects('real_estate', self.deals(discount_vs_comps=0.9), 'does not match')

    def test_rounding_slack_is_allowed(self):
        self.assertEqual(len(self.ok('real_estate', self.deals(discount_vs_comps=0.4748))), 1)

    def test_percent_instead_of_fraction_is_refused(self):
        # Caught by the derivation check, whose message names this exact mixup --
        # a positive list_price makes the ratio strictly below 1, so a percent can
        # never agree with it.
        self.rejects('real_estate', self.deals(discount_vs_comps=47), 'never a percent')

    def test_price_and_value_must_be_positive_numbers(self):
        self.rejects('real_estate', self.deals(list_price=0), 'greater than zero')
        self.rejects('real_estate', self.deals(comp_implied_value=-1), 'greater than zero')
        self.rejects('real_estate', self.deals(list_price='270000'), 'must be a JSON number')
        self.rejects('real_estate', self.deals(comp_implied_value=None), 'must be a JSON number')

    def test_score_stays_on_the_models_scale(self):
        self.rejects('real_estate', self.deals(score=101), '0-100 scale')
        self.rejects('real_estate', self.deals(score=-1), '0-100 scale')
        self.rejects('real_estate', self.deals(score=True), 'must be a JSON number')

    def test_address_and_city_must_be_populated(self):
        self.rejects('real_estate', self.deals(address=''), 'non-empty string')
        self.rejects('real_estate', self.deals(city=None), 'non-empty string')

    def test_markets_must_be_a_list_of_strings(self):
        self.rejects('real_estate', payload(REAL_ESTATE, markets='Phoenix, AZ'),
                     'must be a list')
        self.rejects('real_estate', payload(REAL_ESTATE, markets=['']), 'non-empty string')

    def test_track_record_may_be_null_but_not_partial(self):
        self.assertEqual(len(self.ok('real_estate', payload(REAL_ESTATE, track_record=None))), 1)
        self.rejects('real_estate', payload(REAL_ESTATE, track_record={'resolved': 498}),
                     "missing 'spearman'")

    def test_track_record_below_thirty_resolved_is_refused(self):
        # The CLI refuses to draw a conclusion under 30; the page must not either.
        tr = dict(REAL_ESTATE['track_record'], resolved=12)
        self.rejects('real_estate', payload(REAL_ESTATE, track_record=tr), 'below 30')

    def test_correlations_must_be_correlations(self):
        tr = dict(REAL_ESTATE['track_record'], spearman=30.9)
        self.rejects('real_estate', payload(REAL_ESTATE, track_record=tr), 'in [-1, 1]')

    def test_spearman_must_lie_inside_its_own_ci(self):
        tr = dict(REAL_ESTATE['track_record'], ci_low=0.4, ci_high=0.5)
        self.rejects('real_estate', payload(REAL_ESTATE, track_record=tr),
                     'outside its own CI')

    def test_shared_rules_still_apply(self):
        self.rejects('real_estate', payload(REAL_ESTATE, generated_at=None),
                     'did not actually run')
        self.rejects('real_estate', payload(REAL_ESTATE, generated_at='2026-09-09T13:04:22'),
                     'no UTC offset')
        stale = (NOW - timedelta(hours=9)).isoformat()
        self.rejects('real_estate', payload(REAL_ESTATE, generated_at=stale), 'stale payload')


if __name__ == '__main__':
    unittest.main()


OPPORTUNITIES = {
    'generated_at': STAMP,
    'methodology': 'Ranked within each source; no cross-source score.',
    'sources': [{
        'source': 'funding_drift',
        'label': 'Perp funding vs realized drift',
        'status': 'fresh',
        'caveat': 'An observation, not a trade recommendation.',
        'opportunities': [
            {'title': 'BTR on HTX', 'metric_value': 1.085, 'metric_display': '+108.5%'},
        ],
    }],
}


class OpportunitiesBoard(ContractBase):
    def section(self, **over):
        sec = dict(OPPORTUNITIES['sources'][0])
        sec.update(over)
        return payload(OPPORTUNITIES, sources=[sec])

    def test_documented_payload_validates(self):
        self.assertEqual(len(self.ok('opportunities', OPPORTUNITIES)), 1)

    def test_quiet_source_is_valid(self):
        # "the scan ran and found nothing" is a real statement about the market.
        self.assertEqual(len(self.ok('opportunities',
                                     self.section(status='empty', opportunities=[]))), 1)

    def test_stale_source_may_publish_nothing(self):
        self.assertEqual(len(self.ok('opportunities',
                                     self.section(status='stale', opportunities=[]))), 1)

    def test_stale_source_may_not_publish_items(self):
        # The whole point of the stale state is to stop old numbers being shown as live.
        self.rejects('opportunities', self.section(status='stale'), 'must show nothing')

    def test_missing_source_may_not_publish_items(self):
        self.rejects('opportunities', self.section(status='missing'), 'must show nothing')

    def test_unknown_status_rejected(self):
        self.rejects('opportunities', self.section(status='Fresh'), 'must be one of')

    def test_caveat_is_required(self):
        sec = dict(OPPORTUNITIES['sources'][0])
        del sec['caveat']
        self.rejects('opportunities', payload(OPPORTUNITIES, sources=[sec]), 'missing')

    def test_empty_caveat_rejected(self):
        self.rejects('opportunities', self.section(caveat=''), 'caveat')

    def test_metric_value_must_be_a_number(self):
        # A string sorts lexicographically and silently reorders the board.
        bad = [{'title': 'X', 'metric_value': '1.5', 'metric_display': '1.5'}]
        self.rejects('opportunities', self.section(opportunities=bad), 'metric_value')

    def test_metric_value_may_not_be_a_bool(self):
        bad = [{'title': 'X', 'metric_value': True, 'metric_display': 'yes'}]
        self.rejects('opportunities', self.section(opportunities=bad), 'metric_value')

    def test_item_needs_a_display_string(self):
        bad = [{'title': 'X', 'metric_value': 1.0}]
        self.rejects('opportunities', self.section(opportunities=bad), 'metric_display')

    def test_duplicate_source_keys_rejected(self):
        two = OPPORTUNITIES['sources'] * 2
        self.rejects('opportunities', payload(OPPORTUNITIES, sources=two), 'duplicate source')

    def test_methodology_is_required(self):
        d = payload(OPPORTUNITIES)
        del d['methodology']
        self.rejects('opportunities', d, 'missing required keys')

    def test_stale_generated_at_rejected(self):
        old = (NOW - timedelta(hours=9)).isoformat()
        self.rejects('opportunities', payload(OPPORTUNITIES, generated_at=old), 'stale payload')
