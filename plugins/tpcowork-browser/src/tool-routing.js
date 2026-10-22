/** Which browser tool carries each command; shared by the Host tools and the run_code SDK. */
export const toolGroups = {
  browser_tabs: ['list', 'listUserTabs', 'newTab', 'activateTab', 'claimTab', 'close', 'finalizeTabs', 'markDeliverable', 'markHandoff', 'nameSession', 'browserVisibilityGet', 'browserVisibilitySet'],
  browser_navigate: ['navigate', 'back', 'forward', 'reload', 'getState'],
  browser_snapshot: ['snapshot'],
  browser_act: ['playwright', 'click', 'fill', 'type', 'press', 'cuaKeypress', 'scroll', 'cuaScroll', 'domCuaScroll', 'hover', 'select', 'check', 'drag', 'cuaDrag', 'elementInfo', 'evaluate', 'waitFor', 'playwrightWaitForTimeout'],
  browser_screenshot: ['screenshot'],
  browser_dialog: ['getDialog', 'handleDialog'],
  browser_download: ['playwright'],
  browser_viewport: ['browserViewportSet', 'browserViewportReset', 'getState'],
  browser_recording: ['recordingStart', 'recordingStatus', 'recordingCancel'],
};

const DOWNLOAD_ACTIONS = new Set(['downloadPath']);

/** Downloads have their own tool; every other Playwright action is a page action. */
export function isDownloadCommand(command) {
  const action = command?.action;
  return command?.method === 'playwright' && (DOWNLOAD_ACTIONS.has(action?.name)
    || (action?.name === 'waitForEvent' && action.event === 'download')
    || (action?.name === 'locator' && action.operation === 'downloadMedia'));
}

/** The tool that executes this command, or undefined for commands no tool exposes. */
export function toolForCommand(command) {
  if (isDownloadCommand(command)) return 'browser_download';
  if (command?.method === 'getState') return 'browser_navigate';
  for (const [tool, methods] of Object.entries(toolGroups)) if (tool !== 'browser_download' && methods.includes(command?.method)) return tool;
  return undefined;
}
