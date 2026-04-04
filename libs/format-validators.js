import { XMLParser } from 'fast-xml-parser';

/**
 * Validate M3U playlist format
 * @param {string} m3uContent - M3U content to validate
 * @returns {Object} Validation result with isValid flag and errors array
 */
export function validateM3UFormat(m3uContent) {
  const errors = [];
  const warnings = [];

  if (!m3uContent || typeof m3uContent !== 'string') {
    errors.push('M3U content must be a non-empty string');
    return { isValid: false, errors, warnings };
  }

  const lines = m3uContent.split('\n');

  // Check for M3U header
  if (lines.length === 0 || !lines[0].trim().startsWith('#EXTM3U')) {
    errors.push('M3U file must start with #EXTM3U header');
  }

  // Valid streaming protocols
  const validProtocols = ['http://', 'https://', 'rtsp://', 'rtp://', 'udp://'];

  let channelCount = 0;
  let currentLineNumber = 0;
  let expectingUrl = false;

  for (const line of lines) {
    currentLineNumber++;
    const trimmedLine = line.trim();

    if (!trimmedLine) continue;

    if (trimmedLine.startsWith('#EXTINF')) {
      channelCount++;
      expectingUrl = true;

      // Validate EXTINF format
      if (!trimmedLine.includes(',')) {
        errors.push(`Line ${currentLineNumber}: EXTINF must contain comma separator`);
      }

      const nameMatch = trimmedLine.match(/,(.*)$/);
      if (!nameMatch || !nameMatch[1].trim()) {
        errors.push(`Line ${currentLineNumber}: EXTINF must have a channel name after comma`);
      }
    } else if (!trimmedLine.startsWith('#')) {
      // This should be a stream URL
      const hasValidProtocol = validProtocols.some(protocol => trimmedLine.startsWith(protocol));

      if (!hasValidProtocol) {
        errors.push(
          `Line ${currentLineNumber}: Invalid stream URL protocol (must be http://, https://, rtsp://, rtp://, or udp://)`
        );
      }

      if (!expectingUrl) {
        warnings.push(`Line ${currentLineNumber}: URL found without preceding EXTINF directive`);
      }

      expectingUrl = false;
    }
  }

  if (channelCount === 0) {
    warnings.push('M3U file contains no channels');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    channelCount,
  };
}

/**
 * Validate XMLTV EPG format
 * @param {string} xmlContent - XMLTV content to validate
 * @returns {Object} Validation result with isValid flag and errors array
 */
export function validateXMLTVFormat(xmlContent) {
  const errors = [];
  const warnings = [];

  if (!xmlContent || typeof xmlContent !== 'string') {
    errors.push('XMLTV content must be a non-empty string');
    return { isValid: false, errors, warnings };
  }

  const trimmedContent = xmlContent.trim();

  // Check for XML declaration (optional but recommended)
  if (!/^\s*<\?xml/i.test(trimmedContent)) {
    warnings.push('XMLTV file missing XML declaration');
  }

  // Check for root <tv> element (must be an actual tag, not in comments/text)
  if (!/<tv[\s>]/i.test(trimmedContent)) {
    errors.push('XMLTV file must have <tv> root element');
    return { isValid: false, errors, warnings };
  }

  // Try to parse the XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  let parsed;
  try {
    parsed = parser.parse(xmlContent);
  } catch (err) {
    errors.push(`XML parsing failed: ${err.message}`);
    return { isValid: false, errors, warnings };
  }

  if (!parsed || !parsed.tv || typeof parsed.tv !== 'object') {
    errors.push('Invalid XMLTV structure: missing <tv> root element');
    return { isValid: false, errors, warnings };
  }

  // Validate channels
  const channels = Array.isArray(parsed.tv.channel)
    ? parsed.tv.channel
    : parsed.tv.channel
      ? [parsed.tv.channel]
      : [];
  let channelCount = 0;

  for (const channel of channels) {
    channelCount++;

    if (!channel['@_id']) {
      errors.push(`Channel ${channelCount}: missing required 'id' attribute`);
    }

    if (!channel['display-name']) {
      warnings.push(`Channel ${channel['@_id'] || channelCount}: missing display-name element`);
    }
  }

  // Validate programmes
  const programmes = Array.isArray(parsed.tv.programme)
    ? parsed.tv.programme
    : parsed.tv.programme
      ? [parsed.tv.programme]
      : [];
  let programmeCount = 0;

  for (const programme of programmes) {
    programmeCount++;

    if (!programme['@_channel']) {
      errors.push(`Programme ${programmeCount}: missing required 'channel' attribute`);
    }

    if (!programme['@_start']) {
      errors.push(`Programme ${programmeCount}: missing required 'start' attribute`);
    }

    if (!programme['@_stop']) {
      errors.push(`Programme ${programmeCount}: missing required 'stop' attribute`);
    }

    if (!programme.title) {
      warnings.push(`Programme ${programmeCount}: missing title element`);
    }
  }

  if (channelCount === 0) {
    warnings.push('XMLTV file contains no channels');
  }

  if (programmeCount === 0) {
    warnings.push('XMLTV file contains no programmes');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    channelCount,
    programmeCount,
  };
}
