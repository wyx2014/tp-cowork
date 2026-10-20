export const pluginMeta = {
  zh: {
    title: '@tpcowork/dsh-browser',
    description: '浏览器能力层：连接网页操作工具、右侧可见页面与 Electron 桌面桥接，管理标签归属、持久登录、人工接管、截图和下载。助手与用户操作同一页面，网页能力可以独立启停。',
  },
  en: {
    title: '@tpcowork/dsh-browser',
    description: 'Browser capability layer: connects web tools, visible sidebar pages and the Electron desktop bridge. Owns tab access, persistent logins, manual takeover, screenshots and downloads so the assistant and user share the same pages as an independently managed capability.',
  },
};

export const zh = {
  browser_tabs: '管理浏览器标签页', browser_navigate: '浏览网页', browser_snapshot: '读取页面', browser_act: '操作页面', browser_screenshot: '截取页面', browser_dialog: '处理网页对话框', browser_download: '下载文件', browser_viewport: '调整网页尺寸', browser_recording: '录制网页',
  showPage: '查看页面', openArtifact: '打开文件', details: '调用详情', result: '操作结果', imageUnavailable: '截图暂时无法加载',
  title: '浏览器', tabs: '页面', save: '保存录屏', description: '保存登录，与你一起浏览网页', address: '输入网址', go: '访问', back: '后退', forward: '前进', reload: '刷新', external: '在系统浏览器打开',
  newTab: '新建标签页', loading: '正在加载网页…', empty: '输入网址开始浏览。登录信息会自动保存。', unavailable: '浏览器插件尚未就绪，请确认桌面桥接已安装并启用插件。',
  takeover: '手动接管', resume: '交还给助手', manual: '你正在控制此页面', automation: '助手正在操作', ready: '登录信息自动保存', responsive: '响应式视口', width: '宽', height: '高', fit: '适应窗口', normal: '跟随窗口', apply: '应用',
  restore: '恢复页面', close: '关闭', error: '操作未完成', settings: '浏览器', settingsIntro: '此应用中的会话和工作区共享网站登录信息。',
  import: '从 Chrome 导入登录', importHelp: '导入 Chrome 的 Cookie 和网站本地存储。macOS 可能请求钥匙串访问。', imported: '导入结果',
  clearCache: '清理缓存', clearAll: '清除全部网站数据', clearConfirm: '清除全部 Cookie、网站存储和权限？网页将关闭，并退出网站登录。', confirm: '确认清除', cancel: '取消', done: '已完成', busy: '处理中…',
  permissions: '网站权限', noPermissions: '网站请求权限时，你可以选择允许或拒绝。', ask: '每次询问', allow: '允许', deny: '拒绝', remember: '记住此选择', permissionRequest: '网站请求权限',
  downloads: '下载', noDownloads: '还没有下载文件', reveal: '在文件夹中显示', completed: '已完成', interrupted: '已中断', progressing: '下载中', cancelled: '已取消',
  record: '录制', recording: '正在录制', recordSeconds: '录制时长（秒）', stopRecord: '取消录制', recordReady: '录屏已完成', screenshot: '截图', permissionMedia: '摄像头与麦克风', importUnavailable: '未找到可导入的数据，请确认 Chrome 已安装并登录网站。', importDenied: '钥匙串访问未获授权，可重新导入或在此浏览器登录。', importPartial: '部分网站数据未能导入，这些网站需要重新登录。',
};
export const en = {
  browser_tabs: 'Browser tabs', browser_navigate: 'Browse page', browser_snapshot: 'Read page', browser_act: 'Operate page', browser_screenshot: 'Capture page', browser_dialog: 'Page dialog', browser_download: 'Download file', browser_viewport: 'Resize page', browser_recording: 'Record page',
  showPage: 'Show page', openArtifact: 'Open file', details: 'Call details', result: 'Result', imageUnavailable: 'Screenshot could not be loaded',
  title: 'Browser', tabs: 'Pages', save: 'Save recording', description: 'Browse together with saved logins', address: 'Enter a URL', go: 'Go', back: 'Back', forward: 'Forward', reload: 'Reload', external: 'Open in system browser',
  newTab: 'New tab', loading: 'Loading page…', empty: 'Enter a URL to browse. Website logins are saved automatically.', unavailable: 'Browser is not ready. Install the matching desktop bridge and enable the plugin.',
  takeover: 'Take control', resume: 'Return to assistant', manual: 'You control this page', automation: 'Assistant is browsing', ready: 'Logins saved automatically', responsive: 'Responsive viewport', width: 'Width', height: 'Height', fit: 'Fit', normal: 'Follow window', apply: 'Apply',
  restore: 'Restore page', close: 'Close', error: 'Operation failed', settings: 'Browser', settingsIntro: 'Sessions and workspaces in this application share website logins.',
  import: 'Import logins from Chrome', importHelp: 'Import Chrome cookies and local storage. macOS may request Keychain access.', imported: 'Import result',
  clearCache: 'Clear cache', clearAll: 'Clear all website data', clearConfirm: 'Clear all cookies, website storage and permissions? This closes browser pages and signs you out of websites.', confirm: 'Clear data', cancel: 'Cancel', done: 'Done', busy: 'Working…',
  permissions: 'Website permissions', noPermissions: 'Allow or deny permissions when websites request them.', ask: 'Ask', allow: 'Allow', deny: 'Deny', remember: 'Remember this choice', permissionRequest: 'Website permission request',
  downloads: 'Downloads', noDownloads: 'No downloads yet', reveal: 'Show in folder', completed: 'Completed', interrupted: 'Interrupted', progressing: 'Downloading', cancelled: 'Cancelled',
  record: 'Record', recording: 'Recording', recordSeconds: 'Duration (seconds)', stopRecord: 'Cancel recording', recordReady: 'Recording completed', screenshot: 'Screenshot', permissionMedia: 'Camera and microphone', importUnavailable: 'No data could be imported. Check that Chrome is installed and signed in.', importDenied: 'Keychain access was denied. Retry the import or sign in here.', importPartial: 'Some website data could not be imported. Sign in to those websites again.',
};
