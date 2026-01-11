# Testing Guide

This document describes how to run tests and use code quality tools for the IPTV Proxy project.

## Running Tests

### Run All Tests

```bash
npm test
```

This will run all unit and integration tests using Mocha.

### Run Tests in Watch Mode

```bash
npm run test:watch
```

This will automatically re-run tests when files change.

### Test Coverage (Future)

```bash
npm run test:coverage
```

_Note: Coverage reporting with c8 is configured but requires additional setup._

## Test Structure

Tests are organized in the `test/` directory:

```
test/
├── unit/              # Unit tests for individual functions
│   └── parseM3U.test.js
├── integration/       # Integration tests with mocked dependencies
│   ├── epg.test.js
│   └── parseM3U.test.js
├── fixtures/          # Test data files
│   ├── valid-playlist.m3u
│   ├── malformed-playlist.m3u
│   └── valid-epg.xml
├── validators.test.js # Output format validation tests
└── helpers.js         # Test utilities and helper functions
```

## Code Quality Tools

### Linting with ESLint

Check code for lint issues:

```bash
npm run lint
```

Auto-fix lint issues where possible:

```bash
npm run lint:fix
```

#### ESLint Configuration

- Configuration: `eslint.config.js` (Flat Config)
- Supports JavaScript/ESM and Vue.js files
- Rules are set to 'warn' for style issues to not block CI

### Code Formatting with Prettier

Check if code is formatted correctly:

```bash
npm run format:check
```

Auto-format all code:

```bash
npm run format
```

#### Prettier Configuration

- Configuration: `.prettierrc.json`
- Settings:
  - Single quotes
  - 2-space indentation
  - 100 character line width
  - Semicolons required
  - ES5 trailing commas

## Writing Tests

### Unit Tests

Unit tests focus on testing individual functions in isolation:

```javascript
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { applyMapping } from '../../scripts/parseM3U.js';

describe('M3U Parser - applyMapping', () => {
  it('should apply mapping by channel name', () => {
    const channel = { name: 'Test Channel', tvg_id: 'test.1' };
    const mapping = { 'Test Channel': { name: 'Mapped Channel' } };
    
    const result = applyMapping(channel, mapping);
    
    expect(result.name).to.equal('Mapped Channel');
  });
});
```

### Integration Tests

Integration tests test multiple components working together, often with mocked HTTP requests:

```javascript
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';

describe('M3U Parser Integration', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should mock M3U playlist fetch successfully', async () => {
    nock('http://test.example.com')
      .get('/playlist.m3u')
      .reply(200, '#EXTM3U\n...');

    // Test code here
  });
});
```

### Test Helpers

Use the helper functions in `test/helpers.js`:

```javascript
import { generateM3UPlaylist, generateXMLTV, createMockChannel } from './helpers.js';

// Generate test M3U data
const m3u = generateM3UPlaylist([
  {
    name: 'Channel 1',
    tvg_id: 'ch1',
    url: 'http://example.com/stream1',
  },
]);

// Generate test XMLTV data
const xml = generateXMLTV(
  [{ id: 'ch1', name: 'Channel 1' }],
  [{ channel: 'ch1', start: '...', stop: '...', title: 'Show' }]
);
```

## Output Format Validation

The project includes validators for M3U and XMLTV formats:

```javascript
import { validateM3UFormat, validateXMLTVFormat } from './test/validators.test.js';

const m3uResult = validateM3UFormat(m3uContent);
console.log('Valid:', m3uResult.isValid);
console.log('Errors:', m3uResult.errors);
console.log('Warnings:', m3uResult.warnings);

const xmlResult = validateXMLTVFormat(xmlContent);
console.log('Valid:', xmlResult.isValid);
console.log('Channels:', xmlResult.channelCount);
console.log('Programmes:', xmlResult.programmeCount);
```

These validators are also run in CI to ensure output format compliance.

## Continuous Integration

Tests and code quality checks run automatically in GitHub Actions:

1. **Lint and Security Checks**: Runs ESLint and Prettier checks
2. **Tests**: Runs all unit and integration tests
3. **Format Validation**: Validates M3U and XMLTV output formats

See `.github/workflows/ci.yml` for the complete CI configuration.

## Best Practices

1. **Write tests for new features**: Add unit tests for new functions and integration tests for new workflows
2. **Mock external dependencies**: Use `nock` to mock HTTP requests in tests
3. **Use descriptive test names**: Test names should clearly describe what is being tested
4. **Keep tests focused**: Each test should verify one specific behavior
5. **Use fixtures for complex data**: Store test data files in `test/fixtures/`
6. **Clean up after tests**: Use `beforeEach` and `afterEach` hooks to set up and tear down test state

## Coverage Goals (Future)

While not currently enforced, aim for:

- **Unit tests**: 80%+ coverage of core logic
- **Integration tests**: Cover all major workflows
- **Format validation**: 100% of output formats validated

## Troubleshooting

### Tests Failing

- Check that dependencies are installed: `npm ci`
- Clear any cached data: `rm -rf data/`
- Check test output for specific errors

### Linting Errors

- Run `npm run lint:fix` to auto-fix common issues
- Consult `eslint.config.js` for rule configuration

### Formatting Issues

- Run `npm run format` to auto-format code
- Check `.prettierrc.json` for style configuration
