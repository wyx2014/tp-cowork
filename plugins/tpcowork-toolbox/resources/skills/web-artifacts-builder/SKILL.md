---
name: web-artifacts-builder
description: 用项目现有工具创建可运行的 Web 交付物。
---

先检查已有 package.json 和构建命令，复用已有框架与依赖。单页交付可生成独立 HTML/CSS/JS；复杂项目使用本项目构建工具并验证最终输出。不运行缺失 scripts/init-artifact.sh 或 bundle-artifact.sh。运行实际构建/浏览器检查，交付源码及可打开的构建产物，不虚构部署地址。
