---
name: cron
description: 管理用户要求的提醒或自动执行任务。
---

使用已部署 tpcowork-automation 的 `cron` 工具（action add/list/remove）。add 明确 mode=reminder 或 task：提醒只回显文字，需要推理/工具的任务用 task。一次性相对时间先换算为明确 ISO at；没有重复意图不创建周期。周期才设置 every_seconds 或 cron_expr、tz、repeat=true。先 list 取得真实 job_id 后删除；不另建系统 crontab、Python scheduler 或进程内计时器。只依据原生返回报告保存/运行状态。
