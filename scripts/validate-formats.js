#!/usr/bin/env node
/**
 * CI validation script for M3U and XMLTV output formats
 * This script validates test fixtures to ensure format compliance
 */

import { validateM3UFormat, validateXMLTVFormat } from '../libs/format-validators.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');

let hasErrors = false;

// Validate M3U fixtures
console.log('Validating M3U format...');
try {
  const m3uPath = path.join(FIXTURES_DIR, 'valid-playlist.m3u');
  const m3uContent = fs.readFileSync(m3uPath, 'utf8');
  const m3uResult = validateM3UFormat(m3uContent);

  console.log('M3U Validation Result:');
  console.log(`  Valid: ${m3uResult.isValid}`);
  console.log(`  Channels: ${m3uResult.channelCount}`);

  if (m3uResult.errors.length > 0) {
    console.error('  Errors:');
    m3uResult.errors.forEach(err => console.error(`    - ${err}`));
    hasErrors = true;
  }

  if (m3uResult.warnings.length > 0) {
    console.warn('  Warnings:');
    m3uResult.warnings.forEach(warn => console.warn(`    - ${warn}`));
  }

  if (m3uResult.isValid) {
    console.log('✅ M3U format validation passed\n');
  } else {
    console.error('❌ M3U format validation failed\n');
  }
} catch (err) {
  console.error('❌ M3U validation error:', err.message);
  hasErrors = true;
}

// Validate XMLTV fixtures
console.log('Validating XMLTV format...');
try {
  const xmlPath = path.join(FIXTURES_DIR, 'valid-epg.xml');
  const xmlContent = fs.readFileSync(xmlPath, 'utf8');
  const xmlResult = validateXMLTVFormat(xmlContent);

  console.log('XMLTV Validation Result:');
  console.log(`  Valid: ${xmlResult.isValid}`);
  console.log(`  Channels: ${xmlResult.channelCount}`);
  console.log(`  Programmes: ${xmlResult.programmeCount}`);

  if (xmlResult.errors.length > 0) {
    console.error('  Errors:');
    xmlResult.errors.forEach(err => console.error(`    - ${err}`));
    hasErrors = true;
  }

  if (xmlResult.warnings.length > 0) {
    console.warn('  Warnings:');
    xmlResult.warnings.forEach(warn => console.warn(`    - ${warn}`));
  }

  if (xmlResult.isValid) {
    console.log('✅ XMLTV format validation passed\n');
  } else {
    console.error('❌ XMLTV format validation failed\n');
  }
} catch (err) {
  console.error('❌ XMLTV validation error:', err.message);
  hasErrors = true;
}

// Exit with error code if validation failed
if (hasErrors) {
  console.error('Format validation failed!');
  process.exit(1);
} else {
  console.log('All format validations passed!');
  process.exit(0);
}
