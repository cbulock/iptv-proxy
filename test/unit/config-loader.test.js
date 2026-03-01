import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { normalizeChannelMapKeys } from '../../libs/config-loader.js';

describe('normalizeChannelMapKeys', () => {
  let warnStub;

  beforeEach(() => {
    warnStub = sinon.stub(console, 'warn');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return the map unchanged when no HTML entities are present', () => {
    const map = { 'H & I': { tvg_id: '1' }, CNN: { tvg_id: '2' } };
    const result = normalizeChannelMapKeys(map);
    expect(result).to.deep.equal(map);
    expect(warnStub.called).to.be.false;
  });

  it('should decode HTML entities in keys', () => {
    const map = { 'H &amp; I': { tvg_id: '1' } };
    const result = normalizeChannelMapKeys(map);
    expect(result).to.have.property('H & I');
    expect(result).to.not.have.property('H &amp; I');
  });

  it('should warn when a key contains HTML entities', () => {
    const map = { 'H &amp; I': { tvg_id: '1' } };
    normalizeChannelMapKeys(map);
    expect(warnStub.calledOnce).to.be.true;
    expect(warnStub.firstCall.args[0]).to.include('H &amp; I');
  });

  it('should warn on key collision when two keys decode to the same value', () => {
    const map = { 'H &amp; I': { tvg_id: '1' }, 'H & I': { tvg_id: '2' } };
    const result = normalizeChannelMapKeys(map);
    // Two warnings: one for HTML entity decoding, one for collision
    expect(warnStub.calledTwice).to.be.true;
    const collisionMessage = warnStub.secondCall.args[0];
    expect(collisionMessage).to.include('collision');
    expect(collisionMessage).to.include('H & I');
    // The second entry overwrites the first
    expect(result['H & I'].tvg_id).to.equal('2');
  });

  it('should handle null or non-object input gracefully', () => {
    expect(normalizeChannelMapKeys(null)).to.be.null;
    expect(normalizeChannelMapKeys(undefined)).to.be.undefined;
    expect(normalizeChannelMapKeys('string')).to.equal('string');
  });
});
