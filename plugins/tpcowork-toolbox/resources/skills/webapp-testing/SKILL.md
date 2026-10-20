---
name: webapp-testing
description: 通过真实浏览器验证 Web 应用的用户行为。
---

复用当前 tpcowork-browser 或任务已选择的 Playwright MCP，先确认实际工具可用。应用服务按项目现有启动命令运行，确认就绪再导航；不引用缺失 with_server.py。不用固定四秒轮询。验证用户关键路径、错误和恢复，保存真实截图/证据。结束清理本次拥有的服务和浏览器；没有浏览器依赖时说明未验证。
