"""Tests for template/render/fetch-template.py. No network: the package index
and tarballs are fixtures served over file:// URLs."""
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "..", "template", "render", "fetch-template.py")


def make_tarball(path, files):
    """files: {member name: text}. Written as a .tar.gz at path."""
    with tarfile.open(path, "w:gz") as tar:
        for name, text in files.items():
            data = text.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


class FetchTemplateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.pkgs = os.path.join(self.tmp, "pkgs")
        self.dest = os.path.join(self.tmp, "template-source")
        os.makedirs(self.pkgs)
        index = [
            {"name": "good-cv", "version": "1.0.0", "template": {"path": "template"},
             "categories": ["cv"], "license": "MIT"},
            {"name": "good-cv", "version": "1.2.0", "template": {"path": "template"},
             "categories": ["cv"], "license": "MIT"},
            {"name": "plain-lib", "version": "0.1.0", "categories": ["cv"], "license": "MIT"},
            {"name": "slides-tpl", "version": "0.1.0", "template": {"path": "template"},
             "categories": ["presentation"], "license": "MIT"},
            {"name": "evil-cv", "version": "0.1.0", "template": {"path": "template"},
             "categories": ["cv"], "license": "MIT"},
            {"name": "missing-cv", "version": "0.1.0", "template": {"path": "template"},
             "categories": ["cv"], "license": "MIT"},
        ]
        self.index = os.path.join(self.tmp, "index.json")
        with open(self.index, "w") as f:
            json.dump(index, f)
        make_tarball(os.path.join(self.pkgs, "good-cv-1.0.0.tar.gz"),
                     {"typst.toml": "[package]\n", "template/main.typ": '#set text(font: "Libertinus Serif")\n'})
        make_tarball(os.path.join(self.pkgs, "good-cv-1.2.0.tar.gz"),
                     {"typst.toml": "[package]\n", "LICENSE": "MIT",
                      "template/main.typ": '#set text(font: ("Zzq Fixture Sans", "Libertinus Serif"))\n',
                      "template/cover-letter.typ": "letter\n"})
        make_tarball(os.path.join(self.pkgs, "evil-cv-0.1.0.tar.gz"),
                     {"typst.toml": "[package]\n", "../escape.typ": "nope\n"})
        # missing-cv has no tarball, standing in for a failed download.

    def run_fetch(self, arg):
        env = dict(os.environ,
                   JAWBS_TYPST_INDEX_URL="file://" + self.index,
                   JAWBS_TYPST_PACKAGES_URL="file://" + self.pkgs,
                   JAWBS_TEMPLATE_SOURCE_DIR=self.dest)
        return subprocess.run([sys.executable, SCRIPT, arg], env=env,
                              capture_output=True, text=True)

    def test_name_fetches_latest_version(self):
        r = self.run_fetch("good-cv")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "good-cv-1.2.0", "template", "main.typ")))
        self.assertIn("Fetched: good-cv 1.2.0", r.stdout)
        self.assertIn("Licence: MIT", r.stdout)
        self.assertIn("Own cover letter: yes", r.stdout)
        self.assertIn("Zzq Fixture Sans", r.stdout)
        self.assertNotIn("Libertinus", r.stdout.split("Fonts to check:")[1])

    def test_name_and_version(self):
        r = self.run_fetch("good-cv:1.0.0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isdir(os.path.join(self.dest, "good-cv-1.0.0")))
        self.assertIn("Own cover letter: no", r.stdout)

    def test_universe_links_in_their_real_shapes(self):
        for link in ("https://typst.app/universe/package/good-cv",
                     "https://typst.app/universe/package/good-cv/",
                     "https://typst.app/universe/package/good-cv/1.0.0/",
                     "https://typst.app/universe/package/good-cv?x=1#top",
                     "  Good-CV  "):
            r = self.run_fetch(link)
            self.assertEqual(r.returncode, 0, f"{link}: {r.stderr}")

    def test_refuses_a_package_that_is_not_a_template(self):
        r = self.run_fetch("plain-lib")
        self.assertEqual(r.returncode, 1)
        self.assertIn("not a template", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dest, "plain-lib-0.1.0")))

    def test_refuses_a_template_outside_the_cv_category(self):
        r = self.run_fetch("slides-tpl")
        self.assertEqual(r.returncode, 1)
        self.assertIn("category=cv", r.stderr)

    def test_refuses_an_unknown_name(self):
        r = self.run_fetch("no-such-cv")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no Typst Universe package", r.stderr)

    def test_refuses_an_unsafe_archive_and_leaves_nothing(self):
        r = self.run_fetch("evil-cv")
        self.assertEqual(r.returncode, 1)
        self.assertIn("unsafe", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dest, "evil-cv-0.1.0")))
        self.assertFalse(os.path.exists(os.path.join(self.dest, "escape.typ")))
        leftovers = os.listdir(self.dest) if os.path.isdir(self.dest) else []
        self.assertEqual([p for p in leftovers if p.endswith(".partial")], [])

    def test_a_failed_download_is_one_plain_sentence_and_leaves_nothing(self):
        r = self.run_fetch("missing-cv")
        self.assertEqual(r.returncode, 1)
        self.assertIn("Could not download", r.stderr)
        self.assertNotIn("Traceback", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dest, "missing-cv-0.1.0")))

    def test_no_package_list_is_one_plain_sentence(self):
        env = dict(os.environ, JAWBS_TYPST_INDEX_URL="file://" + self.tmp + "/nope.json",
                   JAWBS_TEMPLATE_SOURCE_DIR=self.dest)
        r = subprocess.run([sys.executable, SCRIPT, "good-cv"], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("Could not read the Typst package list", r.stderr)
        self.assertNotIn("Traceback", r.stderr)

    def test_fetching_again_replaces_the_earlier_copy(self):
        self.assertEqual(self.run_fetch("good-cv").returncode, 0)
        stale = os.path.join(self.dest, "good-cv-1.2.0", "stale.typ")
        with open(stale, "w") as f:
            f.write("left over from an earlier attempt")
        self.assertEqual(self.run_fetch("good-cv").returncode, 0)
        self.assertFalse(os.path.exists(stale))

    def test_usage(self):
        r = subprocess.run([sys.executable, SCRIPT], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)

    def test_invalid_json_index_format(self):
        """Index is valid JSON but not a list of objects."""
        env = dict(os.environ,
                   JAWBS_TYPST_INDEX_URL="file://" + os.path.join(self.tmp, "bad-index.json"),
                   JAWBS_TEMPLATE_SOURCE_DIR=self.dest)
        # Write a valid JSON object (not a list)
        with open(os.path.join(self.tmp, "bad-index.json"), "w") as f:
            json.dump({"error": "not a list"}, f)
        r = subprocess.run([sys.executable, SCRIPT, "good-cv"], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("not in the expected format", r.stderr)
        self.assertNotIn("Traceback", r.stderr)

    def test_unwritable_destination(self):
        """Cannot write to destination folder."""
        # Skip this test if running as root (can write anywhere)
        if os.geteuid() == 0:
            self.skipTest("running as root; cannot test unwritable directory")

        # Create a read-only directory
        ro_dir = os.path.join(self.tmp, "readonly")
        os.makedirs(ro_dir)
        os.chmod(ro_dir, 0o555)

        try:
            env = dict(os.environ,
                       JAWBS_TYPST_INDEX_URL="file://" + self.index,
                       JAWBS_TYPST_PACKAGES_URL="file://" + self.pkgs,
                       JAWBS_TEMPLATE_SOURCE_DIR=os.path.join(ro_dir, "dest"))
            r = subprocess.run([sys.executable, SCRIPT, "good-cv"], env=env, capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            self.assertIn("Could not write", r.stderr)
            self.assertNotIn("Traceback", r.stderr)
        finally:
            # Restore permissions for cleanup
            os.chmod(ro_dir, 0o755)


if __name__ == "__main__":
    unittest.main()
