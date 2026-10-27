"""Production usage-identity release. Run as root on plex: setup, candidate, promote, verify."""
import hashlib
import http.client
import json
import os
import pathlib
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

proxy_release = pathlib.Path('/opt/live-tv-releases/20261026-usage-identity')
portal_release = pathlib.Path('/opt/media-user-center-releases/usage-identity-20261026')
live_portal = pathlib.Path('/opt/media-user-center')
secret_file = portal_release / 'identity-secret'
proxy_image = 'bulock-iptv-proxy:usage-identity-20261026'
portal_image = 'media-user-center-portal:usage-identity-20261026'
gateway_image = 'media-user-center-iptv-gateway:usage-identity-20261026'
proxy_candidate = 'iptv-proxy-usage-identity-candidate-20261026'
portal_candidate = 'media-user-center-portal-identity-candidate-20261026'
gateway_candidate = 'media-user-center-gateway-identity-candidate-20261026'
proxy_rollback = 'iptv-proxy-rollback-usage-identity-20261026'
changed_portal_files = [
    '.env.example', 'README.md', 'integrations/iptv/gateway.mjs',
    'server/core/iptv.ts', 'tests/gateway-live-tv.test.ts', 'tests/services.test.ts',
]


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
        raise RuntimeError(f'Docker {method} {path} returned {response.status}')
    return json.loads(data) if data else None


def sh(*args, output=None):
    if output:
        with open(output, 'a') as log:
            subprocess.run(args, check=True, stdout=log, stderr=subprocess.STDOUT)
    else:
        subprocess.run(args, check=True)


def read_secret():
    value = secret_file.read_text().strip()
    assert len(value) == 64 and all(char in '0123456789abcdef' for char in value)
    return value


def with_secret(env, secret):
    return [item for item in env if not item.startswith('IPTV_USAGE_IDENTITY_SECRET=')] + [
        'IPTV_USAGE_IDENTITY_SECRET=' + secret]


def inspect(name):
    return docker('GET', '/containers/' + name + '/json')


def fetch_json(port, path):
    host = '10.0.0.110' if port in (3300, 3400) else '127.0.0.1'
    with urllib.request.urlopen(f'http://{host}:{port}{path}', timeout=10) as response:
        return json.load(response)


def backup_db(source, destination):
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as db:
        with sqlite3.connect(destination) as target:
            db.backup(target)
            assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'


def wait_http(port, path, expected='ok'):
    last = None
    for _ in range(30):
        try:
            result = fetch_json(port, path)
            assert result.get('status', result.get('ok')) == expected or (
                expected == 'ok' and result.get('ok') is True), result
            return result
        except Exception as error:
            last = error
            time.sleep(2)
    raise RuntimeError(f'port {port} {path} did not become ready: {last}')


def verify_proxy(name, port):
    assert inspect(name)['Image'] == docker('GET', '/images/' + proxy_image + '/json')['Id']
    wait_http(port, '/health')
    channels = fetch_json(port, '/channels.json')['channels']
    expected = json.loads((proxy_release / 'before-channels.json').read_text())
    assert {c['id'] for c in channels} == {c['id'] for c in expected}
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/admin/assets/index.js', timeout=10) as response:
        bundle = response.read()
    assert hashlib.sha256(bundle).digest() == hashlib.sha256(
        (proxy_release / 'source/public/admin/assets/index.js').read_bytes()).digest()
    for relative in ['index.js', 'server/usage.js', 'server/lineup.js', 'server/transcode.js', 'server/mcp.js']:
        expected_hash = hashlib.sha256((proxy_release / 'source' / relative).read_bytes()).hexdigest()
        result = subprocess.check_output(['docker', 'exec', name, 'sha256sum', '/usr/src/app/' + relative], text=True)
        assert result.split()[0] == expected_hash, relative
    probe = """import {readUsageIdentity} from './server/usage.js';
const valid=readUsageIdentity({headers:{'x-iptv-identity-secret':process.env.IPTV_USAGE_IDENTITY_SECRET,'x-iptv-user-id':'release-check','x-iptv-user-name':'Friendly%20Account'}});
const bad=readUsageIdentity({headers:{'x-iptv-identity-secret':'wrong','x-iptv-user-id':'release-check'}});
if(valid?.userName!=='Friendly Account'||bad!==null)process.exit(1);console.log('identity accepted only with configured secret');"""
    sh('docker', 'exec', '-w', '/usr/src/app', name, 'node', '--input-type=module', '-e', probe)
    assert ('IPTV_USAGE_IDENTITY_SECRET=' + read_secret()) in inspect(name)['Config']['Env']
    print(f'{name}: healthy, {len(channels)} channels, admin and identity verified', flush=True)


