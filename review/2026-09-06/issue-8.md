The stream route's response-close cleanup unregisters usage but never destroys or aborts the upstream request/body. A viewer disconnect can leave a paused live stream holding a tuner/provider connection. checkStream() in scripts/check-channel-health.js removes data listeners after its byte/time budget but likewise never destroys the GET body. Repeated scheduled probes can retain connections. The image proxy has similar missing cancellation/error cleanup.

Code: [server/lineup.js#L451-L540](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/lineup.js#L451-L540). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Static lifecycle review of server/lineup.js, scripts/check-channel-health.js:checkStream, and libs/proxy-image.js. Existing playback tests mainly inspect response payloads rather than upstream close events.

Acceptance criteria:

- [ ] Propagate downstream cancellation to both pending fetches and established upstream bodies.
- [ ] Destroy health-probe bodies in finally after success, timeout, and error; ensure error bodies are also released.
- [ ] Make cleanup idempotent and preserve accurate usage tracking.
- [ ] Add streaming-server tests that assert upstream sockets close after client abort/probe completion and that repeated probes do not grow active connections.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
