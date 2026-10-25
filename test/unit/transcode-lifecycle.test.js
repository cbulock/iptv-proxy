import { describe, it, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { setupTranscodeRoutes } from '../../server/transcode.js';

function response() {
  const res = new EventEmitter();
  Object.assign(res, {
    writable: true,
    writableEnded: false,
    headersSent: false,
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.headersSent = true;
      this.end();
      return this;
    },
    send(body) {
      this.body = body;
      this.end();
      return this;
    },
    end() {
      this.writableEnded = true;
    },
    write() {
      this.headersSent = true;
      return true;
    },
  });
  return res;
}
function worker() {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 1234,
    exitCode: null,
    killed: false,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    signals: [],
    kill(signal) {
      this.killed = true;
      this.signals.push(signal);
      return true;
    },
  });
  return child;
}

describe('Transcode worker lifetime', () => {
  afterEach(() => sinon.restore());
  function fixture() {
    let handler;
    const children = [];
    setupTranscodeRoutes(
      {
        get(path, ...handlers) {
          handler = handlers.at(-1);
        },
      },
      {
        spawn: () => {
          const child = worker();
          children.push(child);
          return child;
        },
        getChannels: () => [{ source: 'test', name: 'one', original_url: 'http://secret/token' }],
        maxWorkers: 1,
      }
    );
    const request = () => {
      const req = new EventEmitter();
      req.params = { source: 'test', name: 'one' };
      const res = response();
      handler(req, res);
      return { req, res };
    };
    return { children, request };
  }
  it('keeps a disconnected worker counted until close and forces SIGKILL despite killed flag', () => {
    const clock = sinon.useFakeTimers();
    const { request, children } = fixture();
    const first = request();
    first.req.emit('close');
    expect(children[0].signals).to.deep.equal([]);
    first.res.emit('close');
    expect(children[0].signals).to.deep.equal(['SIGTERM']);
    expect(request().res.statusCode).to.equal(503);
    clock.tick(5000);
    expect(children[0].signals).to.deep.equal(['SIGTERM', 'SIGKILL']);
    children[0].emit('exit', null, 'SIGKILL');
    expect(request().res.statusCode).to.equal(503);
    children[0].emit('close', null, 'SIGKILL');
    expect(request().res.statusCode).to.equal(200);
    children[1].emit('close', 0, null);
  });
  it('returns safe capacity and startup timeout codes after 15 seconds', () => {
    const clock = sinon.useFakeTimers();
    const { request, children } = fixture();
    const first = request();
    expect(request().res.body.code).to.equal('TRANSCODE_CAPACITY');
    clock.tick(14999);
    expect(first.res.body).to.equal(undefined);
    clock.tick(1);
    expect(first.res.statusCode).to.equal(504);
    expect(first.res.body.code).to.equal('TRANSCODE_STARTUP_TIMEOUT');
    expect(JSON.stringify(first.res.body)).not.to.include('secret');
    clock.tick(5000);
    expect(children[0].signals).to.deep.equal(['SIGTERM', 'SIGKILL']);
    children[0].emit('close', null, 'SIGKILL');
  });
  it('releases capacity on spawn failure, but not a kill error from a live process', () => {
    const { request, children } = fixture();
    const first = request();
    children[0].pid = undefined;
    children[0].emit('error', Object.assign(new Error('secret'), { code: 'ENOENT' }));
    expect(first.res.statusCode).to.equal(503);
    expect(first.res.body.code).to.equal('TRANSCODE_UNAVAILABLE');
    const second = request();
    children[1].emit('error', new Error('kill failed'));
    expect(request().res.statusCode).to.equal(503);
    children[1].emit('close', 1, null);
    expect(second.res.body).not.to.have.property('details');
  });
});
