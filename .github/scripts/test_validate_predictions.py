#!/usr/bin/env python3
"""Tests for the predictions contract gate.

    env -u PYTHONPATH python3.13 -m unittest discover -s .github/scripts -p 'test_*.py'

Three external model repos generate against validate_predictions.py, so a rule that
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
        for sport, data in (('nfl', NFL), ('nba', NBA), ('f1', F1)):
            with self.subTest(sport=sport):
                self.assertEqual(len(self.ok(sport, data)), 1)

    def test_empty_slate_is_valid(self):
        # Off day / bye week / no race is a real statement, not a failure.
        self.assertEqual(self.ok('nfl', payload(NFL, games=[])), [])
        self.assertEqual(self.ok('nba', payload(NBA, games=[])), [])
        self.assertEqual(self.ok('f1', payload(F1, predictions=[])), [])

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


if __name__ == '__main__':
    unittest.main()
