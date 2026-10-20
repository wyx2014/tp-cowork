---
name: clawhub
description: 查找公共 ClawHub 技能并通过统一安装器导入。
---

ClawHub 和 PromptHub 是不同来源。经用户要求可用官方 ClawHub CLI 搜索并下载到当前项目临时目录；先检查完整目录、依赖、脚本及来源。不要让 CLI 直接写入用户技能目录或运行安装脚本。下载后通过工具箱本地导入（prepareLocalImport → install）发布到当前 profile，安装器负责冲突与更新。若没有下载工具/网络，说明缺口，不编造目录或安装成功。
