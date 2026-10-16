"""video/v3/script.json is the approved narration, byte for byte.

    python3 -m unittest discover -s video/v3 -v

The approved export (prompts/video-v3-script.md) is the architect's and never committed: when it is
on disk, every line is compared with it byte for byte; without it, the recorded block hash and the
counts still hold.
"""

import hashlib
import json
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "script.json"
SOURCE = HERE.parents[1] / "prompts" / "video-v3-script.md"


def load():
    return json.loads(SCRIPT.read_text(encoding="utf-8"))


class ScriptTest(unittest.TestCase):
    def test_counts_and_order(self):
        lines = load()["lines"]
        self.assertEqual(len(lines), 35)
        self.assertEqual(sum(len(line["narration"].split()) for line in lines), 795)
        scenes = [line["scene"] for line in lines]
        self.assertEqual(len(set(scenes)), 35)
        self.assertEqual(scenes[:2], ["0.1", "0.2"])
        self.assertEqual(scenes[-1], "8.2")
        self.assertLess(scenes.index("3.7"), scenes.index("3.5"))  # 3.5 opens chapter 4
        self.assertEqual(
            [line["scene"] for line in lines if "{resume_minutes}" in line["narration"]], ["4.2"]
        )

    @unittest.skipUnless(SOURCE.exists(), "prompts/video-v3-script.md not on disk")
    def test_identical_to_the_approved_export(self):
        block = re.search(r"```json\n(.*?)\n```", SOURCE.read_text(encoding="utf-8"), re.S).group(1)
        approved = json.loads(block)
        data = load()
        self.assertEqual(data["source_block_sha256"], hashlib.sha256(block.encode()).hexdigest())
        self.assertEqual(len(data["lines"]), len(approved))
        for ours, theirs in zip(data["lines"], approved):
            # every field (chapter, scene, narration, caption, badge, note) and nothing more
            self.assertEqual(ours, theirs)
            self.assertEqual(ours["narration"].encode("utf-8"), theirs["narration"].encode("utf-8"))


if __name__ == "__main__":
    unittest.main()
