#!/usr/bin/env python3
"""Stamp every assets/ reference in index.html with a hash of the file's contents.

Browsers cache assets/app.js, style.css and the rest. After an update, a cached
old app.js running under a new index.html is a broken app (the export buttons,
for one, end up wired to code that no longer matches the page). A reference such
as `assets/app.js?v=3f9c2a1b` changes exactly when the file does, so a browser
fetches the new file the first time it sees the new page — and keeps using its
cached copy otherwise.

Run after changing anything in assets/ (tools/build_inventory.py also runs it):

    python3 tools/stamp_assets.py

Exits non-zero with --check if index.html is out of date, without rewriting it.
"""

import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")

# src="assets/x.js" or href="assets/x.css", with or without an existing ?v=…
REF_RE = re.compile(r'((?:src|href)=")(assets/[^"?#]+)(?:\?v=[0-9a-f]*)?(")')


def digest(relative_path):
    with open(os.path.join(ROOT, relative_path), "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()[:10]


def stamped(html):
    def replace(match):
        prefix, path, suffix = match.groups()
        if not os.path.isfile(os.path.join(ROOT, path)):
            sys.exit("index.html references a missing file: %s" % path)
        return "%s%s?v=%s%s" % (prefix, path, digest(path), suffix)

    return REF_RE.sub(replace, html)


def main():
    with open(INDEX, encoding="utf-8") as handle:
        html = handle.read()
    updated = stamped(html)
    if "--check" in sys.argv[1:]:
        if updated != html:
            sys.exit("index.html asset versions are stale: run python3 tools/stamp_assets.py")
        print("index.html asset versions are current")
        return
    if updated != html:
        with open(INDEX, "w", encoding="utf-8") as handle:
            handle.write(updated)
        print("index.html: asset versions updated")
    else:
        print("index.html: asset versions already current")


if __name__ == "__main__":
    main()
