Windows launches ffmpeg through cmd.exe /c, passing the upstream URL through shell parsing; ordinary query-string metacharacters can alter the command. stdout handlers ignore res.write() backpressure and stderrText grows without a limit. The per-minute request limiter is not an active-process limit, and no startup/idle deadline or process registry bounds long-lived workers.

Code: [server/transcode.js#L85-L144](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/transcode.js#L85-L144). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Static review of the platform spawn branch and stream handlers; an actual ffmpeg process was not launched during review.

Acceptance criteria:

- [ ] Resolve and spawn the ffmpeg executable directly on Windows as well as other platforms; test URLs containing ampersands, percent escapes, and spaces.
- [ ] Respect response backpressure, cap retained stderr, and handle stdout/stderr errors.
- [ ] Enforce explicit active-worker and startup/idle limits; clean up the process on disconnect and shutdown.
- [ ] Add child-process fixture tests for slow clients, stalled ffmpeg, capacity exhaustion, and cancellation without requiring a real tuner.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
