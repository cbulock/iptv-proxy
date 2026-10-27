import { describe, it } from 'mocha';
import { expect } from 'chai';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { decodeXmltvStream, readXmltvRecords } from '../../server/xmltv-stream.js';

function source(parts) {
  return Readable.from(parts.map(part => Buffer.from(part)));
}

describe('streaming XMLTV ingestion', () => {
  it('parses records split across chunks without buffering a full document', async () => {
    const records = await readXmltvRecords(
      source([
        '<?xml version="1.0"?><tv><channel id="one"><display-name>One</display-name></channel>',
        '<programme channel="one" start="20260101000000 +0000"><title>Show</title></programme></tv>',
      ])
    );
    expect(records.channels).to.have.length(1);
    expect(records.channels[0]['@_id']).to.equal('one');
    expect(records.programmes[0]['@_channel']).to.equal('one');
    expect(records.programmes[0].title).to.equal('Show');
  });

  it('handles gzip-compressed XMLTV streams', async () => {
    const xml = '<tv><channel id="one"/><programme channel="one" start="20260101000000 +0000"><title>Zipped</title></programme></tv>';
    const records = await readXmltvRecords(decodeXmltvStream(source([gzipSync(xml)]), true));
    expect(records.channels).to.have.length(1);
    expect(records.programmes[0].title).to.equal('Zipped');
  });

  it('processes a representative large feed delivered in small chunks', async () => {
    const programme = '<programme channel="one" start="20260101000000 +0000"><title>Show</title></programme>';
    const records = await readXmltvRecords(source(['<tv>', ...Array(1000).fill(programme), '</tv>']));
    expect(records.programmes).to.have.length(1000);
    expect(records.bytes).to.be.greaterThan(80 * 1024);
  });

  it('enforces a decoded input limit on large feeds', async () => {
    const xml = `<tv>${'<programme channel="one" start="20260101000000 +0000"><title>x</title></programme>'.repeat(500)}</tv>`;
    try {
      await readXmltvRecords(source([xml]), { maxBytes: 1024 });
      expect.fail('Expected input size rejection');
    } catch (error) {
      expect(error.message).to.include('XMLTV input exceeds');
    }
  });
});
