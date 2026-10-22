<!-- Modified for TPCowork (2026-09-21): product naming and integration; see UPSTREAM.md. -->
<!-- Modified for DSH (2026-10-21): run_code programs, explicit returns and automatic image attachment. -->
# In-app Browser video recording

`Tab.recording` records the controlled IAB tab's existing WebView. It does not launch Playwright or
another Chromium process. The API is asynchronous so a recording can continue across fresh
`run_code` programs.

```js
const job = await tab.recording.start({
  viewport: { width: 1280, height: 720 },
  fps: 25,
  maxDurationMs: 20_000,
  settleMs: 800,
  showCursor: true,
  actions: [
    { type: "move", x: 300, y: 240, durationMs: 500 },
    { type: "click", selector: "#start", delayAfterMs: 1000 },
    { type: "scroll", deltaY: 600, durationMs: 800 },
  ],
});
return job;
```

Keep `job.id`. In a later fresh `run_code` program, bootstrap Browser Use again, return the complete tab
list in a dedicated program, then recover the verified target tab. Poll without an output path while the job
is running. On the final poll, pass a workspace-relative `.webm` path:

```js
return await tab.recording.status(recordingId, {
  outputPath: "recordings/demo.webm",
});
```

The phases are `preparing → capturing → finalizing → completed`. Only a completed status with
`artifact.path` is a deliverable; that path has been materialized into the active local or remote
workspace. Call `tab.recording.cancel(recordingId)` when the take is no longer needed.

Actions are a restricted data-only DSL: `wait`, `click`, `type`, `hover`, `move`, `scroll`, `scrollTo`,
`wheel`, `drag`, and `waitFor`. Do not put page code in recording actions. Derive selectors from the
latest DOM snapshot; use coordinates only for visually verified canvas/custom controls. One tab may
have only one active recording. The hard duration limit is 90 seconds.

Recording keeps a hidden IAB rendering surface alive during capture and releases it before finalizing
the WebM stream. The desktop uses Electron's built-in Chromium `MediaRecorder`; recording does not require
FFmpeg or any executable on the application PATH.
