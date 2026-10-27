import hashlib
import json
import pathlib
import shutil
import subprocess

repo = pathlib.Path(__file__).resolve().parents[2]
release = repo / 'review/2026-10-26/all-local'
source = release / 'source'
source.mkdir(parents=True, exist_ok=False)
paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=repo).decode().split('\0')
paths += subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=repo).decode().split('\0')
roots = {'libs', 'server', 'scripts', 'public', 'admin', 'test'}
files = {}
for name in sorted(set(paths)):
    if not name:
        continue
    path = pathlib.PurePosixPath(name)
    if path.parts[0] not in roots and name not in {'index.js', 'package.json', 'package-lock.json', 'healthcheck.sh', 'README.md', 'agents.md'}:
        continue
    origin = repo / name
    if not origin.is_file():
        continue
    target = source / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(origin, target)
    files[name] = hashlib.sha256(origin.read_bytes()).hexdigest()
(release / 'source-manifest.json').write_text(json.dumps(files, indent=2))
print(f'Staged {len(files)} files in {source}')
