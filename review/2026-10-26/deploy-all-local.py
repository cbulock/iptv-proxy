import hashlib
import http.client
import json
import pathlib
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request

root = pathlib.Path('/opt/live-tv-releases/20261026-all-local')
image = 'bulock-iptv-proxy:all-local-20261026'
base_image = 'bulock-iptv-proxy:mcp-providers-20261025'
candidate_name = 'iptv-proxy-all-local-candidate-20261026'
rollback_name = 'iptv-proxy-rollback-all-local-20261026'
candidate_port = 34407


class Docker(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=60)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')


def request(method, path, body=None):
    client = Docker()
    client.request(method, '/v1.42' + path, None if body is None else json.dumps(body),
                   {'Content-Type': 'application/json'})
    response = client.getresponse()
    data = response.read()
    client.close()
    if response.status >= 300:
        raise RuntimeError(f'{response.status}: {data.decode()}')
    return json.loads(data) if data else None


def read_json(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.load(response)


def backup(destination):
    with sqlite3.connect('file:/opt/iptv-proxy/data/iptv-proxy.sqlite?mode=ro', uri=True) as source:
        with sqlite3.connect(destination) as target:
            source.backup(target)
            assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'


def verify(port):
    base = f'http://127.0.0.1:{port}'
    last_error = None
    for _ in range(25):
        try:
            assert read_json(base + '/health')['status'] == 'ok'
            channels = read_json(base + '/channels.json')['channels']
            expected = json.loads((root / 'before-channels.json').read_text())
            assert {c['id'] for c in channels} == {c['id'] for c in expected}, 'published channel membership changed'
            with urllib.request.urlopen(base + '/admin/assets/index.js', timeout=10) as response:
                bundle = response.read()
            expected_bundle = (root / 'source/public/admin/assets/index.js').read_bytes()
            assert hashlib.sha256(bundle).digest() == hashlib.sha256(expected_bundle).digest(), 'admin bundle mismatch'
            assert b'Close channel settings' in bundle, 'editor close control missing'
            assert b'Current channel matches appear first' in bundle, 'source menus missing'
            with urllib.request.urlopen(base + '/admin/', timeout=5) as response:
                html = response.read()
            assert b'/admin/assets/index.js' in html and b'/admin/assets/index.css' in html
            cursor = None
            total = 0
            ocho_count = 0
            ocho = next((c for c in channels if c['name'] == 'ESPN: The Ocho'), None)
            for _page in range(20):
                suffix = '&cursor=' + urllib.parse.quote(cursor, safe='') if cursor else ''
                page = read_json(base + '/guide.json?hours=48' + suffix)
                total += len(page['programmes'])
                ocho_count += sum(p['channelId'] == ocho['id'] for p in page['programmes']) if ocho else 0
                cursor = page['nextCursor']
                if not cursor:
                    break
            assert not cursor and total > 0, 'guide unavailable or pagination incomplete'
            if ocho:
                assert ocho_count > 0, 'The Ocho schedule missing'
            print(f'port {port}: healthy, {len(channels)} channels, {total} programmes, {ocho_count} The Ocho programmes; admin hash verified', flush=True)
            return
        except Exception as error:
            last_error = error
            time.sleep(2)
    raise RuntimeError(f'port {port} did not become ready: {last_error}')


def config_from(original, candidate=False):
    config = original['Config'].copy()
    config['Image'] = image
    config['Labels'] = request('GET', '/images/' + image + '/json')['Config'].get('Labels', {})
    config['Hostname'] = ''
    config['HostConfig'] = original['HostConfig'].copy()
    if candidate:
        config['HostConfig']['Binds'] = [str(root / 'candidate-config') + ':/config', str(root / 'candidate-data') + ':/data']
        config['HostConfig']['PortBindings'] = {'34400/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(candidate_port)}]}
        config['HostConfig']['RestartPolicy'] = {'Name': 'no'}
    return config


def verify_sources(container):
    manifest = json.loads((root / 'source-manifest.json').read_text())
    checked = 0
    for name, expected in manifest.items():
        if name == 'index.js' or name.startswith(('libs/', 'server/', 'scripts/')):
            result = subprocess.check_output(['docker', 'exec', container, 'sha256sum', '/usr/src/app/' + name], text=True)
            assert result.split()[0] == expected, f'source mismatch: {name}'
            checked += 1
    print(f'{container}: {checked} runtime source hashes verified', flush=True)


mode = sys.argv[1]
if mode == 'candidate':
    original = request('GET', '/containers/iptv-proxy/json')
    assert original['State']['Running']
    assert original['Config']['Image'] == base_image, 'unexpected production base image'
    (root / 'original.json').write_text(json.dumps(original))
    (root / 'before-channels.json').write_text(json.dumps(read_json('http://127.0.0.1:34400/channels.json')['channels']))
    shutil.copytree('/opt/iptv-proxy/config', root / 'candidate-config')
    (root / 'candidate-data').mkdir()
    backup(root / 'candidate-data/iptv-proxy.sqlite')
    created = request('POST', '/containers/create?name=' + candidate_name, config_from(original, True))
    request('POST', '/containers/' + created['Id'] + '/start')
    verify(candidate_port)
    verify_sources(candidate_name)
    seed = """import { initDatabase } from './libs/database.js'; import Store from './libs/sqlite-session-store.js';
initDatabase(); const store = new Store(); store.set('release-persistence-check', {authenticated:false,cookie:{expires:new Date(Date.now()+600000)}}, error => {if(error) throw error; console.log('Candidate session saved');});"""
    subprocess.run(['docker', 'exec', '-w', '/usr/src/app', candidate_name, 'node', '--input-type=module', '-e', seed], check=True)
    request('POST', '/containers/' + candidate_name + '/restart?t=10')
    verify(candidate_port)
    check = """import { initDatabase } from './libs/database.js'; import Store from './libs/sqlite-session-store.js';
initDatabase(); const store = new Store(); store.get('release-persistence-check', (error,value) => {if(error) throw error; if(value?.authenticated !== false) throw new Error('Session lost after restart'); store.destroy('release-persistence-check', error => {if(error) throw error; console.log('Candidate session survived restart and was cleaned up');});});"""
    subprocess.run(['docker', 'exec', '-w', '/usr/src/app', candidate_name, 'node', '--input-type=module', '-e', check], check=True)
elif mode == 'promote':
    original = json.loads((root / 'original.json').read_text())
    current = request('GET', '/containers/iptv-proxy/json')
    assert current['Id'] == original['Id'], 'production changed since candidate creation'
    verify(candidate_port)
    backup(root / 'before-promotion.sqlite')
    request('POST', '/containers/iptv-proxy/stop?t=20')
    request('POST', '/containers/iptv-proxy/rename?name=' + rollback_name)
    try:
        created = request('POST', '/containers/create?name=iptv-proxy', config_from(original))
        request('POST', '/containers/' + created['Id'] + '/start')
        verify(34400)
        verify_sources('iptv-proxy')
        with sqlite3.connect('file:/opt/iptv-proxy/data/iptv-proxy.sqlite?mode=ro', uri=True) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert db.execute("SELECT COUNT(*) FROM schema_migrations WHERE id = '006-admin-sessions'").fetchone()[0] == 1
        request('POST', '/containers/' + candidate_name + '/stop?t=10')
        print('Promotion complete; database integrity and session migration verified; previous container retained', flush=True)
    except Exception:
        try:
            request('POST', '/containers/iptv-proxy/stop?t=10')
            request('POST', '/containers/iptv-proxy/rename?name=iptv-proxy-failed-all-local-20261026')
        except Exception:
            pass
        request('POST', '/containers/' + rollback_name + '/rename?name=iptv-proxy')
        request('POST', '/containers/iptv-proxy/start')
        print('Restored previous container', flush=True)
        raise
elif mode == 'verify':
    verify(34400)
    verify_sources('iptv-proxy')
else:
    raise ValueError(mode)
