#!/usr/bin/env python3
"""Fetch a CV template from Typst Universe into render/template-source/.

Usage: render/fetch-template.py <name | name:version | Universe package link>

Only templates in Typst Universe's CV category are accepted:
https://typst.app/universe/search/?kind=templates&category=cv
Anything else is refused with the reason. This is where that rule lives, so it
holds whoever or whatever runs the script. Standard library only.
"""
import http.client
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request

INDEX_URL = os.environ.get("JAWBS_TYPST_INDEX_URL", "https://packages.typst.org/preview/index.json")
PACKAGES_URL = os.environ.get("JAWBS_TYPST_PACKAGES_URL", "https://packages.typst.org/preview")
CATEGORY_LINK = "https://typst.app/universe/search/?kind=templates&category=cv"
HERE = os.path.dirname(os.path.abspath(__file__))
DEST_ROOT = os.environ.get("JAWBS_TEMPLATE_SOURCE_DIR", os.path.join(HERE, "template-source"))

# Families Typst embeds, so a template naming them needs nothing bundled.
TYPST_FONTS = {"libertinus serif", "new computer modern", "new computer modern math", "dejavu sans mono"}


class Refusal(Exception):
    """A reason to stop, worded for the person reading it."""


def parse_request(text):
    t = text.strip()
    m = re.match(r"^https?://typst\.app/universe/package/([A-Za-z0-9_-]+)(?:/([0-9][0-9.]*))?/?(?:[?#].*)?$", t)
    if not m:
        m = re.match(r"^@?(?:preview/)?([A-Za-z0-9_-]+)(?::([0-9][0-9.]*))?$", t)
    if not m:
        raise Refusal(f'"{text.strip()}" is not a template name or a Typst Universe package link.')
    return m.group(1).lower(), m.group(2)


def version_key(v):
    return tuple(int(x) for x in re.findall(r"\d+", v))


def choose(index, name, version):
    if not isinstance(index, list):
        raise Refusal("The Typst package list was not in the expected format.")
    try:
        entries = [p for p in index if p.get("name") == name]
    except AttributeError:
        raise Refusal("The Typst package list was not in the expected format.")
    if not entries:
        raise Refusal(f'There is no Typst Universe package called "{name}". The CV templates are listed at {CATEGORY_LINK}')
    if version:
        entries = [p for p in entries if p.get("version") == version]
        if not entries:
            raise Refusal(f"{name} has no version {version}.")
    pkg = max(entries, key=lambda p: version_key(p.get("version", "0")))
    if not pkg.get("template"):
        raise Refusal(f"{name} is a package, not a template, so it is not one of the CV templates at {CATEGORY_LINK}")
    if "cv" not in (pkg.get("categories") or []):
        raise Refusal(f"{name} is a template, but not one of the CV templates at {CATEGORY_LINK}")
    return pkg


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def unpack(data, dest):
    """Unpack into dest via a .partial folder, so a failure leaves nothing."""
    tmp = dest + ".partial"
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        os.makedirs(tmp)
    except OSError as e:
        raise Refusal(f"Could not write to {os.path.dirname(tmp)} ({e}).")
    try:
        real_tmp = os.path.realpath(tmp)
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            members = tar.getmembers()
            for m in members:
                target = os.path.realpath(os.path.join(tmp, m.name))
                inside = target == real_tmp or target.startswith(real_tmp + os.sep)
                if not inside or m.issym() or m.islnk():
                    raise Refusal(f"The download contains an unsafe path ({m.name}), so it was not unpacked.")
            safe = [m for m in members if m.isfile() or m.isdir()]
            if hasattr(tarfile, "data_filter"):
                tar.extractall(tmp, members=safe, filter="data")
            else:
                tar.extractall(tmp, members=safe)
    except Refusal:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    except (tarfile.TarError, OSError) as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise Refusal(f"The download could not be unpacked ({e}).")
    shutil.rmtree(dest, ignore_errors=True)
    try:
        os.rename(tmp, dest)
    except OSError as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise Refusal(f"Could not write to {os.path.dirname(dest)} ({e}).")


def typ_files(root):
    for dirpath, _, names in os.walk(root):
        for n in names:
            if n.endswith(".typ"):
                yield os.path.join(dirpath, n)


def fonts_named(root):
    found = set()
    for path in typ_files(root):
        with open(path, encoding="utf-8", errors="replace") as f:
            src = f.read()
        for m in re.finditer(r"font\s*:\s*(\([^)]*\)|\"[^\"]+\")", src):
            found.update(re.findall(r"\"([^\"]+)\"", m.group(1)))
    return found


def fonts_available():
    """Families Typst can see, including render/fonts/; empty if Typst is absent."""
    try:
        out = subprocess.run(["typst", "fonts", "--font-path", os.path.join(HERE, "fonts")],
                             capture_output=True, text=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    return {line.strip().lower() for line in out.splitlines() if line.strip()}


def report(pkg, dest):
    letters = [os.path.relpath(p, dest) for p in typ_files(dest) if "letter" in os.path.basename(p).lower()]
    have = TYPST_FONTS | fonts_available()
    check = sorted(f for f in fonts_named(dest) if f.lower() not in have)
    print(f"Fetched: {pkg['name']} {pkg['version']}")
    print(f"Licence: {pkg.get('license', 'not stated')}")
    print(f"Unpacked to: {dest}")
    print("Own cover letter: " + (f"yes ({', '.join(sorted(letters))})" if letters else "no"))
    print("Fonts to check: " + (", ".join(check) if check else "none"))


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    try:
        name, version = parse_request(argv[1])
        try:
            index = json.loads(fetch(INDEX_URL))
        except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError) as e:
            raise Refusal(f"Could not read the Typst package list ({e}). Check the internet connection and try again.")
        pkg = choose(index, name, version)
        url = f"{PACKAGES_URL}/{pkg['name']}-{pkg['version']}.tar.gz"
        try:
            data = fetch(url)
        except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
            raise Refusal(f"Could not download {pkg['name']} {pkg['version']} ({e}). Check the internet connection and try again.")
        try:
            os.makedirs(DEST_ROOT, exist_ok=True)
        except OSError as e:
            raise Refusal(f"Could not write to {DEST_ROOT} ({e}).")
        dest = os.path.join(DEST_ROOT, f"{pkg['name']}-{pkg['version']}")
        unpack(data, dest)
    except Refusal as e:
        print(str(e), file=sys.stderr)
        return 1
    report(pkg, dest)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
