import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { ADMIN_SESSION_MAX_AGE_MS } from '../../libs/admin-session-config.js';

const appSource = readFileSync(new URL('../../admin/src/App.vue', import.meta.url), 'utf8');
const schedulerSource = appSource.slice(
  appSource.indexOf('function scheduleAuthExpiry('),
  appSource.indexOf('function syncAuthenticatedSession(')
);

describe('admin session expiry timer', () => {
  afterEach(() => sinon.restore());

  function setup() {
    const clock = sinon.useFakeTimers();
    const expired = sinon.spy();
    const delays = [];
    const context = vm.createContext({
      Date,
      _authExpiryTimeout: null,
      handleUnauthorizedSession: expired,
      window: {
        clearTimeout,
        setTimeout(callback, delay) {
          delays.push(delay);
          // Browsers overflow delays outside the signed 32-bit timer range.
          return setTimeout(callback, delay > 2 ** 31 - 1 ? 1 : delay);
        },
      },
    });
    vm.runInContext(schedulerSource, context);
    return { clock, expired, delays, schedule: context.scheduleAuthExpiry };
  }

  it('keeps a 30-day login active until its actual expiry without overflowing browser timers', () => {
    const { clock, expired, delays, schedule } = setup();
    schedule(new Date(Date.now() + ADMIN_SESSION_MAX_AGE_MS).toISOString());
    clock.tick(1);
    expect(expired.called).to.equal(false);
    expect(delays.every(delay => delay <= 2 ** 31 - 1)).to.equal(true);
    clock.tick(2 ** 31 - 1);
    expect(expired.called).to.equal(false);
    clock.tick(ADMIN_SESSION_MAX_AGE_MS - clock.now + 250);
    expect(expired.calledOnce).to.equal(true);
  });

  it('cancels the old expiry when activity renews the session', () => {
    const { clock, expired, schedule } = setup();
    schedule(new Date(Date.now() + 1000).toISOString());
    clock.tick(500);
    schedule(new Date(Date.now() + 2000).toISOString());
    clock.tick(750);
    expect(expired.called).to.equal(false);
    clock.tick(1500);
    expect(expired.calledOnce).to.equal(true);
  });

  it('expires an already expired session immediately', () => {
    const { expired, schedule } = setup();
    schedule(new Date(Date.now() - 1).toISOString());
    expect(expired.calledOnce).to.equal(true);
  });
});
