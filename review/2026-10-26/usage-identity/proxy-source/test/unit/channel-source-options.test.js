import { expect } from 'chai';
import { describe, it } from 'mocha';
import { buildChannelSourceOptions } from '../../admin/src/utils/channel-source-options.js';

describe('channel editor source choices', () => {
  it('includes other channels, deduplicates shared choices, and puts current bindings first', () => {
    const streams = [
      { canonical: { id: 'other' }, sourceChannel: { id: 'b', source: 'Cable', name: 'News' } },
      { canonical: { id: 'current' }, sourceChannel: { id: 'a', source: 'Antenna', name: 'News', guideNumber: '6' } },
      { canonical: { id: 'duplicate' }, sourceChannel: { id: 'b', source: 'Cable', name: 'News' } },
    ];
    const guides = [
      { canonical: { id: 'other' }, source: { id: 'b', name: 'Cable' }, epgChannelId: 'news.b' },
      { canonical: { id: 'current' }, source: { id: 'a', name: 'Antenna' }, epgChannelId: 'news.a' },
    ];
    const options = buildChannelSourceOptions('current', streams, [...guides, guides[0]]);
    expect(options.streams.map(option => option.value)).to.deep.equal(['a', 'b']);
    expect(options.streams[0].label).to.equal('Antenna - News (6)');
    expect(options.guides.map(option => JSON.parse(option.value))).to.deep.equal([
      { sourceId: 'a', epgChannelId: 'news.a' },
      { sourceId: 'b', epgChannelId: 'news.b' },
    ]);
  });
});
