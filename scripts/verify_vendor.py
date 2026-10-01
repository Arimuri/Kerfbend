#!/usr/bin/env python3
"""Verify the shipped FFT source and third-party license notices, without network access."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'vendor' / 'fft.js'
manifest = json.loads((VENDOR / 'provenance.json').read_text())


def verify(data, expected, label):
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise SystemExit(f'{label}: SHA-256 mismatch: {actual}')


for filename, expected in manifest['files'].items():
    verify((VENDOR / filename).read_bytes(), expected, filename)

browser = (VENDOR / 'fft.js').read_bytes()
begin = manifest['sourceMarkers']['begin'].encode()
end = manifest['sourceMarkers']['end'].encode()
if browser.count(begin) != 1 or browser.count(end) != 1:
    raise SystemExit('FFT upstream source markers are missing or duplicated')
source = browser.split(begin, 1)[1].split(end, 1)[0]
verify(source, manifest['upstreamSource']['sha256'], 'Unmodified upstream lib/fft.js')
license_text = (VENDOR / 'LICENSE').read_text()
for line in license_text.splitlines():
    if line and (' * ' + line + '\n').encode() not in browser:
        raise SystemExit('The browser bundle is missing part of the MIT notice')
verify((ROOT / 'licenses' / 'partitura-Apache-2.0.txt').read_bytes(),
       '99fc6ac5e7720d5f6a928d86ae9a532559559e92bbaa4504e6c3d49062bf6bd2',
       'Partitura Apache-2.0 license')
for path in ('THIRD_PARTY_NOTICES.md', 'docs/reference-algorithms.md', 'licenses.html'):
    if not (ROOT / path).is_file():
        raise SystemExit(f'Missing distribution notice: {path}')
print('Verified fft.js 4.0.4: upstream source, browser wrapper, complete MIT notice, and Partitura license.')
