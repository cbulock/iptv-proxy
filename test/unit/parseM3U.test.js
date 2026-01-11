import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { applyMapping, proxyURL } from '../../scripts/parseM3U.js';
import { createMockChannel, createMockMapping } from '../helpers.js';

describe('M3U Parser - applyMapping', () => {
  describe('Name-based mapping', () => {
    it('should apply mapping by channel name', () => {
      const channel = createMockChannel({
        name: 'Test Channel',
        tvg_id: 'original.1',
        logo: 'http://example.com/original-logo.png',
        guideNumber: '1',
      });

      const mapping = createMockMapping('Test Channel', {
        name: 'Mapped Channel',
        tvg_id: 'mapped.100',
        logo: 'http://example.com/mapped-logo.png',
        number: '100',
        group: 'Entertainment',
      });

      const result = applyMapping(channel, mapping);

      expect(result.name).to.equal('Mapped Channel');
      expect(result.tvg_id).to.equal('mapped.100');
      expect(result.logo).to.equal('http://example.com/mapped-logo.png');
      expect(result.guideNumber).to.equal('100');
      expect(result.group).to.equal('Entertainment');
    });

    it('should preserve original values when mapping fields are not provided', () => {
      const channel = createMockChannel({
        name: 'Test Channel',
        tvg_id: 'original.1',
        logo: 'http://example.com/original-logo.png',
        url: 'http://example.com/stream',
      });

      const mapping = {
        'Test Channel': {
          number: '100',
        },
      };

      const result = applyMapping(channel, mapping);

      expect(result.name).to.equal('Test Channel');
      expect(result.tvg_id).to.equal('original.1');
      expect(result.logo).to.equal('http://example.com/original-logo.png');
      expect(result.url).to.equal('http://example.com/stream');
      expect(result.guideNumber).to.equal('100');
    });
  });

  describe('TVG ID-based mapping', () => {
    it('should fall back to tvg_id mapping when name not found', () => {
      const channel = createMockChannel({
        name: 'Test Channel',
        tvg_id: 'original.1',
      });

      const mapping = {
        'original.1': {
          name: 'Mapped by TVG ID',
          tvg_id: 'mapped.200',
          number: '200',
        },
      };

      const result = applyMapping(channel, mapping);

      expect(result.name).to.equal('Mapped by TVG ID');
      expect(result.tvg_id).to.equal('mapped.200');
      expect(result.guideNumber).to.equal('200');
    });

    it('should prefer name-based mapping over tvg_id mapping', () => {
      const channel = createMockChannel({
        name: 'Test Channel',
        tvg_id: 'original.1',
      });

      const mapping = {
        'Test Channel': {
          name: 'Mapped by Name',
          number: '100',
        },
        'original.1': {
          name: 'Mapped by TVG ID',
          number: '200',
        },
      };

      const result = applyMapping(channel, mapping);

      expect(result.name).to.equal('Mapped by Name');
      expect(result.guideNumber).to.equal('100');
    });
  });

  describe('Fallback behavior', () => {
    it('should use guideNumber as tvg_id when tvg_id is missing', () => {
      const channel = createMockChannel({
        name: 'Test Channel',
        tvg_id: '',
        guideNumber: '42',
      });

      const mapping = {};

      const result = applyMapping(channel, mapping);

      expect(result.tvg_id).to.equal('42');
    });

    it('should not override existing tvg_id with guideNumber', () => {
      const channel = createMockChannel({
        name: 'Test Channel',
        tvg_id: 'existing.1',
        guideNumber: '42',
      });

      const mapping = {};

      const result = applyMapping(channel, mapping);

      expect(result.tvg_id).to.equal('existing.1');
    });

    it('should handle channel with no mapping', () => {
      const channel = createMockChannel({
        name: 'Unmapped Channel',
        tvg_id: 'unmapped.1',
      });

      const mapping = {};

      const result = applyMapping(channel, mapping);

      expect(result.name).to.equal('Unmapped Channel');
      expect(result.tvg_id).to.equal('unmapped.1');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty mapping object', () => {
      const channel = createMockChannel();
      const result = applyMapping(channel, {});

      expect(result.name).to.equal(channel.name);
      expect(result.tvg_id).to.equal(channel.tvg_id);
    });

    it('should handle channel without tvg_id', () => {
      const channel = createMockChannel({
        tvg_id: '',
        guideNumber: '',
      });

      const mapping = {
        'Test Channel': {
          tvg_id: 'mapped.1',
        },
      };

      const result = applyMapping(channel, mapping);

      expect(result.tvg_id).to.equal('mapped.1');
    });

    it('should handle mapping with null/undefined values', () => {
      const channel = createMockChannel({
        name: 'Test Channel',
        tvg_id: 'original.1',
        logo: 'http://example.com/logo.png',
      });

      const mapping = {
        'Test Channel': {
          name: null,
          tvg_id: undefined,
          logo: '',
        },
      };

      const result = applyMapping(channel, mapping);

      expect(result.name).to.equal('Test Channel');
      expect(result.tvg_id).to.equal('original.1');
      expect(result.logo).to.equal('http://example.com/logo.png');
    });
  });
});

describe('M3U Parser - proxyURL', () => {
  it('should generate proxy URL with encoded source and name', () => {
    const channel = {
      source: 'TestSource',
      name: 'Test Channel',
    };

    const result = proxyURL(channel);

    expect(result).to.equal('/stream/TestSource/Test%20Channel');
  });

  it('should properly encode special characters in channel name', () => {
    const channel = {
      source: 'MySource',
      name: 'Channel & Show',
    };

    const result = proxyURL(channel);

    expect(result).to.equal('/stream/MySource/Channel%20%26%20Show');
  });

  it('should properly encode special characters in source name', () => {
    const channel = {
      source: 'Source/Name',
      name: 'Channel',
    };

    const result = proxyURL(channel);

    expect(result).to.equal('/stream/Source%2FName/Channel');
  });

  it('should handle unicode characters', () => {
    const channel = {
      source: 'Source',
      name: 'Chaîne Française',
    };

    const result = proxyURL(channel);

    expect(result).to.equal('/stream/Source/Cha%C3%AEne%20Fran%C3%A7aise');
  });
});
