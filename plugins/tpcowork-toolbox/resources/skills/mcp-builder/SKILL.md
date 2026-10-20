---
name: mcp-builder
description: 开发和验证 MCP server，并接入已有 DSH 管理器。
---

先确认所需协议与权限，查已安装的官方 MCP SDK 文档。Node 使用 @modelcontextprotocol/sdk，Python 使用 mcp；按当前实际版本编写，不调用缺失参考脚本。实现工具 schema、错误和取消，测试 stdio/Streamable HTTP 生命周期。配置和凭证进入 DSH MCP 管理器/credentials，不建第二注册表；用工具箱独立 probe 验证，避免全局泄漏。依赖未安装时说明并按项目授权安装。
