"""video/v3/say.json speaks the script's words: same words, same order, declared respellings only.

    python3 -m unittest discover -s video/v3 -v
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import voice
from voice import say_errors

HERE = Path(__file__).resolve().parent
SCRIPT = {line["scene"]: line["narration"] for line in json.loads((HERE / "script.json").read_text(encoding="utf-8"))["lines"]}
SAY = json.loads((HERE / "say.json").read_text(encoding="utf-8"))["lines"]
LINE = "Now give the team a task: add a Hull moving average."


class SayTest(unittest.TestCase):
    def test_every_spoken_form_is_its_line(self):
        self.assertTrue(SAY)
        for scene, form in SAY.items():
            self.assertIn(scene, SCRIPT)
            self.assertEqual(say_errors(SCRIPT[scene], form["say"], form.get("respell", {})), [], scene)

    def test_capitals_punctuation_and_declared_respellings_pass(self):
        self.assertEqual(say_errors(LINE, "now give the team a task — add a Hul, moving average", {"Hul": "Hull"}), [])
        self.assertEqual(say_errors("waits for you in Needs you.", 'waits for you, in "Needs you".', {}), [])

    def test_a_tamper_fails(self):
        extra = say_errors(LINE, "Now give the team a task: add a Hul new moving average.", {"Hul": "Hull"})
        self.assertEqual(extra, ["12 words spoken, 11 in the script"])
        missing = say_errors(LINE, "Now give the team a task: add Hul moving average.", {"Hul": "Hull"})
        self.assertEqual(missing, ["10 words spoken, 11 in the script"])
        swapped = say_errors(LINE, "Now give the team a task: add a moving Hul average.", {"Hul": "Hull"})
        self.assertEqual(len(swapped), 3)  # two words out of place, and 'Hul' never stands for 'Hull'
        undeclared = say_errors(LINE, "Now give the team a task: add a Hul moving average.", {})
        self.assertEqual(undeclared, ["word 9: 'Hul' for 'Hull' is not a declared respelling"])
        unused = say_errors(LINE, LINE, {"Hul": "Hull"})
        self.assertEqual(unused, ["respelling 'hul' → 'hull' is never used"])
        other_word = say_errors(LINE, "Now give the team a task: add a Hole moving average.", {"Hul": "Hull"})
        self.assertEqual(len(other_word), 2)  # 'Hole' undeclared, and 'Hul' unused

    def test_the_voice_refuses_a_tampered_file(self):
        self.assertEqual(set(voice.say_forms()), set(SAY))  # the real file loads
        tampered = json.loads(json.dumps(SAY))
        scene = next(iter(tampered))
        tampered[scene]["say"] += " Again"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "say.json"
            path.write_text(json.dumps({"lines": tampered}), encoding="utf-8")
            with mock.patch.object(voice, "SAY", path), self.assertRaises(SystemExit) as stop:
                voice.script_lines("Seven")
        self.assertIn(f"say.json {scene}:", str(stop.exception))


if __name__ == "__main__":
    unittest.main()
