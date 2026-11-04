import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import yaml from 'yaml';

const workflow = yaml.parse(
  fs.readFileSync(
    new URL('../../.github/workflows/openclaw-github-events.yml', import.meta.url),
    'utf8'
  )
);
const script = workflow.jobs['notify-openclaw'].steps[0].run
  .replace(/^node <<'NODE'\n/, '')
  .replace(/\nNODE\s*$/, '');

async function runNotification({
  actor = 'maintainer',
  eventName = 'pull_request',
  fork = false,
  token = '',
  status = 200,
} = {}) {
  const requests = [];
  const exits = [];
  const messages = [];
  const event = {
    repository: { full_name: 'owner/repo' },
    ...(eventName.startsWith('pull_request')
      ? {
          pull_request: {
            number: 1,
            head: { repo: { full_name: fork ? 'contributor/repo' : 'owner/repo' } },
          },
        }
      : {}),
    ...(eventName === 'workflow_run'
      ? { workflow_run: { name: 'CI', conclusion: 'failure' } }
      : {}),
  };
  await vm.runInNewContext(script, {
    require: name => {
      if (name !== 'node:fs') throw new Error(`Unexpected module: ${name}`);
      return { readFileSync: () => JSON.stringify(event) };
    },
    process: {
      env: {
        GITHUB_ACTOR: actor,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_REPOSITORY: 'owner/repo',
        OPENCLAW_HOOKS_TOKEN: token,
        OPENCLAW_WORKFLOW_NAME: 'OpenClaw GitHub Events',
      },
      exit: code => exits.push(code),
    },
    console: {
      log: message => messages.push(String(message)),
      error: message => messages.push(String(message)),
    },
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return { ok: status === 200, status, text: async () => 'test response' };
    },
  });
  return { requests, exits, messages };
}

describe('OpenClaw workflow credential handling', () => {
  for (const eventName of ['pull_request', 'pull_request_review', 'pull_request_review_comment']) {
    it(`skips secretless Dependabot ${eventName} events without sending a request`, async () => {
      const result = await runNotification({ actor: 'dependabot[bot]', eventName });
      expect(result.requests).to.have.lengthOf(0);
      expect(result.exits).to.deep.equal([]);
      expect(result.messages.join('\n')).to.include('Skipping');
    });
  }

  it('skips secretless fork pull requests without sending a request', async () => {
    const result = await runNotification({ fork: true });
    expect(result.requests).to.have.lengthOf(0);
    expect(result.exits).to.deep.equal([]);
  });

  for (const eventName of ['pull_request', 'workflow_dispatch', 'workflow_run']) {
    it(`fails visibly when a trusted ${eventName} context is missing its token`, async () => {
      const result = await runNotification({ eventName });
      expect(result.requests).to.have.lengthOf(0);
      expect(result.exits).to.deep.equal([1]);
      expect(result.messages.join('\n')).to.include('OPENCLAW_HOOKS_TOKEN');
    });
  }

  it('still authenticates supported events when a token is available', async () => {
    const result = await runNotification({ actor: 'dependabot[bot]', token: 'test-token' });
    expect(result.requests).to.have.lengthOf(1);
    expect(result.requests[0].headers.Authorization).to.equal('Bearer test-token');
    expect(result.exits).to.deep.equal([]);
  });

  it('keeps remote authentication failures visible', async () => {
    const result = await runNotification({ token: 'test-token', status: 403 });
    expect(result.exits).to.deep.equal([1]);
    expect(result.messages.join('\n')).to.include('HTTP 403');
  });
});
