"""Deploy the UX admin assets on Plex, retaining the previous proxy container."""

import hashlib
import http.client
import json
import os
import pathlib
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.request

RELEASE = pathlib.Path('/opt/live-tv-releases/20261104-ux')
IMAGE = 'bulock-iptv-proxy:ux-20261104'
CANDIDATE = 'iptv-proxy-ux-candidate-20261104'
ROLLBACK = 'iptv-proxy-rollback-ux-20261104'
LIVE = 'iptv-proxy'


class Docker(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=60)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')


def docker(method, path, body=None):
    connection = Docker()
    connection.request(method, '/v1.42' + path, None if body is None else json.dumps(body),
                       {'Content-Type': 'application/json'})
    response = connection.getresponse()
    data = response.read()
    connection.close()
    if response.status >= 300:
        raise RuntimeError(f'Docker {method} {path} returned {response.status}: {data[:500]!r}')
    return json.loads(data) if data else None


def inspect(name):
    return docker('GET', '/containers/' + name + '/json')


def create_from(original, name, binds, host_port, restart):
    config = original['Config'].copy()
    config['Image'] = IMAGE
    config['Hostname'] = ''
    config['HostConfig'] = original['HostConfig'].copy()
    config['HostConfig']['Binds'] = binds
    config['HostConfig']['PortBindings'] = {
        '34400/tcp': [{'HostIp': '127.0.0.1' if host_port != 34400 else '',
                       'HostPort': str(host_port)}]}
    config['HostConfig']['RestartPolicy'] = restart
    created = docker('POST', '/containers/create?name=' + name, config)
    docker('POST', '/containers/' + created['Id'] + '/start')


def wait_healthy(port, expected=None):
    last = None
    for _ in range(120):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3) as response:
                health = json.load(response)
            assert health.get('status') == 'ok', health
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/channels.json', timeout=5) as response:
                channels = json.load(response)['channels']
            assert channels, 'empty lineup'
            ids = {str(channel['id']) for channel in channels}
            if expected is not None:
                assert ids == expected, f'lineup differs: {len(ids)} channels, missing={sorted(expected - ids)}, extra={sorted(ids - expected)}'
            return ids
        except Exception as error:
            last = error
            time.sleep(1)
    raise RuntimeError(f'proxy on {port} did not become healthy: {last}')


def verify_source(name):
    manifest = json.loads((RELEASE / 'manifest.json').read_text())
    for relative, expected in manifest.items():
        actual = subprocess.check_output(
            ['docker', 'exec', name, 'sha256sum', '/usr/src/app/' + relative], text=True
        ).split()[0]
        assert actual == expected, relative
    port = 34409 if name == CANDIDATE else 34400
    for asset in ('index.html', 'assets/index.js', 'assets/index.css'):
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/admin/{asset}', timeout=10) as response:
            actual = hashlib.sha256(response.read()).hexdigest()
        assert actual == manifest['public/admin/' + asset], asset


def backup_database():
    source = '/opt/iptv-proxy/data/iptv-proxy.sqlite'
    destination = RELEASE / 'before.sqlite'
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as db:
        with sqlite3.connect(destination) as target:
            db.backup(target)
            assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'


def main():
    os.umask(0o077)
    original = inspect(LIVE)
    assert original['State']['Running']
    assert original['Image'] == 'sha256:d05f4f1a6cce8ac34642416f9024ffec275bc556e24a2c78cd99a3a8416501c9'
    assert original['HostConfig']['Binds'] == [
        '/opt/iptv-proxy/data:/data', '/opt/iptv-proxy/config:/config'
    ]
    assert original['HostConfig']['PortBindings']['34400/tcp'][0]['HostPort'] == '34400'
    assert docker('GET', '/images/' + IMAGE + '/json')['Id']
    assert original['HostConfig']['NetworkMode'] == 'bridge'
    baseline = wait_healthy(34400)
    (RELEASE / 'before-container.json').write_text(json.dumps(original))
    backup_database()

    candidate_config = RELEASE / f'candidate-config-{int(time.time())}'
    candidate_data = RELEASE / f'candidate-data-{int(time.time())}'
    shutil.copytree('/opt/iptv-proxy/config', candidate_config)
    candidate_data.mkdir()
    shutil.copy2(RELEASE / 'before.sqlite', candidate_data / 'iptv-proxy.sqlite')
    create_from(original, CANDIDATE,
                [str(candidate_data) + ':/data', str(candidate_config) + ':/config'],
                34409, {'Name': 'no'})
    try:
        assert wait_healthy(34409, baseline) == baseline
        verify_source(CANDIDATE)
        print(f'Candidate healthy with {len(baseline)} unchanged channels', flush=True)
    except Exception:
        print('Candidate verification failed; production was not changed.', flush=True)
        raise
    finally:
        docker('POST', '/containers/' + CANDIDATE + '/stop?t=10')
        docker('DELETE', '/containers/' + CANDIDATE)

    assert inspect(LIVE)['Id'] == original['Id']
    docker('POST', '/containers/' + LIVE + '/stop?t=20')
    docker('POST', '/containers/' + LIVE + '/rename?name=' + ROLLBACK)
    try:
        create_from(original, LIVE, original['HostConfig']['Binds'], 34400,
                    original['HostConfig']['RestartPolicy'])
        assert wait_healthy(34400, baseline) == baseline
        verify_source(LIVE)
        assert inspect(LIVE)['Image'] == docker('GET', '/images/' + IMAGE + '/json')['Id']
        print(f'Live proxy healthy with {len(baseline)} unchanged channels; rollback retained', flush=True)
    except Exception:
        try:
            current = inspect(LIVE)
            if current['State']['Running']:
                docker('POST', '/containers/' + LIVE + '/stop?t=10')
            docker('DELETE', '/containers/' + LIVE)
        except Exception:
            pass
        docker('POST', '/containers/' + ROLLBACK + '/rename?name=' + LIVE)
        docker('POST', '/containers/' + LIVE + '/start')
        wait_healthy(34400)
        raise


if __name__ == '__main__':
    main()
