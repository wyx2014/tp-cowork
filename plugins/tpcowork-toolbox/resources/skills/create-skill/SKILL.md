---
name: create-skill
description: 在用户提交后引导编写并验证 DSH 技能。
disable-model-invocation: true
---

明确触发场景，在当前项目草稿目录创建 SKILL.md 和所需 scripts/references/assets。使用 /skill-creator 的验证资源，frontmatter 使用 name/description、disable-model-invocation、user-invocable。先运行代表样例再通过工具箱本地导入的统一安装器安装到 profile；不可直接覆盖已安装目录。工具箱“AI 创建技能”仅准备聊天提示，用户提交后才执行。不要调用旧 save_skill。
