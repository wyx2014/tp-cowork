<!-- Modified for DSH (2026-10-21): run_code programs, explicit returns and automatic image attachment. -->
# Screenshots

This is lookup-only guidance. Do not use it for ordinary navigation, reading, search, or form interaction when a DOM snapshot answers the question.

Capture a screenshot only when the user explicitly requests one, visual layout/rendering/image content must be judged, or the required target is absent from the DOM snapshot. Do not request a snapshot and screenshot together by default.

`await tab.screenshot(opts?)` returns PNG bytes as `Uint8Array`. Each successful screenshot is attached to your next step as an image automatically after the `run_code` program finishes. The bytes themselves are not a model-visible image: never return or `console.log` them.

```js
await tab.screenshot();
return "captured";
```

Supported screenshot options:

- `{ fullPage: true }` captures the whole page.
- `{ clip: { x, y, width, height } }` captures a viewport region.

If a screenshot times out, do not immediately issue the same screenshot again. The underlying Chromium
capture may still be completing; wait before retrying, or reopen the tab if the explicit in-flight error
does not clear.
