"""app.js must be exactly what build_app.py makes from src/ (so nobody edits one and forgets the other)."""
import os
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
import build_app  # noqa: E402


class BuildApp(unittest.TestCase):
    def test_app_js_is_up_to_date_with_src(self):
        with open(os.path.join(ROOT, "app.js"), encoding="utf-8", newline="") as f:
            current = f.read()
        self.assertEqual(current, build_app.built(),
                         "app.js is out of date with src/: run  python build_app.py  and commit app.js")

    def test_the_program_has_no_typing_errors(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node isn't installed")
        done = subprocess.run([node, "--check", os.path.join(ROOT, "app.js")], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_the_program_starts_and_ends_as_one_block(self):
        text = build_app.built()
        self.assertIn("(function () {", text[:400])
        self.assertTrue(text.rstrip().endswith("})();"), "the last file should close the program")


if __name__ == "__main__":
    unittest.main()
