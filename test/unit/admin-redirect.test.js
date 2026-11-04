import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it } from 'mocha';
import { expect } from 'chai';

// Execute the actual navigation functions without mounting the rest of the Vue UI.
const source = fs.readFileSync(new URL('../../admin/src/App.vue', import.meta.url), 'utf8');
const functions = ['getPostLoginRedirect', 'redirectToAdmin'].map(name => {
  const match = source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'));
  if (!match) throw new Error(`Missing navigation function: ${name}`);
  return match[0];
});
const origin = 'https://proxy.example:34400';

function navigate(target, postLogin = true) {
  const destinations = [];
  const context = vm.createContext({
    URL,
    URLSearchParams,
    target,
    window: {
      location: {
        origin,
        search: `?redirect=${encodeURIComponent(target)}`,
        replace: value => destinations.push(new URL(value, origin).href),
      },
    },
  });
  vm.runInContext(
    `const DEFAULT_ADMIN_ROUTE = '/admin'; const LOGIN_ROUTE = '/admin/login';
     ${functions.join('\n')}
     redirectToAdmin(${postLogin ? 'getPostLoginRedirect()' : 'target'});`,
    context
  );
  expect(destinations).to.have.length(1);
  return destinations[0];
}

describe('admin navigation origins', () => {
  for (const target of [
    '/\\attacker.example/path',
    '/\t/attacker.example/path',
    '/\n/attacker.example/path',
    '//attacker.example/path',
    'https://attacker.example/path',
    'javascript:alert(1)',
    'https://proxy.example:34401/admin',
    'http://proxy.example:34400/admin',
    'http://[invalid',
  ]) {
    it(`keeps post-login redirect ${JSON.stringify(target)} on the application origin`, () => {
      expect(navigate(target)).to.equal(`${origin}/admin`);
    });

    it(`validates direct navigation ${JSON.stringify(target)} at the sink`, () => {
      expect(navigate(target, false)).to.equal(`${origin}/admin`);
    });
  }

  for (const target of [
    '/admin',
    '/admin?tab=channels#selected',
    '/oauth/authorize?client_id=client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=xyz',
  ]) {
    it(`preserves the local destination ${target}`, () => {
      expect(navigate(target)).to.equal(`${origin}${target}`);
    });
  }

  it('still allows logout and session-expiry navigation to login', () => {
    expect(navigate('/admin/login', false)).to.equal(`${origin}/admin/login`);
    expect(navigate('/admin/login?redirect=%2Fadmin%3Ftab%3Dchannels', false)).to.equal(
      `${origin}/admin/login?redirect=%2Fadmin%3Ftab%3Dchannels`
    );
  });
});
