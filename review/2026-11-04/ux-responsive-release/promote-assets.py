"""Promote verified static assets without restarting the running backend."""
import hashlib
import json
import pathlib
import subprocess
import urllib.request

RELEASE = pathlib.Path('/opt/live-tv-releases/20261104-ux-responsive')
LIVE = 'iptv-proxy'
STAGED = '/usr/src/app/public/admin-ux-responsive-staged-20261104'
ACTIVE = '/usr/src/app/public/admin'
PREVIOUS = '/usr/src/app/public/admin-before-ux-responsive-20261104'


def lineup():
    with urllib.request.urlopen('http://127.0.0.1:34400/channels.json', timeout=10) as response:
        return {row['id'] for row in json.load(response)['channels']}


def verify(directory):
    for relative, expected in manifest.items():
        suffix = relative.removeprefix('public/admin/')
        actual = subprocess.check_output(
            ['docker', 'exec', LIVE, 'sha256sum', directory + '/' + suffix], text=True
        ).split()[0]
        assert actual == expected, relative


manifest = json.loads((RELEASE / 'manifest.json').read_text())
original = json.loads(subprocess.check_output(['docker', 'inspect', LIVE]))[0]
assert original['State']['Running']
assert original['State']['Health']['Status'] == 'healthy'
assert original['Image'] == 'sha256:d05f4f1a6cce8ac34642416f9024ffec275bc556e24a2c78cd99a3a8416501c9'
before = lineup()
assert before
staged_exists = subprocess.run(['docker', 'exec', LIVE, 'test', '-d', STAGED]).returncode == 0
subprocess.run(['docker', 'exec', LIVE, 'test', '!', '-e', PREVIOUS], check=True)
if not staged_exists:
    subprocess.run(['docker', 'cp', str(RELEASE / 'public/admin'), LIVE + ':' + STAGED], check=True)
verify(STAGED)
promote = r"""
const fs = require('node:fs');
const path = require('node:path');
const [active, staged, previous, manifestJson] = process.argv.slice(1);
const files = JSON.parse(manifestJson).map(p => p.replace(/^public\/admin\//, '')).sort((a,b) => (a === 'index.html') - (b === 'index.html'));
fs.cpSync(active, previous, {recursive:true, errorOnExist:true, force:false});
try {
  for (const file of files) {
    const target = path.join(active, file);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.copyFileSync(path.join(staged, file), target + '.ux-tmp');
    fs.renameSync(target + '.ux-tmp', target);
  }
} catch (error) { fs.cpSync(previous, active, {recursive:true}); throw error; }
"""
subprocess.run(['docker', 'exec', LIVE, 'node', '-e', promote, ACTIVE, STAGED, PREVIOUS, json.dumps(list(manifest))], check=True)

try:
    verify(ACTIVE)
    assert lineup() == before, 'lineup identities changed during asset promotion'
    current = json.loads(subprocess.check_output(['docker', 'inspect', LIVE]))[0]
    assert current['Id'] == original['Id']
    assert current['State']['StartedAt'] == original['State']['StartedAt']
    for asset in ('index.html', 'assets/index.js', 'assets/index.css'):
        with urllib.request.urlopen('http://127.0.0.1:34400/admin/' + asset, timeout=10) as response:
            actual = hashlib.sha256(response.read()).hexdigest()
        assert actual == manifest['public/admin/' + asset], asset
except Exception:
    subprocess.run(['docker', 'exec', LIVE, 'node', '-e', "require('node:fs').cpSync(process.argv[1],process.argv[2],{recursive:true})", PREVIOUS, ACTIVE], check=True)
    raise
print(f'Admin assets promoted; backend not restarted; {len(before)} exact channel IDs preserved.', flush=True)
print('Previous admin assets retained at ' + PREVIOUS, flush=True)
