---
name: image-extract
description: 通过部署的多模态服务提取图片文字、表格和结构化字段。
---

使用原生 `extract_image` 工具，image_path 指向用户本次提供的图片，prompt 说明提取范围。图片通过 DSH 文件系统读取，在 Host 发送给部署指定服务；没有 endpoint/model/凭证时提示需配置，不调用不存在的 Python nanobot 模块。保持表格行列、字段和不确定标记，不补写看不清的数字。不要把秘密写入提示或日志。若需要看原图且当前模型支持图像，可使用 `read_image`；它与文字提取的返回语义不同。
