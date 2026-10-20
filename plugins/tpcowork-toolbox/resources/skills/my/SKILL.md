---
name: my
description: 查询 DSH 当前能力、模型及可配置设置，诊断缺少的服务。
---

使用 `cordis_inspect_list` 发现真实 Host/Client provider，再用返回的 provider/method 调用 `cordis_inspect_query`；不要猜方法名。`cordis_inspect_self` 查询自身运行能力。设置写入通过 DSH 原生 settings/configEditor，使用已发现的 namespace/schema/revision，仅修改用户要求的值；秘密走 credentials，返回只描述是否配置。不要承诺可以任意扩大模型上下文、修改不可变设置或读取旧 nanobot scratchpad。见 references/examples.md。
