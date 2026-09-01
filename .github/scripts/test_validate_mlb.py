"""
Contract tests for mlb.json.

Kept in its own file rather than appended to test_validate_predictions.py so
the two can be edited independently.

mlb.json differs from nba/nfl in two ways that both needed their own rules:
no pred_spread (the model predicts a win probability, not a run margin), and a
track_record shaped as accuracy-vs-baseline rather than a rank correlation.
"""
import unittest
from datetime import datetime, timedelta, timezone

from validate_predictions import Invalid, validate


def now_iso(offset_hours=0):
    return (datetime.now(timezone.utc) + timedelta(hours=offset_hours)).isoformat()


def game(**over):
    g = {'away_team': 'BOS', 'home_team': 'NYY', 'pick': 'NYY',
         'ml_win_prob': 0.58, 'confidence': 0.58, 'game_num': 1}
    g.update(over)
    return g


RECORD = {'season': 2026, 'n_games': 2097, 'accuracy': 0.5241,
          'baseline_accuracy': 0.5207, 'mcnemar_p_vs_baseline': 0.823,
          'beats_baseline': False, 'high_conf_n': 388,
          'high_conf_stated': 0.6475, 'high_conf_realized': 0.5696,
          'calibration_gap': -0.0779}


def payload(**over):
    p = {'generated_at': now_iso(), 'date': '2026-09-01',
         'games': [game()], 'track_record': dict(RECORD)}
    p.update(over)
    return p


class MlbShape(unittest.TestCase):
    def test_a_well_formed_payload_validates(self):
        self.assertEqual(len(validate('mlb', payload())), 1)

    def test_no_pred_spread_is_required(self):
        """The whole reason mlb has its own spec."""
        g = game()
        self.assertNotIn('pred_spread', g)
        validate('mlb', payload(games=[g]))

    def test_nba_still_requires_pred_spread(self):
        """Making it optional for mlb must not relax it for nba."""
        with self.assertRaises(Invalid) as ctx:
            validate('nba', {'generated_at': now_iso(), 'date': '2026-09-01',
                             'games': [game()]})
        self.assertIn('pred_spread', str(ctx.exception))

    def test_a_supplied_spread_is_still_validated(self):
        """Optional does not mean unchecked -- a string would render as text."""
        with self.assertRaises(Invalid):
            validate('mlb', payload(games=[game(pred_spread='-1.5')]))

    def test_date_is_required_and_must_be_iso_day(self):
        with self.assertRaises(Invalid):
            validate('mlb', payload(date='09/01/2026'))

    def test_empty_slate_is_valid(self):
        self.assertEqual(validate('mlb', payload(games=[])), [])

    def test_stale_generated_at_is_rejected(self):
        with self.assertRaises(Invalid):
            validate('mlb', payload(generated_at=now_iso(-9)))


class MlbSignConvention(unittest.TestCase):
    def test_home_favourite_must_be_picked(self):
        with self.assertRaises(Invalid) as ctx:
            validate('mlb', payload(games=[game(ml_win_prob=0.62, pick='BOS',
                                                confidence=0.62)]))
        self.assertIn('HOME win probability', str(ctx.exception))

    def test_away_favourite_must_be_picked(self):
        with self.assertRaises(Invalid):
            validate('mlb', payload(games=[game(ml_win_prob=0.38, pick='NYY',
                                                confidence=0.62)]))

    def test_away_favourite_with_away_pick_is_valid(self):
        validate('mlb', payload(games=[game(ml_win_prob=0.38, pick='BOS',
                                            confidence=0.62)]))

    def test_confidence_below_a_coin_flip_is_rejected(self):
        with self.assertRaises(Invalid):
            validate('mlb', payload(games=[game(confidence=0.42)]))

    def test_percent_probability_is_rejected(self):
        with self.assertRaises(Invalid):
            validate('mlb', payload(games=[game(ml_win_prob=58, confidence=58)]))


class MlbTrackRecord(unittest.TestCase):
    def test_null_is_allowed(self):
        validate('mlb', payload(track_record=None))

    def test_absent_is_allowed(self):
        p = payload()
        del p['track_record']
        validate('mlb', p)

    def test_partial_record_is_rejected(self):
        with self.assertRaises(Invalid) as ctx:
            validate('mlb', payload(track_record={'season': 2026,
                                                  'accuracy': 0.5241}))
        self.assertIn('emit null', str(ctx.exception))

    def test_small_sample_is_rejected(self):
        tr = dict(RECORD, n_games=40)
        with self.assertRaises(Invalid) as ctx:
            validate('mlb', payload(track_record=tr))
        self.assertIn('below 100', str(ctx.exception))

    def test_beats_baseline_may_not_contradict_the_numbers(self):
        """The headline claim has to agree with the two figures beside it."""
        tr = dict(RECORD, beats_baseline=True)   # p=0.823, so this is false
        with self.assertRaises(Invalid) as ctx:
            validate('mlb', payload(track_record=tr))
        self.assertIn('contradicts', str(ctx.exception))

    def test_beats_baseline_true_is_accepted_when_earned(self):
        tr = dict(RECORD, accuracy=0.58, baseline_accuracy=0.52,
                  mcnemar_p_vs_baseline=0.001, beats_baseline=True)
        validate('mlb', payload(track_record=tr))

    def test_realized_without_stated_is_rejected(self):
        """Realized accuracy alone is the misleading half."""
        tr = dict(RECORD)
        tr['high_conf_stated'] = None
        with self.assertRaises(Invalid) as ctx:
            validate('mlb', payload(track_record=tr))
        self.assertIn('published together', str(ctx.exception))

    def test_calibration_gap_must_be_the_actual_difference(self):
        tr = dict(RECORD, calibration_gap=0.05)
        with self.assertRaises(Invalid) as ctx:
            validate('mlb', payload(track_record=tr))
        self.assertIn('calibration_gap', str(ctx.exception))

    def test_high_conf_n_is_required_with_the_pair(self):
        tr = dict(RECORD)
        tr['high_conf_n'] = None
        with self.assertRaises(Invalid):
            validate('mlb', payload(track_record=tr))

    def test_p_value_out_of_range_is_rejected(self):
        with self.assertRaises(Invalid):
            validate('mlb', payload(
                track_record=dict(RECORD, mcnemar_p_vs_baseline=1.5)))


if __name__ == '__main__':
    unittest.main()
