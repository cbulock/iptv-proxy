import { createGunzip } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';

const fragmentParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/**
 * Decode a gzip XMLTV stream when the caller has identified it as compressed.
 * Piping preserves Node's normal backpressure semantics; consumers can await
 * each chunk instead of accumulating the response in a string.
 *
 * @param {import('node:stream').Readable} input
 * @param {boolean} compressed
 */
export function decodeXmltvStream(input, compressed = false) {
  if (!compressed) return input;
  const gunzip = createGunzip();
  input.pipe(gunzip);
  return gunzip;
}

/**
 * Read only complete XMLTV channel/programme elements from a readable stream.
 * This deliberately does not construct a document-wide parser object: the
 * retained memory is the selected records plus one currently-open element.
 * XMLTV uses non-nested channel/programme records, so element framing is safe
 * here and lets fast-xml-parser keep handling XML entities and child fields.
 *
 * @param {import('node:stream').Readable} input
 * @param {{maxBytes?: number, maxElementBytes?: number}} [limits]
 * @returns {Promise<{channels: Array, programmes: Array, bytes: number}>}
 */
export async function readXmltvRecords(input, limits = {}) {
  const maxBytes = limits.maxBytes ?? 64 * 1024 * 1024;
  const maxElementBytes = limits.maxElementBytes ?? 1024 * 1024;
  const channels = [];
  const programmes = [];
  let bytes = 0;
  let buffer = '';
  let activeType = null;
  let sawTvRoot = false;

  for await (const chunk of input) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) {
      throw new Error(`XMLTV input exceeds the ${maxBytes}-byte limit`);
    }
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (/<tv(?=[\s>])/i.test(buffer)) sawTvRoot = true;

    while (buffer.length > 0) {
      if (!activeType) {
        const match = /<(channel|programme)(?=[\s>])/i.exec(buffer);
        if (!match) {
          // Retain a small suffix in case the next chunk finishes a tag name.
          buffer = buffer.slice(-16);
          break;
        }
        buffer = buffer.slice(match.index);
        activeType = match[1].toLowerCase();
      }

      const closeTag = `</${activeType}>`;
      const openingEnd = buffer.indexOf('>');
      const selfClosing = openingEnd !== -1 && /\/\s*$/.test(buffer.slice(0, openingEnd));
      const closeIndex = selfClosing ? -1 : buffer.toLowerCase().indexOf(closeTag);
      const endIndex = selfClosing ? openingEnd + 1 : closeIndex === -1 ? -1 : closeIndex + closeTag.length;

      if (endIndex === -1) {
        if (Buffer.byteLength(buffer) > maxElementBytes) {
          throw new Error(`XMLTV ${activeType} element exceeds the ${maxElementBytes}-byte limit`);
        }
        break;
      }

      const fragment = buffer.slice(0, endIndex);
      buffer = buffer.slice(endIndex);
      const type = activeType;
      activeType = null;
      let parsed;
      try {
        parsed = fragmentParser.parse(`<tv>${fragment}</tv>`);
      } catch (error) {
        throw new Error(`XMLTV ${type} parsing failed: ${error.message}`);
      }
      const record = parsed?.tv?.[type];
      if (record) (type === 'channel' ? channels : programmes).push(record);
    }
  }

  if (!sawTvRoot) throw new Error('Invalid XMLTV structure - missing <tv> root element');
  if (activeType) {
    throw new Error(`Incomplete XMLTV ${activeType} element`);
  }
  return { channels, programmes, bytes };
}
