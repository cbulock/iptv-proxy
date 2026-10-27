import { describe, it } from 'mocha';
import { expect } from 'chai';
import * as usage from '../../server/usage.js';

const secret = 'test-identity-secret';

function request(headers = {}) {
  return { headers };
}

describe('trusted usage identity', () => {
  it('accepts encoded account metadata with the configured secret', () => {
    expect(usage.readUsageIdentity).to.be.a('function');
    expect(
      usage.readUsageIdentity(
        request({
          'x-iptv-identity-secret': secret,
          'x-iptv-user-id': 'account-1',
          'x-iptv-user-name': encodeURIComponent('Bób Smith'),
        }),
        secret
      )
    ).to.deep.equal({ userId: 'account-1', userName: 'Bób Smith' });
  });

  it('ignores unconfigured, incorrect, or malformed identity headers', () => {
    const headers = {
      'x-iptv-identity-secret': secret,
      'x-iptv-user-id': 'account-1',
      'x-iptv-user-name': 'Alice',
    };
    expect(usage.readUsageIdentity(request(headers), '')).to.equal(null);
    expect(
      usage.readUsageIdentity(request({ ...headers, 'x-iptv-identity-secret': 'wrong' }), secret)
    ).to.equal(null);
    expect(
      usage.readUsageIdentity(request({ ...headers, 'x-iptv-user-name': '%ZZ' }), secret)
    ).to.equal(null);
    expect(usage.readUsageIdentity(request({ ...headers, 'x-iptv-user-id': '' }), secret)).to.equal(
      null
    );
  });
});
