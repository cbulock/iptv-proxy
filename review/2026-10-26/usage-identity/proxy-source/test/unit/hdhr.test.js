import { describe, it } from 'mocha';
import { expect } from 'chai';
import { setupHDHRRoutes } from '../../server/hdhr.js';

function getDiscovery(config = {}, request = {}) {
  const routes = new Map();
  setupHDHRRoutes(
    {
      get(path, handler) {
        routes.set(path, handler);
      },
    },
    config
  );

  const headers = request.headers || {};
  const req = {
    protocol: request.protocol || 'http',
    hostname: request.hostname,
    headers,
    get(name) {
      const requestedHeader = name.toLowerCase();
      return Object.entries(headers).find(
        ([header]) => header.toLowerCase() === requestedHeader
      )?.[1];
    },
  };
  let body;
  routes.get('/discover.json')(req, {
    json(payload) {
      body = payload;
    },
  });
  return body;
}

describe('HDHomeRun discovery', () => {
  it('advertises the direct LAN request origin', () => {
    const discovery = getDiscovery({}, {
      headers: { Host: '192.168.1.42:34400' },
    });

    expect(discovery.BaseURL).to.equal('http://192.168.1.42:34400');
    expect(discovery.LineupURL).to.equal('http://192.168.1.42:34400/lineup.json');
  });

  it('honors the custom listener port supplied by the request', () => {
    const discovery = getDiscovery({}, { headers: { Host: 'iptv-proxy.lan:49152' } });

    expect(discovery.BaseURL).to.equal('http://iptv-proxy.lan:49152');
  });

  it('prefers the configured public base URL', () => {
    const discovery = getDiscovery(
      { base_url: 'https://iptv.example.com/iptv/' },
      { headers: { Host: '192.168.1.42:34400' } }
    );

    expect(discovery.BaseURL).to.equal('https://iptv.example.com/iptv');
    expect(discovery.LineupURL).to.equal('https://iptv.example.com/iptv/lineup.json');
  });

  it('honors trusted reverse-proxy headers', () => {
    const discovery = getDiscovery(
      {},
      {
        protocol: 'http',
        headers: {
          Host: 'localhost:34400',
          'X-Forwarded-Host': 'tv.example.com:8443',
          'X-Forwarded-Proto': 'https',
        },
      }
    );

    expect(discovery.BaseURL).to.equal('https://tv.example.com:8443');
    expect(discovery.LineupURL).to.equal('https://tv.example.com:8443/lineup.json');
  });
});
