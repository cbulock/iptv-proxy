import { describe, it } from 'mocha';
import { expect } from 'chai';
import { parseClientName } from '../../server/usage.js';

describe('parseClientName', () => {
  it('returns empty string for empty input', () => {
    expect(parseClientName('')).to.equal('');
    expect(parseClientName(null)).to.equal('');
    expect(parseClientName(undefined)).to.equal('');
  });

  it('detects Plex', () => {
    expect(parseClientName('Plex/1.0 (Linux)')).to.equal('Plex');
  });

  it('detects Jellyfin', () => {
    expect(parseClientName('Jellyfin/10.8.0 (Linux)')).to.equal('Jellyfin');
  });

  it('detects Emby', () => {
    expect(parseClientName('Emby/4.7.0 (Windows)')).to.equal('Emby');
  });

  it('detects Infuse', () => {
    expect(parseClientName('Infuse/7.6 (iOS)')).to.equal('Infuse');
  });

  it('detects VLC', () => {
    expect(parseClientName('VLC/3.0.18 LibVLC/3.0.18')).to.equal('VLC');
  });

  it('detects Kodi', () => {
    expect(parseClientName('Kodi/21.0 (Linux; Android)')).to.equal('Kodi');
  });

  it('detects TiViMate (case-insensitive)', () => {
    expect(parseClientName('tivimate/4.6.0 (Android)')).to.equal('TiViMate');
  });

  it('detects IPTV Smarters', () => {
    expect(parseClientName('IPTV Smarters/1.0')).to.equal('IPTV Smarters');
    expect(parseClientName('IPTVSmarters/2.0')).to.equal('IPTV Smarters');
  });

  it('detects GSE IPTV', () => {
    expect(parseClientName('GSE IPTV/6.0 (iOS)')).to.equal('GSE IPTV');
  });

  it('detects Perfect Player', () => {
    expect(parseClientName('Perfect Player/1.5')).to.equal('Perfect Player');
  });

  it('detects Televizo', () => {
    expect(parseClientName('Televizo/1.9 (Android)')).to.equal('Televizo');
  });

  it('detects Sparkle', () => {
    expect(parseClientName('Sparkle/2.0 (iOS)')).to.equal('Sparkle');
  });

  it('detects OTT Navigator', () => {
    expect(parseClientName('OTTNavigator/2.6.9 (Android)')).to.equal('OTT Navigator');
    expect(parseClientName('OTT Navigator/2.6.9')).to.equal('OTT Navigator');
  });

  it('falls back to first UA token for unknown clients', () => {
    expect(parseClientName('CustomApp/1.0 (Linux)')).to.equal('CustomApp');
  });

  it('is case-insensitive for known clients', () => {
    expect(parseClientName('PLEX/1.0')).to.equal('Plex');
    expect(parseClientName('jellyfin/10.8.0')).to.equal('Jellyfin');
  });
});
