import { describe, it } from 'mocha';
import { expect } from 'chai';
import channelMatcher from '../../libs/channel-matcher.js';

const { findMatches, generateSuggestions, detectDuplicates, similarity, normalize } =
  channelMatcher;

describe('Channel Matcher', () => {
  describe('normalize', () => {
    it('should convert to lowercase', () => {
      const result = normalize('ABC Channel');
      expect(result).to.equal('abc channel');
    });

    it('should remove special characters', () => {
      const result = normalize('ABC-HD (West)');
      expect(result).to.equal('abchd west');
    });

    it('should normalize whitespace', () => {
      const result = normalize('ABC   Channel    HD');
      expect(result).to.equal('abc channel hd');
    });

    it('should trim leading/trailing whitespace', () => {
      const result = normalize('  ABC Channel  ');
      expect(result).to.equal('abc channel');
    });

    it('should handle empty strings', () => {
      const result = normalize('');
      expect(result).to.equal('');
    });

    it('should handle null/undefined', () => {
      expect(normalize(null)).to.equal('');
      expect(normalize(undefined)).to.equal('');
    });
  });

  describe('similarity', () => {
    it('should return 1 for identical strings', () => {
      const score = similarity('ABC Channel', 'ABC Channel');
      expect(score).to.equal(1);
    });

    it('should return 1 for identical strings with different cases', () => {
      const score = similarity('ABC Channel', 'abc channel');
      expect(score).to.equal(1);
    });

    it('should return value between 0 and 1 for similar strings', () => {
      const score = similarity('ABC Channel', 'ABC Chan');
      expect(score).to.be.greaterThan(0.5);
      expect(score).to.be.lessThan(1);
    });

    it('should return low score for very different strings', () => {
      const score = similarity('ABC', 'XYZ Network');
      expect(score).to.be.lessThan(0.5);
    });

    it('should return 0 for null/undefined', () => {
      expect(similarity(null, 'test')).to.equal(0);
      expect(similarity('test', null)).to.equal(0);
      expect(similarity(null, null)).to.equal(0);
    });

    it('should return 0 for empty strings', () => {
      const score = similarity('', '');
      expect(score).to.equal(0);
    });

    it('should handle unicode characters', () => {
      const score = similarity('Chaîne', 'Chaine');
      expect(score).to.be.greaterThan(0.5);
    });
  });

  describe('findMatches', () => {
    const candidates = [
      { name: 'ABC Network', tvg_id: 'abc.net' },
      { name: 'ABC HD', tvg_id: 'abc.hd' },
      { name: 'CBS Channel', tvg_id: 'cbs.ch' },
      { name: 'NBC Sports', tvg_id: 'nbc.sports' },
    ];

    it('should find matches by name above threshold', () => {
      const channel = { name: 'ABC Net', tvg_id: 'test.1' };
      const matches = findMatches(channel, candidates, 0.6);

      expect(matches.length).to.be.greaterThan(0);
      expect(matches[0].candidate.name).to.equal('ABC Network');
      expect(matches[0].score).to.be.greaterThan(0.6);
    });

    it('should sort matches by score descending', () => {
      const channel = { name: 'ABC', tvg_id: 'test.1' };
      const matches = findMatches(channel, candidates, 0.3);

      // If we have multiple matches, verify they're sorted
      if (matches.length > 1) {
        for (let i = 1; i < matches.length; i++) {
          expect(matches[i - 1].score).to.be.at.least(matches[i].score);
        }
      } else {
        // If only one match, that's still valid - just verify it's not empty
        expect(matches.length).to.be.greaterThan(0);
      }
    });

    it('should include match type in results', () => {
      const channel = { name: 'ABC Network', tvg_id: 'test.1' };
      const matches = findMatches(channel, candidates, 0.9);

      expect(matches[0]).to.have.property('matchType');
      expect(matches[0].matchType).to.be.oneOf(['name', 'tvg_id']);
    });

    it('should return empty array if no matches above threshold', () => {
      const channel = { name: 'ZZZ Channel', tvg_id: 'zzz.1' };
      const matches = findMatches(channel, candidates, 0.9);

      expect(matches).to.be.an('array');
      expect(matches).to.have.length(0);
    });

    it('should handle empty candidates array', () => {
      const channel = { name: 'ABC', tvg_id: 'test.1' };
      const matches = findMatches(channel, [], 0.6);

      expect(matches).to.be.an('array');
      expect(matches).to.have.length(0);
    });

    it('should skip exact tvg_id matches', () => {
      const channel = { name: 'Different Name', tvg_id: 'abc.net' };
      const matches = findMatches(channel, candidates, 0.1);

      // Should not include ABC Network with exact tvg_id match
      const exactMatch = matches.find(m => m.candidate.tvg_id === 'abc.net');
      expect(exactMatch).to.be.undefined;
    });

    it('should match by tvg_id when name is different', () => {
      const candidatesWithIds = [
        { name: 'Different Name', tvg_id: 'abc.network.hd' },
        { name: 'Another Name', tvg_id: 'xyz.channel' },
      ];

      const channel = { name: 'Test', tvg_id: 'abc.network' };
      const matches = findMatches(channel, candidatesWithIds, 0.6);

      expect(matches.length).to.be.greaterThan(0);
      const topMatch = matches.find(m => m.candidate.tvg_id === 'abc.network.hd');
      expect(topMatch).to.exist;
    });

    it('should handle null channel gracefully', () => {
      const matches = findMatches(null, candidates, 0.6);
      expect(matches).to.be.an('array');
      expect(matches).to.have.length(0);
    });

    it('should handle null candidates gracefully', () => {
      const channel = { name: 'ABC', tvg_id: 'test.1' };
      const matches = findMatches(channel, null, 0.6);
      expect(matches).to.be.an('array');
      expect(matches).to.have.length(0);
    });
  });

  describe('generateSuggestions', () => {
    const allChannels = [
      { name: 'ABC Network', tvg_id: 'abc.net' },
      { name: 'ABC HD', tvg_id: 'abc.hd' },
      { name: 'CBS Channel', tvg_id: 'cbs.ch' },
      { name: 'NBC Sports', tvg_id: 'nbc.sports' },
    ];

    it('should generate suggestions for unmapped channels', () => {
      const unmapped = [{ name: 'ABC Net', tvg_id: 'unmapped.1' }];

      const suggestions = generateSuggestions(unmapped, allChannels, { threshold: 0.6 });

      expect(suggestions).to.be.an('array');
      expect(suggestions.length).to.equal(1);
      expect(suggestions[0]).to.have.property('channel');
      expect(suggestions[0]).to.have.property('suggestions');
      expect(suggestions[0].suggestions.length).to.be.greaterThan(0);
    });

    it('should respect threshold option', () => {
      const unmapped = [{ name: 'ZZZ Channel', tvg_id: 'zzz.1' }];

      const suggestions = generateSuggestions(unmapped, allChannels, { threshold: 0.9 });

      // Very different name should not have suggestions with high threshold
      expect(suggestions).to.have.length(0);
    });

    it('should limit suggestions to maxSuggestions', () => {
      const unmapped = [{ name: 'ABC', tvg_id: 'unmapped.1' }];

      const suggestions = generateSuggestions(unmapped, allChannels, {
        threshold: 0.3,
        maxSuggestions: 2,
      });

      expect(suggestions.length).to.be.greaterThan(0);
      expect(suggestions[0].suggestions.length).to.be.at.most(2);
    });

    it('should include score and matchType in suggestions', () => {
      const unmapped = [{ name: 'ABC Network', tvg_id: 'unmapped.1' }];

      const suggestions = generateSuggestions(unmapped, allChannels);

      expect(suggestions[0].suggestions[0]).to.have.property('score');
      expect(suggestions[0].suggestions[0]).to.have.property('matchType');
    });

    it('should handle multiple unmapped channels', () => {
      const unmapped = [
        { name: 'ABC Net', tvg_id: 'unmapped.1' },
        { name: 'CBS Chan', tvg_id: 'unmapped.2' },
      ];

      const suggestions = generateSuggestions(unmapped, allChannels, { threshold: 0.6 });

      expect(suggestions.length).to.be.at.least(2);
    });

    it('should return empty array for channels with no matches', () => {
      const unmapped = [{ name: 'XYZ Network', tvg_id: 'xyz.1' }];

      const suggestions = generateSuggestions(unmapped, allChannels, { threshold: 0.9 });

      expect(suggestions).to.be.an('array');
      expect(suggestions).to.have.length(0);
    });
  });

  describe('detectDuplicates', () => {
    it('should detect duplicate channel names', () => {
      const channels = [
        { name: 'ABC Network', tvg_id: 'abc.1', source: 'Source1' },
        { name: 'ABC Network', tvg_id: 'abc.2', source: 'Source2' },
        { name: 'CBS Channel', tvg_id: 'cbs.1', source: 'Source1' },
      ];

      const duplicates = detectDuplicates(channels);

      expect(duplicates.byName).to.have.length(1);
      expect(duplicates.byName[0].name).to.equal('ABC Network');
      expect(duplicates.byName[0].count).to.equal(2);
      expect(duplicates.byName[0].sources).to.have.members(['Source1', 'Source2']);
    });

    it('should detect duplicate tvg_ids', () => {
      const channels = [
        { name: 'ABC Network', tvg_id: 'abc.net', source: 'Source1' },
        { name: 'ABC HD', tvg_id: 'abc.net', source: 'Source2' },
        { name: 'CBS Channel', tvg_id: 'cbs.1', source: 'Source1' },
      ];

      const duplicates = detectDuplicates(channels);

      expect(duplicates.byTvgId).to.have.length(1);
      expect(duplicates.byTvgId[0].tvgId).to.equal('abc.net');
      expect(duplicates.byTvgId[0].count).to.equal(2);
    });

    it('should return empty arrays when no duplicates', () => {
      const channels = [
        { name: 'ABC Network', tvg_id: 'abc.1', source: 'Source1' },
        { name: 'CBS Channel', tvg_id: 'cbs.1', source: 'Source2' },
      ];

      const duplicates = detectDuplicates(channels);

      expect(duplicates.byName).to.have.length(0);
      expect(duplicates.byTvgId).to.have.length(0);
    });

    it('should handle channels without tvg_id', () => {
      const channels = [
        { name: 'ABC Network', tvg_id: '', source: 'Source1' },
        { name: 'ABC Network', tvg_id: '', source: 'Source2' },
      ];

      const duplicates = detectDuplicates(channels);

      expect(duplicates.byName).to.have.length(1);
      expect(duplicates.byTvgId).to.have.length(0);
    });

    it('should handle empty array', () => {
      const duplicates = detectDuplicates([]);

      expect(duplicates.byName).to.be.an('array');
      expect(duplicates.byName).to.have.length(0);
      expect(duplicates.byTvgId).to.be.an('array');
      expect(duplicates.byTvgId).to.have.length(0);
    });

    it('should handle null/undefined input', () => {
      const duplicates = detectDuplicates(null);

      expect(duplicates.byName).to.be.an('array');
      expect(duplicates.byName).to.have.length(0);
      expect(duplicates.byTvgId).to.be.an('array');
      expect(duplicates.byTvgId).to.have.length(0);
    });

    it('should handle channels with null entries', () => {
      const channels = [
        { name: 'ABC Network', tvg_id: 'abc.1', source: 'Source1' },
        null,
        { name: 'CBS Channel', tvg_id: 'cbs.1', source: 'Source2' },
      ];

      const duplicates = detectDuplicates(channels);

      expect(duplicates.byName).to.have.length(0);
      expect(duplicates.byTvgId).to.have.length(0);
    });

    it('should include all duplicate channels in results', () => {
      const channels = [
        { name: 'ABC', tvg_id: 'abc.1', source: 'Source1' },
        { name: 'ABC', tvg_id: 'abc.2', source: 'Source2' },
        { name: 'ABC', tvg_id: 'abc.3', source: 'Source3' },
      ];

      const duplicates = detectDuplicates(channels);

      expect(duplicates.byName[0].channels).to.have.length(3);
      expect(duplicates.byName[0].sources).to.have.length(3);
    });
  });
});
