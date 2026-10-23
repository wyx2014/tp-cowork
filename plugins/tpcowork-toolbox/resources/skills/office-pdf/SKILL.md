---
name: office-pdf
description: 创建、阅读和检查 PDF 文档；将 Word、电子表格和演示文稿转换为可分享的 PDF。适用于 PDF 报告、资料整理和文档交付。
license: Apache-2.0
---

# PDF 文档

先确认用户提供的文件、需要的内容和最终交付路径。保持原文件不变，输出到工作区的新文件。匹配用户的语言、读者和版式要求；事实和引用来自用户资料或实际查到的来源，未确定的内容标注清楚。

## 生成 PDF

有表格、图片、封面、复杂排版或需要可编辑源文件时，优先加载 `office-docx`（文档）、`office-xlsx`（表格）或 `office-pptx`（演示文稿）。使用相应技能的随包 Python 环境生成源文档，然后用该技能返回的 `libreofficeKit.node` 和 `libreofficeKit.cli` 绝对路径转换：

```text
"<node>" "<cli>" convert --input report.docx --output report.pdf
```

不要安装全局 Python、LibreOffice 或在启动时下载依赖。相应运行环境不可用时如实说明，不要声称已经完成转换。

简单的中文或英文纯文本资料可以直接使用本技能目录下的 `scripts/create.mjs`。这是随包提供、无需依赖的 A4 PDF 生成器，支持自动换行、分页和可提取的中文文本；不支持表格布局、图片、表单、emoji 或复杂字体排版。使用当前可用的 JavaScript 执行环境或已经配置的 Node 路径，不假设电脑安装了全局 Node。若会话尚无可用 Node 路径，加载 `office-docx` 并使用它返回的 `libreofficeKit.node` 运行本脚本；只需读取路径，无需启动 LibreOffice。可从 `node_repl` 按实际技能目录的绝对文件 URL 导入并调用：

```js
const { createDocument } = await import("file:///absolute/skill-directory/scripts/create.mjs");
await createDocument("/absolute/workspace/report.pdf", {
  title: "报告标题",
  paragraphs: ["核心结论", "证据、来源和下一步行动"]
});
```

如已有可用 Node，也可先写入同样结构的 JSON，再运行：

```text
"<node>" "<skill-directory>/scripts/create.mjs" input.json report.pdf
```

Windows 路径使用实际绝对文件 URL（`file:///C:/...`）；在 PowerShell 中调用带引号的命令要加 `&`。输出文件已存在时脚本会拒绝覆盖，选择新文件名后再执行。

## 阅读、处理和检查

使用会话中实际可用的文档读取、预览或 PDF 工具检查现有 PDF。合并、拆分、表单、加密、OCR 或复杂编辑需要相应工具；先核实环境已有工具及其能力，不能假定安装本技能就同时安装了 pypdf、OCR 或其他外部程序。没有对应工具时说明具体限制，并提供可行的资料整理或重新排版方案。扫描件的可见文字不等于已经提取到文本。

交付前确认 PDF 真实存在、页数符合预期、能重新打开，并检查标题和代表性正文。可渲染时检查分页、裁切和中文字体；模型不接受图片时不要反复调用图像工具，并说明视觉检查未完成。不能仅凭文件头或脚本执行成功就宣称内容和版式正确。

使用 `present({"files":[{"path":"report.pdf"}]})` 提供最终文件；没有此工具时使用会话支持的文件链接。简述内容、来源和实际完成的检查；需要可编辑源文件时一起交付。
