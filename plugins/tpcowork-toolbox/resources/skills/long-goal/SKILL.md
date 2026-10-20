---
name: long-goal
description: 为用户的长期目标管理 DSH 持久目标和真实完成状态。
---

使用 `get_goal` 查看当前目标及 revision；根据用户授权通过 `create_goal` 创建。`update_goal` 使用工具实际 schema 的 id/revision/action（edit/pause/resume/complete/blocked）。直接用户请求才可暂停/恢复；不要调用旧 long_task 或 complete_goal。完成前核对 todo_write 计划、实际结果及 present 交付。失败或回合终止不等于完成；进程中断不承诺自动恢复，不支持的恢复要明确重跑。
