import { describe, it } from 'mocha';
import { expect } from 'chai';
import { parseXMLTVDate, extractTextField } from '../../server/epg.js';

describe('EPG Utility Functions', () => {
  describe('parseXMLTVDate', () => {
    it('parses a basic UTC date string', () => {
      const d = parseXMLTVDate('20240115143000 +0000');
      expect(d).to.be.an.instanceOf(Date);
      expect(d.toISOString()).to.equal('2024-01-15T14:30:00.000Z');
    });

    it('parses a positive timezone offset', () => {
      const d = parseXMLTVDate('20240115143000 +0500');
      expect(d).to.be.an.instanceOf(Date);
      // 14:30 local +05:00 = 09:30 UTC
      expect(d.toISOString()).to.equal('2024-01-15T09:30:00.000Z');
    });

    it('parses a negative timezone offset', () => {
      const d = parseXMLTVDate('20240115143000 -0500');
      expect(d).to.be.an.instanceOf(Date);
      // 14:30 local -05:00 = 19:30 UTC
      expect(d.toISOString()).to.equal('2024-01-15T19:30:00.000Z');
    });

    it('parses a date string without a timezone offset', () => {
      const d = parseXMLTVDate('20240115143000');
      expect(d).to.be.an.instanceOf(Date);
      expect(d.toISOString()).to.equal('2024-01-15T14:30:00.000Z');
    });

    it('returns null for an empty string', () => {
      expect(parseXMLTVDate('')).to.be.null;
    });

    it('returns null for null input', () => {
      expect(parseXMLTVDate(null)).to.be.null;
    });

    it('returns null for undefined input', () => {
      expect(parseXMLTVDate(undefined)).to.be.null;
    });

    it('returns null for a non-date string', () => {
      expect(parseXMLTVDate('not-a-date')).to.be.null;
    });

    it('handles a numeric input by converting to string first', () => {
      // Should not match the pattern and return null
      expect(parseXMLTVDate(12345)).to.be.null;
    });

    it('handles a half-hour timezone offset', () => {
      const d = parseXMLTVDate('20240115120000 +0530');
      expect(d).to.be.an.instanceOf(Date);
      // 12:00 local +05:30 = 06:30 UTC
      expect(d.toISOString()).to.equal('2024-01-15T06:30:00.000Z');
    });
  });

  describe('extractTextField', () => {
    it('returns an empty string for null', () => {
      expect(extractTextField(null)).to.equal('');
    });

    it('returns an empty string for undefined', () => {
      expect(extractTextField(undefined)).to.equal('');
    });

    it('returns the string itself when given a plain string', () => {
      expect(extractTextField('Hello World')).to.equal('Hello World');
    });

    it('coerces non-string primitives to strings', () => {
      expect(extractTextField(42)).to.equal('42');
    });

    it('extracts #text from a fast-xml-parser text object', () => {
      expect(extractTextField({ '#text': 'My Title', '@_lang': 'en' })).to.equal('My Title');
    });

    it('returns empty string when object has no #text property', () => {
      // e.g. <title lang="en"/> with no text content — avoids "[object Object]"
      expect(extractTextField({ '@_lang': 'en' })).to.equal('');
    });

    it('returns empty string for an empty object', () => {
      expect(extractTextField({})).to.equal('');
    });

    it('handles #text being 0 (falsy but valid)', () => {
      expect(extractTextField({ '#text': 0 })).to.equal('0');
    });

    it('returns empty string when #text is null', () => {
      expect(extractTextField({ '#text': null })).to.equal('');
    });

    it('extracts text from the first element of an array', () => {
      expect(extractTextField(['First', 'Second'])).to.equal('First');
    });

    it('extracts #text from an array of objects', () => {
      expect(extractTextField([{ '#text': 'Array Title', '@_lang': 'en' }])).to.equal('Array Title');
    });

    it('returns empty string for an empty array', () => {
      expect(extractTextField([])).to.equal('');
    });
  });
});
