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

root = pathlib.Path('/opt/live-tv-releases/20261025-channels')
image = 'bulock-iptv-proxy:channels-20261025'
base_image = 'bulock-iptv-proxy:web-guide-fallback-20261025'
candidate_name = 'iptv-proxy-channels-candidate'
rollback_name = 'iptv-proxy-rollback-channels-20261025'


class Docker(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=60)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')


def request(method, path, body=None):
    client = Docker()
    client.request(method, '/v1.42' + path,
                   None if body is None else json.dumps(body),
                   {'Content-Type': 'application/json'})
    response = client.getresponse()
    data = response.read()
    client.close()
    if response.status >= 300:
        raise RuntimeError(f'{response.status}: {data.decode()}')
    return json.loads(data) if data else None


def verify(port):
    base = f'http://127.0.0.1:{port}'
    last_error = None
    for _ in range(35):
        try:
            with urllib.request.urlopen(base + '/health', timeout=3) as response:
                assert response.status == 200
            with urllib.request.urlopen(base + '/channels.json', timeout=5) as response:
                channels = json.load(response)['channels']
            expected = json.loads((root / 'before-channels.json').read_text())
            assert {c['id'] for c in channels} == {c['id'] for c in expected}, 'published channel membership changed'
            with urllib.request.urlopen(base + '/admin/assets/index.js', timeout=5) as response:
                bundle = response.read()
            expected_hash = hashlib.sha256((root / 'source/public/admin/assets/index.js').read_bytes()).hexdigest()
            assert hashlib.sha256(bundle).hexdigest() == expected_hash, 'admin bundle differs from release'
            assert b'Choose which channels appear in your player.' in bundle, 'Channels redesign missing'
            with urllib.request.urlopen(base + '/admin/', timeout=5) as response:
                assert response.status == 200
            ocho = next(c for c in channels if c['name'] == 'ESPN: The Ocho')
            cursor = None
            total = 0
            ocho_count = 0
            for _page in range(10):
                suffix = '&cursor=' + urllib.parse.quote(cursor, safe='') if cursor else ''
                with urllib.request.urlopen(base + '/guide.json?hours=48' + suffix, timeout=8) as response:
                    page = json.load(response)
                total += len(page['programmes'])
                ocho_count += sum(p['channelId'] == ocho['id'] for p in page['programmes'])
                cursor = page['nextCursor']
                if not cursor:
                    break
            assert not cursor, 'guide pagination did not finish'
            assert ocho_count > 0, 'The Ocho has no published web-guide programmes'
            print(f'port {port}: healthy, {len(channels)} channels, {total} programmes, '
                  f'{ocho_count} The Ocho programmes', flush=True)
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
        config['HostConfig']['Binds'] = [
            str(root / 'candidate-config') + ':/config',
            str(root / 'candidate-data') + ':/data',
        ]
        config['HostConfig']['PortBindings'] = {
            '34400/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '34405'}]
        }
        config['HostConfig']['RestartPolicy'] = {'Name': 'no'}
    return config


mode = sys.argv[1]
if mode == 'candidate':
    original = request('GET', '/containers/iptv-proxy/json')
    assert original['State']['Running']
    base_id = subprocess.check_output(
        ['docker', 'image', 'inspect', base_image, '--format', '{{.Id}}'], text=True).strip()
    assert original['Image'] == base_id, 'base image differs from live image'
    (root / 'original.json').write_text(json.dumps(original))
    with urllib.request.urlopen('http://127.0.0.1:34400/channels.json', timeout=5) as response:
        (root / 'before-channels.json').write_text(json.dumps(json.load(response)['channels']))
    shutil.copytree('/opt/iptv-proxy/config', root / 'candidate-config')
    (root / 'candidate-data').mkdir()
    with sqlite3.connect('file:/opt/iptv-proxy/data/iptv-proxy.sqlite?mode=ro', uri=True) as source:
        with sqlite3.connect(root / 'candidate-data/iptv-proxy.sqlite') as target:
            source.backup(target)
            assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    created = request('POST', '/containers/create?name=' + candidate_name,
                      config_from(original, True))
    request('POST', '/containers/' + created['Id'] + '/start')
    print(f'candidate started: {created["Id"][:12]}', flush=True)
    verify(34405)
elif mode == 'promote':
    original = json.loads((root / 'original.json').read_text())
    current = request('GET', '/containers/iptv-proxy/json')
    assert current['Id'] == original['Id'], 'live container changed after candidate preparation'
    verify(34405)
    with sqlite3.connect('file:/opt/iptv-proxy/data/iptv-proxy.sqlite?mode=ro', uri=True) as source:
        with sqlite3.connect(root / 'before-promotion.sqlite') as target:
            source.backup(target)
            assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    request('POST', '/containers/iptv-proxy/stop?t=20')
    request('POST', '/containers/iptv-proxy/rename?name=' + rollback_name)
    try:
        created = request('POST', '/containers/create?name=iptv-proxy', config_from(original))
        request('POST', '/containers/' + created['Id'] + '/start')
        print(f'new live container started: {created["Id"][:12]}', flush=True)
        verify(34400)
        request('POST', '/containers/' + candidate_name + '/stop?t=10')
    except Exception:
        try:
            request('POST', '/containers/iptv-proxy/stop?t=10')
        except Exception:
            pass
        try:
            request('POST', '/containers/iptv-proxy/rename?name=iptv-proxy-failed-channels-20261025')
        except Exception:
            pass
        request('POST', '/containers/' + rollback_name + '/rename?name=iptv-proxy')
        request('POST', '/containers/iptv-proxy/start')
        print('rolled back to original container', flush=True)
        raise
else:
    raise ValueError(mode)
