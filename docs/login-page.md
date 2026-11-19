# 登录欢迎页

登录欢迎页由 `tpcowork-ui` 的 `LoginGate` 展示，账号状态继续由共享账号服务管理。

桌面启动时，产品插件通过现有的启动注入表发布 `__DSH_DESKTOP_LOGIN_ENTRY__ = "application"`，声明由应用内页面管理登录。桌面壳在首次启动、底座账号退出和过期时均不再打开底座欢迎窗口，因此不会出现「添加 API Key」「保存并继续」「稍后配置」页面或入口。该标记不代表认证成功；未登录时仍由 `LoginGate` 隔离工作台，登录后由现有账号配置服务下发个人网关及模型配置，用户无需填写密钥。没有该声明的底座保持原生欢迎流程。

- 常态只显示现有品牌图标、标题「欢迎来到 TP CoWork」、副标题「连接账号，开始使用 TP CoWork」和「开始登录」按钮；不增加供应商、地域、API Key 或跳过入口。英文同步提供对应文案。
- 参照 `tp-cowork/packages/ui/src/WelcomeScreen.tsx` 与 `openWorkspacePageThemeHero.tsx` 的 Zai Light / Zai Dark：居中 384px 卡片、40px 内边距、64px 图标、标题及副标题分组、40px 操作区间距。单按钮自然收紧卡片高度。
- 浅色为白色到浅蓝的背景、柔和蓝色光晕和浅灰卡片；深色为中性黑到深蓝的背景、蓝色光晕和深色卡片。登录专用颜色在 `theme.json` 中成对维护，不影响工作台主题。
- 小窗口保持居中和安全边距，内容超过窗口高度时可滚动。Windows 和 Linux 复用桌面标题栏的「应用程序」「编辑」菜单和原生窗控，允许拖拽窗口和用 Tab 在菜单与登录卡片间移动。登录内容在标题栏下方居中，全屏时使用完整窗口高度。
- 加载、等待、取消、错误、重试及登录屏障沿用现有流程；成功后显示工作台，退出或过期后恢复登录页。

验收：中英文、浅深主题、桌面及窄屏均可阅读且无横向溢出；常态只有一个登录按钮；登录、取消、重试和背景隔离回归通过。

登录屏障、底座启动引导及模型设置引导通过 `acquireOverlayInert` 共享后台交互的禁用状态，任一引导退出都不会提前解除登录限制；最后一个弹层释放后恢复原状态。回归使用真实启动引导组件覆盖两种挂载顺序、登录后的恢复及登出/过期；安装自检继续要求工作台同时具备 `hidden` 与 `inert`。认证约束参考 [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) 和 [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)，本次修改限于弹层交互隔离，不替代 Host 的认证校验。