def verify_portal(name, port):
    assert inspect(name)['Image'] == docker('GET', '/images/' + portal_image + '/json')['Id']
    wait_http(port, '/api/health')
    assert ('IPTV_USAGE_IDENTITY_SECRET=' + read_secret()) in inspect(name)['Config']['Env']
    print(f'{name}: healthy and configured', flush=True)


def verify_gateway(name, port):
    assert inspect(name)['Image'] == docker('GET', '/images/' + gateway_image + '/json')['Id']
    wait_http(port, '/health')
    expected_hash = hashlib.sha256((portal_release / 'source/integrations/iptv/gateway.mjs').read_bytes()).hexdigest()
    actual = subprocess.check_output(['docker', 'exec', name, 'sha256sum', '/app/gateway.mjs'], text=True).split()[0]
    assert actual == expected_hash
    assert ('IPTV_USAGE_IDENTITY_SECRET=' + read_secret()) in inspect(name)['Config']['Env']
    print(f'{name}: healthy, source and secret verified', flush=True)


def candidate_config(original, image, name, port, container_port, binds):
    config = original['Config'].copy()
    config['Image'] = image
    config['Hostname'] = ''
    config['Labels'] = {}
    config['Env'] = with_secret(config['Env'], read_secret())
    config['HostConfig'] = original['HostConfig'].copy()
    config['HostConfig']['Binds'] = binds
    config['HostConfig']['PortBindings'] = {f'{container_port}/tcp': [
        {'HostIp': '127.0.0.1', 'HostPort': str(port)}]}
    config['HostConfig']['RestartPolicy'] = {'Name': 'no'}
    created = docker('POST', '/containers/create?name=' + name, config)
    docker('POST', '/containers/' + created['Id'] + '/start')


def setup():
    os.umask(0o077)
    for path in [proxy_release, portal_release]:
        assert path.is_dir()
        os.chmod(path, 0o700)
    for image in [proxy_image, portal_image, gateway_image]:
        docker('GET', '/images/' + image + '/json')
    originals = {
        'proxy': inspect('iptv-proxy'),
        'portal': inspect('media-user-center-portal-1'),
        'gateway': inspect('media-user-center-iptv-gateway-1'),
    }
    assert originals['proxy']['Config']['Image'] == 'bulock-iptv-proxy:all-local-20261026'
    assert all(item['State']['Running'] for item in originals.values())
    (portal_release / 'original.json').write_text(json.dumps(originals))
    os.chmod(portal_release / 'original.json', 0o600)
    environment = (live_portal / '.env').read_text()
    existing = [line.split('=', 1)[1].strip().strip('"\'') for line in environment.splitlines()
                if line.startswith('IPTV_USAGE_IDENTITY_SECRET=')]
    if not secret_file.exists():
        secret_file.write_text(existing[0] if existing else secrets.token_hex(32))
    os.chmod(secret_file, 0o600)
    read_secret()
    shutil.copy2(live_portal / '.env', portal_release / 'before.env')
    os.chmod(portal_release / 'before.env', 0o600)
    source_backup = portal_release / 'before-source'
    for relative in changed_portal_files:
        destination = source_backup / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(live_portal / relative, destination)
    backup_db('/opt/iptv-proxy/data/iptv-proxy.sqlite', proxy_release / 'before.sqlite')
    backup_db(live_portal / 'data/portal.sqlite', portal_release / 'before.sqlite')
    (proxy_release / 'before-channels.json').write_text(json.dumps(fetch_json(34400, '/channels.json')['channels']))
    print('Root-only environment, source and consistent database backups saved; secret prepared', flush=True)


def candidate():
    originals = json.loads((portal_release / 'original.json').read_text())
    assert inspect('iptv-proxy')['Id'] == originals['proxy']['Id']
    shutil.copytree('/opt/iptv-proxy/config', proxy_release / 'candidate-config')
    (proxy_release / 'candidate-data').mkdir()
    backup_db('/opt/iptv-proxy/data/iptv-proxy.sqlite', proxy_release / 'candidate-data/iptv-proxy.sqlite')
    candidate_config(originals['proxy'], proxy_image, proxy_candidate, 34408, 34400, [
        str(proxy_release / 'candidate-config') + ':/config',
        str(proxy_release / 'candidate-data') + ':/data'])
    verify_proxy(proxy_candidate, 34408)
    (portal_release / 'candidate-data').mkdir()
    backup_db(live_portal / 'data/portal.sqlite', portal_release / 'candidate-data/portal.sqlite')
    candidate_config(originals['portal'], portal_image, portal_candidate, 13300, 3000, [
        str(portal_release / 'candidate-data') + ':/data'])
    verify_portal(portal_candidate, 13300)
    candidate_config(originals['gateway'], gateway_image, gateway_candidate, 13400, 3400, [])
    verify_gateway(gateway_candidate, 13400)
    print('All three isolated candidates passed', flush=True)


