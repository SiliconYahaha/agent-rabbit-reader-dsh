#!/usr/bin/env python3
"""Regenerate native references; install cmarkgfm==2025.10.22 in an isolated env.

Run from any cwd. Emits JSON on stdout; does not change stored expectations.
Tasklist is explicit for mixed raw HTML, without GFM's tagfilter extension.
"""
import json
from importlib.metadata import version
from pathlib import Path
from cmarkgfm.cmark import Options, github_flavored_markdown_to_html, markdown_to_html_with_extensions

assert version('cmarkgfm') == '2025.10.22'
fixture = Path(__file__).resolve().parents[1] / 'tests/fixtures/markdown-list-tabs-reference.json'
rows = []
options = Options.CMARK_OPT_FOOTNOTES | Options.CMARK_OPT_UNSAFE
for sample in json.loads(fixture.read_text())['cases']:
    if sample['suite'] == 'footnote':
        reference = github_flavored_markdown_to_html(sample['source'], options=options)
    elif sample['suite'] == 'mixed':
        reference = markdown_to_html_with_extensions(sample['source'], options=options, extensions=['tasklist'])
    else:
        continue
    assert reference == sample['referenceHtml'], sample['name']
    rows.append({'name': sample['name'], 'referenceHtml': reference})
print(json.dumps({'oracle': 'cmarkgfm ' + version('cmarkgfm'), 'exactReferences': len(rows), 'rows': rows}, ensure_ascii=False))
