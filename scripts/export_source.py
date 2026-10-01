#!/usr/bin/env python3
"""Export committed source without local files or Git history; never publishes anything."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
# Refuse to omit uncommitted source or notice changes accidentally. Ignore local IDE
# settings and generated exports; only git-tracked content enters the archive.
changes = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT, text=True)
if changes.strip():
    raise SystemExit('Commit tracked source changes before exporting the publication snapshot.')
untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=ROOT, text=True).splitlines()
source_files = [path for path in untracked if not path.startswith('.vscode/')]
if source_files:
    raise SystemExit('Track the intended source files before exporting: ' + ', '.join(source_files))
subprocess.run(['python3', 'scripts/verify_vendor.py'], cwd=ROOT, check=True)
output = ROOT / 'exports' / 'kerfbend-source.zip'
output.parent.mkdir(exist_ok=True)
subprocess.run(['git', 'archive', '--format=zip', '--prefix=Kerfbend/', '-o', str(output), 'HEAD'], cwd=ROOT, check=True)
print(output)