def candidate_remaining():
    originals = json.loads((portal_release / 'original.json').read_text())
    verify_proxy(proxy_candidate, 34408)
    verify_portal(portal_candidate, 13300)
    candidate_config(originals['gateway'], gateway_image, gateway_candidate, 13400, 3400, [])
    verify_gateway(gateway_candidate, 13400)
    print('All three isolated candidates passed', flush=True)


def compose_up(service):
    with open(portal_release / 'promotion.log', 'a') as log:
        subprocess.run(['docker', 'compose', '-f', 'compose.production.yaml', 'up', '-d',
                        '--no-deps', '--no-build', '--force-recreate', service],
                       cwd=live_portal, check=True, stdout=log, stderr=subprocess.STDOUT)


def rollback_proxy():
    original = json.loads((portal_release / 'original.json').read_text())['proxy']
    current = inspect('iptv-proxy')
    assert current['Config']['Image'] == proxy_image
    assert inspect(proxy_rollback)['Id'] == original['Id']
    docker('POST', '/containers/iptv-proxy/stop?t=20')
    docker('POST', '/containers/iptv-proxy/rename?name=iptv-proxy-failed-usage-identity-20261026')
    docker('POST', '/containers/' + proxy_rollback + '/rename?name=iptv-proxy')
    docker('POST', '/containers/iptv-proxy/start')
    wait_http(34400, '/health')
    print('Original proxy container restored', flush=True)


def preflight():
    originals = json.loads((portal_release / 'original.json').read_text())
    for key, name in [('proxy', 'iptv-proxy'), ('portal', 'media-user-center-portal-1'),
                      ('gateway', 'media-user-center-iptv-gateway-1')]:
        assert inspect(name)['Id'] == originals[key]['Id'], name
    assert (live_portal / '.env').read_bytes() == (portal_release / 'before.env').read_bytes()
    for relative in changed_portal_files:
        assert (live_portal / relative).read_bytes() == (portal_release / 'before-source' / relative).read_bytes(), relative
    subprocess.run(['docker', 'compose', '-f', 'compose.production.yaml', 'config', '--quiet'],
                   cwd=live_portal, check=True, stdout=subprocess.DEVNULL)
    print('Production rollback state and Compose configuration verified', flush=True)


def refresh_originals():
    originals = json.loads((portal_release / 'original.json').read_text())
    for key, name in [('proxy', 'iptv-proxy'), ('portal', 'media-user-center-portal-1'),
                      ('gateway', 'media-user-center-iptv-gateway-1')]:
        current = inspect(name)
        assert current['Image'] == originals[key]['Image'], name
        assert current['State']['Running'], name
        originals[key] = current
    (portal_release / 'original.json').write_text(json.dumps(originals))
    os.chmod(portal_release / 'original.json', 0o600)
    print('Prior application image IDs confirmed; original container metadata refreshed', flush=True)


def append_secret():
    target = live_portal / '.env'
    current = target.read_text()
    lines = [line for line in current.splitlines() if not line.startswith('IPTV_USAGE_IDENTITY_SECRET=')]
    temporary = live_portal / '.env.usage-identity-new'
    temporary.write_text('\n'.join(lines) + '\nIPTV_USAGE_IDENTITY_SECRET=' + read_secret() + '\n')
    os.chmod(temporary, 0o600)
    os.replace(temporary, target)


def restore_portal():
    shutil.copy2(portal_release / 'before.env', live_portal / '.env')
    for relative in changed_portal_files:
        shutil.copy2(portal_release / 'before-source' / relative, live_portal / relative)
    sh('docker', 'tag', 'media-user-center-portal:before-usage-identity-20261026', 'media-user-center-portal:latest')
    sh('docker', 'tag', 'media-user-center-iptv-gateway:before-usage-identity-20261026', 'media-user-center-iptv-gateway:latest')
    compose_up('portal')
    compose_up('iptv-gateway')


