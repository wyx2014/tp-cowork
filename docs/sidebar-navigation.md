# 侧栏顶部导航

参考 tp-cowork 的 `DesktopTopOverlay`：侧栏开关之后依次显示后退、前进，28px 点击区域、16px 箭头、4px 间距，无历史时禁用。macOS 避让红绿灯，全屏及收起侧栏时保留入口；Windows 避让标题栏菜单；Web 收起时随侧栏排列。

外观插件拥有窗口内最多 50 条访问历史，观察原生布局的主页面选择与 Session Controller 的 mainView 引用。会话和工具箱、自动化等主页面都记录；相邻重复目标去重，后退后访问新目标清空前进记录。切换会话的同步 retain/release 和 panel 更新在同一微任务中合并，避免记录中间状态。

回放只调用 `uiWorkspace.openSession` / `layout.selectPanel`，会话生命周期仍由底座负责。已删除、已归档会话及已卸载页面跳过。插件释放时移除订阅、快捷键、按钮和样式，不持久化历史。

快捷键使用现有 shortcuts 注册表：桌面 macOS 为 Command+[ / Command+]，Windows/Linux 为 Ctrl+[ / Ctrl+]。macOS/Windows Web 额外按 Alt，符合底座的浏览器快捷键约束；Linux Web 使用按钮。设置弹窗中后退优先关闭设置，其他弹窗遵守原生快捷键的焦点约束。

验收：连续切换会话和主页面后可往返；边界禁用；回放不新增记录；后退后新导航截断前进；删除、归档、卸载目标后跳过；收起、展开、全屏和深浅主题正常；卸载无残留。

导航逻辑测试随外观插件的 Vitest 配置运行。实际浏览器验收从项目根运行 `node ../deepseek-harness/node_modules/vitest/vitest.mjs run --config scripts/tests/sidebar-navigation.config.mjs --configLoader native --cache=false`，需要已构建底座、UI、toolbox 和 experts 插件。可用 `TPCOWORK_TEST_CHROME` 指定 Chrome 路径。截图输出到 `artifacts/sidebar-navigation/`；macOS/Windows 标题栏在浏览器中模拟，原生桌面窗口拖动不属于这项测试。
