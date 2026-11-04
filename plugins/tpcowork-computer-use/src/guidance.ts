/** Model guidance for the shared CUA object API on Windows, macOS and Linux, with ZCode's Computer Use rules. */
export const DESCRIPTION = 'Read or operate native desktop applications on this computer (Windows, macOS or Linux X11). Select an app with getApp, keep its appHandle, observe with getState, act by element index from the latest observation, then read fresh state to verify.'

export function guidance(platform: string): string {
  const chord = platform === 'darwin' ? 'cmd' : 'ctrl'
  const system = platform === 'win32' ? 'Windows (UI Automation)' : platform === 'darwin' ? 'macOS (Accessibility)' : 'Linux X11 (AT-SPI)'
  return `Computer Use reads and operates native apps on the user's ${system} desktop through the cua tool and its object API.

When to use it: only when a task needs a native desktop app's own UI. Prefer a dedicated connector, API, command-line tool or skill when one can do the job, and use Browser Use for anything inside a web page. Do not switch to scripting or other UI-automation technology (PowerShell UI scripts, AppleScript/osascript, xdotool) unless the user asks for it. Main agent only: never delegate Computer Use to a subagent.

Start: cua.getCapabilities() reports the platform and whether accessibility access is available. If it is not, or an operation reports PERMISSION_DENIED, stop and tell the user what to enable${platform === 'darwin' ? ' (System Settings → Privacy & Security → Accessibility and Screen Recording, for TP Cowork)' : platform === 'linux' ? ' (an X11 session with accessibility/AT-SPI enabled)' : ''}; after they grant it, observe again before any input.

Choosing the app: when the user names an application, pass that name to cua.getApp exactly as written — do not translate, shorten or normalise it ("记事本" is not "Notepad"). If it does not resolve, call cua.listApps() or cua.findApps(query) once and use a returned id. getApp asks the user for consent before reading, launching or controlling that app; if they refuse, stop using that app and never work around the refusal. getApp also launches a stopped app. AMBIGUOUS_APP lists the processes: pass the pid.

The loop: observe once, act, observe again before deciding the next step. app.getAXState() returns the accessibility tree; every actionable row carries [index]. Accessibility is the primary path — it is precise and works on background windows without stealing focus:
1. Find the target in the tree by role, name, value or label and act on it by index: app.click(index), app.setValue(index, text), app.performSecondaryAction(index, "showMenu").
2. For a settable field prefer setValue over typing. Use typeText/pressKey only when no element expresses the operation. Keyboard chords use ${chord} (e.g. pressKey("${chord}+s")).
3. Coordinates are the last resort (canvas, games, content the tree cannot see): take app.getScreenshot(), choose [x, y] in that image's pixels, and click([x, y]). Never derive coordinates from tree bounds.
Indices belong to the newest observation of that window; observing renumbers them. STALE_SNAPSHOT means read state again; STALE_APP means call getApp again; WINDOW_CHANGED means the window changed — observe before retrying.

Background and focus: actions are delivered to background windows where the platform allows. FOREGROUND_REQUIRED means this input can only reach the focused window: call app.activate() (or app.show()), observe, then retry the input. Do not activate apps otherwise. hover and selectText are not available on this platform; use click, setValue or keyboard input instead.

Results: actions return { dispatched: true, verified: false } — accepted, not proven. Re-observe to confirm the change landed; repeat another approach if it did not. Never replay uncertain input after a cancellation or error without observing first. Persist until the requested state is visibly present, or report the concrete blocker.

Object API (all methods async; observations display their result and also return it — pass { emit: false } to only receive the value):
- cua.getCapabilities(), cua.listApps(), cua.findApps(query), cua.getState(), cua.getApp(selector) -> App
- app.getAXState(), app.getScreenshot(), app.getAXStateAndScreenshot(), app.getWindows(), app.getWindow(windowId) -> Window
- app.click(index | [x, y], { mouseButton, clickCount, modifiers, relative }), app.setValue(index, value), app.performSecondaryAction(index, action)
- app.typeText(text), app.pressKey(chord), app.paste(text), app.scroll({ x, y, deltaLinesX, deltaLinesY }), app.drag([x1, y1], [x2, y2]), app.activate(), app.show()
Raw tool calls use cua with { method, params } and the appHandle returned by getApp.`
}