def promote():
    originals = json.loads((portal_release / 'original.json').read_text())
    for key, name in [('proxy', 'iptv-proxy'), ('portal', 'media-user-center-portal-1'),
                      ('gateway', 'media-user-center-iptv-gateway-1')]:
        assert inspect(name)['Id'] == originals[key]['Id'], f'{name} changed after candidate testing'
    verify_proxy(proxy_candidate, 34408)
    verify_portal(portal_candidate, 13300)
    verify_gateway(gateway_candidate, 13400)
    backup_db('/opt/iptv-proxy/data/iptv-proxy.sqlite', proxy_release / 'before-promotion.sqlite')
    backup_db(live_portal / 'data/portal.sqlite', portal_release / 'before-promotion.sqlite')
    sh('docker', 'tag', originals['portal']['Image'], 'media-user-center-portal:before-usage-identity-20261026')
    sh('docker', 'tag', originals['gateway']['Image'], 'media-user-center-iptv-gateway:before-usage-identity-20261026')
    proxy_started = False
    portal_changed = False
    try:
        docker('POST', '/containers/iptv-proxy/stop?t=20')
        docker('POST', '/containers/iptv-proxy/rename?name=' + proxy_rollback)
        proxy_started = True
        config = originals['proxy']['Config'].copy()
        config['Image'] = proxy_image
        config['Hostname'] = ''
        config['Env'] = with_secret(config['Env'], read_secret())
        config['HostConfig'] = originals['proxy']['HostConfig'].copy()
        created = docker('POST', '/containers/create?name=iptv-proxy', config)
        docker('POST', '/containers/' + created['Id'] + '/start')
        verify_proxy('iptv-proxy', 34400)
        portal_changed = True
        for relative in changed_portal_files:
            destination = live_portal / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(portal_release / 'source' / relative, destination)
        append_secret()
        sh('docker', 'tag', portal_image, 'media-user-center-portal:latest')
        sh('docker', 'tag', gateway_image, 'media-user-center-iptv-gateway:latest')
        compose_up('portal')
        verify_portal('media-user-center-portal-1', 3300)
        compose_up('iptv-gateway')
        verify_gateway('media-user-center-iptv-gateway-1', 3400)
        verify_proxy('iptv-proxy', 34400)
        with sqlite3.connect('file:/opt/iptv-proxy/data/iptv-proxy.sqlite?mode=ro', uri=True) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        with sqlite3.connect(f'file:{live_portal / "data/portal.sqlite"}?mode=ro', uri=True) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        print('Production promotion complete; both databases valid; prior images and container retained', flush=True)
    except Exception:
        print('Promotion failed; restoring prior applications', flush=True)
        if portal_changed:
            restore_portal()
        if proxy_started:
            try:
                docker('POST', '/containers/iptv-proxy/stop?t=10')
                docker('POST', '/containers/iptv-proxy/rename?name=iptv-proxy-failed-usage-identity-20261026')
            except Exception:
                pass
            docker('POST', '/containers/' + proxy_rollback + '/rename?name=iptv-proxy')
            docker('POST', '/containers/iptv-proxy/start')
        raise


def verify():
    verify_proxy('iptv-proxy', 34400)
    verify_portal('media-user-center-portal-1', 3300)
    verify_gateway('media-user-center-iptv-gateway-1', 3400)
    for relative in changed_portal_files:
        assert (live_portal / relative).read_bytes() == (portal_release / 'source' / relative).read_bytes()
    assert oct(secret_file.stat().st_mode & 0o777) == '0o600'
    assert oct((live_portal / '.env').stat().st_mode & 0o777) == '0o600'
    for name in [proxy_candidate, portal_candidate, gateway_candidate]:
        if inspect(name)['State']['Running']:
            docker('POST', '/containers/' + name + '/stop?t=10')
    print('All production services verified; candidates stopped', flush=True)


def public_verify():
    for label, url, expected in [
        ('portal', 'https://media.bulock.house/api/health', 200),
        ('gateway', 'https://iptv.bulock.house/health', 200),
        ('unauthenticated playlist', 'https://iptv.bulock.house/media/lineup.m3u', 403),
    ]:
        try:
            with urllib.request.urlopen(url, timeout=12) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
        assert status == expected, f'{label}: {status}, expected {expected}'
        print(f'{label}: HTTP {status}', flush=True)


{'setup': setup, 'candidate': candidate, 'candidate-remaining': candidate_remaining,
 'rollback-proxy': rollback_proxy, 'preflight': preflight, 'refresh-originals': refresh_originals,
 'promote': promote, 'verify': verify, 'public-verify': public_verify}[sys.argv[1]]()
