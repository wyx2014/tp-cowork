---
name: call
description: 按用户明确要求拨号或挂断 Yealink T46U 电话。
---

使用原生 `call` 工具，action 为 dial 或 hangup；拨号传 number。仅接受用户提供的数字号码，不推测联系人或复制个人通讯录。工具从部署配置读取本机话机 URL、主叫、PBX，凭证在 Host 通过 DSH credentials 引用解析。缺配置时请用户在部署/凭证设置补充；不要让用户在聊天发送密码。返回“已发送指令”不等于对方已接通。不得为连通性测试自动拨号。
