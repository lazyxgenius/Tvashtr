"""The transcript gate: what passes, what doesn't (needs inflect: run with the voice venv).

    video/voice-venv/bin/python -m unittest discover -s video/v3 -v
"""

import unittest

try:
    import inflect  # noqa: F401
except ImportError:  # the system python has no inflect; the voice venv does
    inflect = None


@unittest.skipIf(inflect is None, "inflect not installed (use video/voice-venv)")
class GateTest(unittest.TestCase):
    def setUp(self):
        from voice import gate

        self.gate = gate

    def test_numbers_and_punctuation(self):
        line = "Round two passes: six hundred and sixty-five tests. Command-K finds any run."
        self.assertTrue(self.gate(line, "Round 2 passes, 665 tests. Command K finds any run.")[0])

    def test_name_may_vary_and_is_reported(self):
        ok, heard = self.gate("It approves, citing Tvashtr's test result.",
                              "It approves, citing Tvashtar's test result.")
        self.assertTrue(ok)
        self.assertEqual(heard, ["tvashtars"])
        ok, heard = self.gate("This is Tvashtr.", "This is T. Vashter.")
        self.assertEqual((ok, heard), (True, ["t vashter"]))

    def test_same_words_spelled_another_way(self):
        self.assertTrue(self.gate("Command-K finds any run.", "⌘K finds any run.")[0])
        self.assertTrue(self.gate("Command-K finds any run.", "Cmd+K finds any run.")[0])
        self.assertTrue(self.gate("Run them all: three of four pass.", "Run them all, 3/4 pass.")[0])
        self.assertTrue(self.gate("The Toolkit is shared by every team.", "The tool kit is shared by every team.")[0])
        self.assertTrue(self.gate("it switches to the backup model", "it switches to the back-up model")[0])
        self.assertTrue(self.gate("on the Claude and Grok subscriptions", "on the Claude and Groq subscriptions")[0])
        self.assertFalse(self.gate("on the Claude and Grok subscriptions", "on the Cloud and Grok subscriptions")[0])

    def test_any_other_difference_fails(self):
        self.assertFalse(self.gate("Then choose what the team remembers.",
                                   "Then choose what the teams remember.")[0])
        self.assertFalse(self.gate("This is Tvashtr.", "This is Tvashtr. Thank you.")[0])
        self.assertFalse(self.gate("One bar shows what every agent is doing.",
                                   "One bar shows what every agent is.")[0])


if __name__ == "__main__":
    unittest.main()
