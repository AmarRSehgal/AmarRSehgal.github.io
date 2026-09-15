"""The renderer and the validator must agree on what a payload's `status` MEANS.

predictions.js suppresses a feed's entire payload when it reads the top-level `status`
as a health failure. `status` is not reserved for health, though: options_levels puts
its session state there and funding puts ok/building_history there. When the renderer
treated every unrecognised value as a failure, both feeds were suppressed outright --
the options book rendered as "This scanner is not reporting" while holding five live
positions, and its own slate() already had the words for that exact state.

There is no JS harness in this repo, so the agreement is asserted by reading the two
source files. That is enough: the bug was a mismatch between two literal vocabularies,
and a mismatch is exactly what this can see.
"""
import pathlib
import re
import unittest

import validate_predictions as V

REPO = pathlib.Path(__file__).resolve().parents[2]
PREDICTIONS_JS = REPO / 'predictions.js'


def health_status_from_js():
    """The keys of the HEALTH_STATUS object literal in predictions.js."""
    src = PREDICTIONS_JS.read_text()
    m = re.search(r'const HEALTH_STATUS = \{(.*?)\};', src, re.S)
    if m is None:
        raise AssertionError('predictions.js no longer declares a HEALTH_STATUS literal; '
                             'the renderer and this test have diverged')
    return frozenset(re.findall(r'^\s*(\w+)\s*:', m.group(1), re.M))


class StatusVocabulary(unittest.TestCase):

    def test_renderer_health_words_match_the_validator(self):
        # SOURCE_STATUS minus the healthy two IS the set the renderer may suppress on.
        expected = frozenset(V.SOURCE_STATUS) - frozenset(V.PUBLISHABLE_STATUS)
        self.assertEqual(health_status_from_js(), expected)

    def test_domain_vocabularies_do_not_collide_with_health(self):
        health = health_status_from_js()
        for name, vocab in (('OPTIONS_SESSION_STATUS', V.OPTIONS_SESSION_STATUS),
                            ('FUNDING_STATUS', V.FUNDING_STATUS)):
            clash = health & frozenset(vocab)
            self.assertEqual(clash, frozenset(),
                             f'{name} shares {sorted(clash)} with the renderer health '
                             f'vocabulary; those payloads would be suppressed on screen')

    def test_a_live_options_session_is_not_a_health_failure(self):
        # The regression itself: 'in_position' is the status the published book carried
        # while the card said the scanner was not reporting.
        self.assertNotIn('in_position', health_status_from_js())
        self.assertIn('in_position', V.OPTIONS_SESSION_STATUS)


if __name__ == '__main__':
    unittest.main()
