"""The sound check's verdicts on given phonemes and word times (no model needed).

    python3 -m unittest discover -s video/v3 -v
"""

import unittest

from phonemes import sound


def ph(*seq, t=0.0, step=0.06):
    """Phonemes one after another, `step` s each."""
    return [(p, t + i * step, t + (i + 1) * step) for i, p in enumerate(seq)]


def words(*spans):
    return [{"word": w, "start": a, "end": b} for w, a, b in spans]


# "… add a whole moving …": Whisper's "moving" starts late (after the l), as in V3's renders.
HULL_WORDS = words(("add", 0.0, 0.12), ("a", 0.12, 0.18), ("whole", 0.18, 0.36), ("moving", 0.36, 0.6))
# "… for you and needs you": its "needs" starts a phoneme late too.
IN_WORDS = words(("for", 0.0, 0.12), ("you", 0.12, 0.24), ("and", 0.24, 0.42), ("needs", 0.42, 0.66))


class SoundTest(unittest.TestCase):
    def test_hull_needs_the_short_vowel(self):
        self.assertEqual(sound("3.1", None, HULL_WORDS, ph("æ", "d", "ɐ", "h", "oʊ", "l", "m", "uː", "v")),
                         (False, "[ɐ] h oʊ l [m uː]"))
        self.assertEqual(sound("3.1", None, HULL_WORDS, ph("æ", "d", "ɐ", "h", "ʌ", "l", "m", "uː", "v")),
                         (True, "[ɐ] h ʌ l [m uː]"))
        self.assertFalse(sound("3.1", None, HULL_WORDS, ph("æ", "d", "ɐ", "h", "ʌ", "oʊ", "l", "m", "uː"))[0])

    def test_in_is_not_and(self):
        self.assertEqual(sound("4.2", None, IN_WORDS, ph("f", "ɚ", "j", "uː", "æ", "n", "d", "n", "iː", "d", "z")),
                         (False, "[j uː] æ n d [n iː]"))
        self.assertFalse(sound("4.2", None, IN_WORDS, ph("f", "ɚ", "j", "uː", "ɪ", "n", "d", "n", "iː", "d", "z"))[0])
        self.assertEqual(sound("4.2", None, IN_WORDS, ph("f", "ɚ", "j", "uː", "ɪ", "n", "n", "iː", "d", "z")),
                         (True, "[j uː] ɪ n [n iː]"))

    def test_another_word_with_the_right_vowel_fails(self):
        self.assertFalse(sound("3.1", None, HULL_WORDS, ph("æ", "d", "ɐ", "h", "ʌ", "t", "m", "uː", "v"))[0])  # hut
        self.assertFalse(sound("4.2", None, IN_WORDS, ph("f", "ɚ", "j", "uː", "ɪ", "t", "n", "iː", "d", "z"))[0])  # it
        self.assertFalse(sound("4.2", None, IN_WORDS, ph("f", "ɚ", "j", "uː", "ə", "n", "n", "iː", "d", "z"))[0])  # 'n'
        self.assertTrue(sound("3.1", None, HULL_WORDS, ph("æ", "d", "ɐ", "h", "ʌ", "l̩", "m", "uː", "v"))[0])
        self.assertTrue(sound("4.2", None, IN_WORDS, ph("f", "ɚ", "j", "uː", "ɪː", "n", "n", "iː", "d", "z"))[0])
        # "in" whose n the decoder merged into "needs": the vowel alone is still the word
        self.assertTrue(sound("4.2", None, IN_WORDS, ph("f", "ɚ", "j", "uː", "ɪ", "n", "iː", "d", "z"))[0])

    def test_a_dropped_word_or_a_missing_place_fails(self):
        self.assertFalse(sound("4.2", None, IN_WORDS, ph("f", "ɚ", "j", "uː", "n", "iː", "d", "z"))[0])
        ok, why = sound("4.2", None, words(("for", 0.0, 0.1), ("you", 0.1, 0.2), ("too", 0.2, 0.3)), ph("j", "uː"))
        self.assertEqual((ok, why), (False, "no 'you … needs' in the words"))


if __name__ == "__main__":
    unittest.main()
