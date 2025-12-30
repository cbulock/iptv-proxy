/**
 * EPG/XMLTV validation utilities
 * Validates channel and programme tags for correctness
 */

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});

/**
 * Validate channel element
 * @param {Object} channel - Channel object from parsed XML
 * @param {number} index - Index of channel in array
 * @returns {Object} Validation result
 */
function validateChannel(channel, index) {
  const errors = [];
  const warnings = [];
  
  if (!channel) {
    errors.push(`Channel at index ${index} is null or undefined`);
    return { valid: false, errors, warnings };
  }
  
  // Required: channel id attribute
  if (!channel['@_id']) {
    errors.push(`Channel at index ${index} missing required "id" attribute`);
  } else if (typeof channel['@_id'] !== 'string' || !channel['@_id'].trim()) {
    errors.push(`Channel at index ${index} has invalid "id" attribute (empty or non-string)`);
  }
  
  // Recommended: display-name element
  if (!channel['display-name']) {
    warnings.push(`Channel "${channel['@_id'] || index}" missing display-name element`);
  } else {
    const displayNames = Array.isArray(channel['display-name']) 
      ? channel['display-name'] 
      : [channel['display-name']];
    
    if (displayNames.length === 0) {
      warnings.push(`Channel "${channel['@_id'] || index}" has empty display-name array`);
    }
  }
  
  // Optional: icon element validation
  if (channel.icon) {
    const icons = Array.isArray(channel.icon) ? channel.icon : [channel.icon];
    for (const icon of icons) {
      if (!icon['@_src']) {
        warnings.push(`Channel "${channel['@_id'] || index}" has icon without src attribute`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    channelId: channel['@_id'] || `index_${index}`
  };
}

/**
 * Validate programme element
 * @param {Object} programme - Programme object from parsed XML
 * @param {number} index - Index of programme in array
 * @param {Set} validChannelIds - Set of valid channel IDs
 * @returns {Object} Validation result
 */
function validateProgramme(programme, index, validChannelIds) {
  const errors = [];
  const warnings = [];
  
  if (!programme) {
    errors.push(`Programme at index ${index} is null or undefined`);
    return { valid: false, errors, warnings };
  }
  
  // Required: channel attribute
  if (!programme['@_channel']) {
    errors.push(`Programme at index ${index} missing required "channel" attribute`);
  } else if (validChannelIds && !validChannelIds.has(programme['@_channel'])) {
    warnings.push(`Programme at index ${index} references unknown channel "${programme['@_channel']}"`);
  }
  
  // Required: start attribute
  if (!programme['@_start']) {
    errors.push(`Programme at index ${index} missing required "start" attribute`);
  } else if (!isValidXMLTVTime(programme['@_start'])) {
    errors.push(`Programme at index ${index} has invalid "start" time format: ${programme['@_start']}`);
  }
  
  // Required: stop attribute
  if (!programme['@_stop']) {
    errors.push(`Programme at index ${index} missing required "stop" attribute`);
  } else if (!isValidXMLTVTime(programme['@_stop'])) {
    errors.push(`Programme at index ${index} has invalid "stop" time format: ${programme['@_stop']}`);
  }
  
  // Validate start < stop if both are present
  if (programme['@_start'] && programme['@_stop']) {
    try {
      const startTime = parseXMLTVTime(programme['@_start']);
      const stopTime = parseXMLTVTime(programme['@_stop']);
      
      if (startTime >= stopTime) {
        errors.push(`Programme at index ${index} has start time >= stop time`);
      }
    } catch (e) {
      // Already reported as invalid format
    }
  }
  
  // Recommended: title element
  if (!programme.title) {
    warnings.push(`Programme at index ${index} for channel "${programme['@_channel']}" missing title`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    channel: programme['@_channel'] || `unknown`,
    start: programme['@_start'] || 'unknown'
  };
}

/**
 * Check if time string matches XMLTV format (YYYYMMDDHHmmss ±HHMM)
 * @param {string} timeStr - Time string to validate
 * @returns {boolean} True if valid
 */
function isValidXMLTVTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return false;
  
  // XMLTV format: YYYYMMDDHHmmss with optional timezone
  // Examples: 20231225180000 +0000, 20231225180000
  const regex = /^\d{14}(\s[+-]\d{4})?$/;
  return regex.test(timeStr.trim());
}

/**
 * Parse XMLTV time to Date object
 * @param {string} timeStr - XMLTV time string
 * @returns {Date} Parsed date
 */
function parseXMLTVTime(timeStr) {
  if (!timeStr) throw new Error('Empty time string');
  
  // Extract date/time components
  const match = timeStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) throw new Error('Invalid XMLTV time format');
  
  const [_, year, month, day, hour, minute, second] = match;
  
  // Note: month is 0-indexed in Date constructor
  return new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  );
}

/**
 * Validate entire EPG/XMLTV document
 * @param {string} xmlString - XML content to validate
 * @returns {Object} Validation result with errors and warnings
 */
export function validateEPG(xmlString) {
  const result = {
    valid: true,
    errors: [],
    warnings: [],
    channelCount: 0,
    programmeCount: 0,
    validChannels: 0,
    validProgrammes: 0,
    details: {
      channels: [],
      programmes: []
    }
  };
  
  try {
    // Parse XML
    const parsed = parser.parse(xmlString);
    
    if (!parsed || !parsed.tv) {
      result.valid = false;
      result.errors.push('Invalid XMLTV format: missing <tv> root element');
      return result;
    }
    
    const tv = parsed.tv;
    
    // Validate channels
    const channels = Array.isArray(tv.channel) ? tv.channel : (tv.channel ? [tv.channel] : []);
    result.channelCount = channels.length;
    
    const validChannelIds = new Set();
    
    for (let i = 0; i < channels.length; i++) {
      const validation = validateChannel(channels[i], i);
      
      if (validation.valid) {
        result.validChannels++;
        if (validation.channelId) {
          validChannelIds.add(validation.channelId);
        }
      } else {
        result.valid = false;
      }
      
      result.errors.push(...validation.errors);
      result.warnings.push(...validation.warnings);
      
      if (validation.errors.length > 0 || validation.warnings.length > 0) {
        result.details.channels.push(validation);
      }
    }
    
    // Validate programmes
    const programmes = Array.isArray(tv.programme) ? tv.programme : (tv.programme ? [tv.programme] : []);
    result.programmeCount = programmes.length;
    
    // Sample validation for large EPGs (validate first 100, last 100, and random sample)
    const indicesToValidate = new Set();
    
    if (programmes.length <= 200) {
      // Validate all if small
      for (let i = 0; i < programmes.length; i++) {
        indicesToValidate.add(i);
      }
    } else {
      // First 100
      for (let i = 0; i < 100; i++) {
        indicesToValidate.add(i);
      }
      // Last 100
      for (let i = programmes.length - 100; i < programmes.length; i++) {
        indicesToValidate.add(i);
      }
      // Random sample of 100
      for (let i = 0; i < 100; i++) {
        const idx = Math.floor(Math.random() * programmes.length);
        indicesToValidate.add(idx);
      }
    }
    
    let validatedCount = 0;
    let sampleValid = 0;
    
    for (const i of indicesToValidate) {
      if (i >= programmes.length) continue;
      
      const validation = validateProgramme(programmes[i], i, validChannelIds);
      validatedCount++;
      
      if (validation.valid) {
        sampleValid++;
      } else {
        result.valid = false;
      }
      
      result.errors.push(...validation.errors);
      result.warnings.push(...validation.warnings);
      
      if (validation.errors.length > 0 || validation.warnings.length > 0) {
        result.details.programmes.push(validation);
      }
    }
    
    // Estimate valid programmes based on sample
    if (programmes.length > 200 && validatedCount > 0) {
      const sampleRate = sampleValid / validatedCount;
      result.validProgrammes = Math.round(programmes.length * sampleRate);
    } else {
      result.validProgrammes = sampleValid;
    }
    
  } catch (err) {
    result.valid = false;
    result.errors.push(`Failed to parse EPG XML: ${err.message}`);
  }
  
  return result;
}

/**
 * Validate a merged EPG against current channels
 * @param {string} xmlString - XML content
 * @param {Array} channels - Array of channel objects
 * @returns {Object} Validation result with coverage info
 */
export function validateEPGCoverage(xmlString, channels) {
  const result = validateEPG(xmlString);
  
  if (!Array.isArray(channels)) {
    result.warnings.push('No channels provided for coverage check');
    return result;
  }
  
  try {
    const parsed = parser.parse(xmlString);
    const tv = parsed?.tv;
    
    if (!tv) return result;
    
    // Get all channel IDs from EPG
    const epgChannelIds = new Set();
    const epgChannels = Array.isArray(tv.channel) ? tv.channel : (tv.channel ? [tv.channel] : []);
    
    for (const ch of epgChannels) {
      if (ch['@_id']) {
        epgChannelIds.add(ch['@_id']);
      }
    }
    
    // Check coverage
    const channelsWithEPG = [];
    const channelsWithoutEPG = [];
    
    for (const channel of channels) {
      const tvgId = channel.tvg_id || channel.name;
      if (tvgId && epgChannelIds.has(tvgId)) {
        channelsWithEPG.push(channel);
      } else {
        channelsWithoutEPG.push(channel);
      }
    }
    
    result.coverage = {
      total: channels.length,
      withEPG: channelsWithEPG.length,
      withoutEPG: channelsWithoutEPG.length,
      percentage: channels.length > 0 ? Math.round((channelsWithEPG.length / channels.length) * 100) : 0,
      channelsWithoutEPG: channelsWithoutEPG.slice(0, 20).map(c => ({
        name: c.name,
        tvg_id: c.tvg_id || '',
        source: c.source || ''
      }))
    };
    
    if (channelsWithoutEPG.length > 0) {
      result.warnings.push(
        `${channelsWithoutEPG.length} channel(s) do not have EPG data`
      );
    }
    
  } catch (err) {
    result.warnings.push(`Failed to check EPG coverage: ${err.message}`);
  }
  
  return result;
}

export default {
  validateEPG,
  validateEPGCoverage
};
