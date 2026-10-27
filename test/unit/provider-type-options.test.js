import { expect } from 'chai';
import { describe, it } from 'mocha';
import { getProviderTypeOptions } from '../../admin/src/utils/provider-type-options.js';

describe('provider type options', () => {
  it('places the saved HDHomeRun type first when the select initializes', () => {
    expect(getProviderTypeOptions({ value: 'hdhomerun' })).to.deep.equal([
      { label: 'HDHomeRun', value: 'hdhomerun' },
      { label: 'M3U', value: 'm3u' },
    ]);
  });

  it('places the saved M3U type first when the select initializes', () => {
    expect(getProviderTypeOptions({ value: 'm3u' })).to.deep.equal([
      { label: 'M3U', value: 'm3u' },
      { label: 'HDHomeRun', value: 'hdhomerun' },
    ]);
  });
});
