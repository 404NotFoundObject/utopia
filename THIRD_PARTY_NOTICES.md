# Third-Party Notices

本文档列出 Utopia 使用或依赖的所有第三方软件组件及其许可信息。

Utopia 本身以 [Apache License 2.0](LICENSE) 发布。下表中列出的第三方
组件各自遵循其原始许可，与 Utopia 的许可相互独立。

---

## 目录

- [运行时依赖](#运行时依赖)
- [构建时依赖](#构建时依赖)
- [可选依赖](#可选依赖)
- [开发工具](#开发工具)
- [数据资源](#数据资源)
- [完整许可文本](#完整许可文本)

---

## 运行时依赖

以下组件在用户运行时被加载或使用：

### 1. Transformers.js

| 项 | 内容 |
|---|---|
| 版本 | 3.7.5 |
| 用途 | 浏览器本地运行语义嵌入模型 |
| 上游项目 | https://github.com/huggingface/transformers.js |
| 版权 | Copyright 2023-2025 Hugging Face Inc. |
| 许可 | Apache License 2.0 |
| 分发方式 | 打包（`lib/transformers.min.js`） |

### 2. ONNX Runtime Web

| 项 | 内容 |
|---|---|
| 版本 | 1.22.0-dev.20250409-89f8206ba4 |
| 用途 | 运行 ONNX 格式的嵌入模型 |
| 上游项目 | https://github.com/microsoft/onnxruntime |
| 版权 | Copyright (c) Microsoft Corporation |
| 许可 | MIT License |
| 分发方式 | 打包（`lib/ort/`） |

### 3. Marked

| 项 | 内容 |
|---|---|
| 版本 | 4.3.0 |
| 用途 | Markdown 渲染 |
| 上游项目 | https://github.com/markedjs/marked |
| 版权 | Copyright (c) 2011-2024, Christopher Jeffrey |
| 许可 | MIT License |
| 分发方式 | CDN 引入 |

### 4. DOMPurify

| 项 | 内容 |
|---|---|
| 版本 | 3.0.6 |
| 用途 | HTML 净化（防 XSS） |
| 上游项目 | https://github.com/cure53/DOMPurify |
| 版权 | Copyright 2015-2024 Mario Heiderich, Cure53 |
| 许可 | Apache License 2.0 或 MPL 2.0（二选一） |
| 分发方式 | CDN 引入 |

### 5. MiniSearch

| 项 | 内容 |
|---|---|
| 版本 | 6.3.0 |
| 用途 | 全文关键词检索 |
| 上游项目 | https://github.com/lucaong/minisearch |
| 版权 | Copyright (c) 2018 Luca Ongaro |
| 许可 | MIT License |
| 分发方式 | CDN 引入 |

### 6. fflate

| 项 | 内容 |
|---|---|
| 版本 | 0.8.2 |
| 用途 | ZIP 解压（插件安装） |
| 上游项目 | https://github.com/101arrowz/fflate |
| 版权 | Copyright (c) 2020 Arjun Barrett |
| 许可 | MIT License |
| 分发方式 | CDN 引入（importmap） |

### 7. Font Awesome Free

| 项 | 内容 |
|---|---|
| 版本 | 6.0.0-beta3 |
| 用途 | 界面图标 |
| 上游项目 | https://github.com/FortAwesome/Font-Awesome |
| 版权 | Copyright (c) Fonticons, Inc. |
| 许可 | 代码：MIT · 图标：CC BY 4.0 · 字体：SIL OFL 1.1 |
| 分发方式 | CDN 引入 |

---

## 构建时依赖

Utopia 使用原生 ES Modules，**没有构建步骤**。

以下工具仅在开发或维护时可能使用：

### 静态服务器（示例）

用户可使用任意静态服务器托管，例如：

- **Python `http.server`** — Python Software Foundation License
- **`npx serve`** — MIT License

这些工具**不随项目分发**，仅为运行建议。

---

## 可选依赖

以下依赖在特定功能被启用时使用：

### 1. 语义嵌入模型

用户在设置中启用语义检索时，需要下载以下模型（二选一）：

| 模型 | 大小 | 许可 | 上游 |
|------|------|------|------|
| `Xenova/all-MiniLM-L6-v2` | ~80 MB | Apache 2.0 | [sentence-transformers](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | ~235 MB | Apache 2.0 | [sentence-transformers](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) |

模型由用户主动下载，缓存于浏览器。Utopia 不随项目分发模型文件。

### 2. Kokoro TTS（可选）

若用户配置 Kokoro 作为 TTS 后端：

| 项 | 内容 |
|---|---|
| 用途 | 高质量本地语音合成 |
| 上游项目 | https://github.com/hexgrad/kokoro |
| 许可 | Apache License 2.0 |
| 分发方式 | 用户自行部署，Utopia 仅通过 HTTP 调用 |

### 3. HTTP Whisper（可选）

若用户配置 HTTP Whisper 作为 STT 后端：

| 项 | 内容 |
|---|---|
| 用途 | 高精度语音识别 |
| 上游项目 | https://github.com/SYSTRAN/faster-whisper |
| 许可 | MIT License |
| 分发方式 | 用户自行部署，Utopia 仅通过 HTTP 调用 |

---

## 开发工具

以下工具仅在开发调试时使用，**不进入生产环境**：

### Lighthouse / Chrome DevTools

- 用途：性能分析、调试
- 许可：Chromium 项目的一部分，遵循 BSD 3-Clause License

### Visual Studio Code

- 用途：代码编辑
- 许可：Microsoft 专有许可

---

## 数据资源

### 网络时间 API

Utopia 的时间引擎在首次启动时，会**尝试**通过以下公开 API 校准时间：

| API | 用途 | 提供方 |
|-----|------|--------|
| 淘宝时间 API | 时间戳 | 阿里巴巴集团 |
| WorldTimeAPI | 时区时间 | worldtimeapi.org |

**这些 API 仅在首次启动时调用一次**。若请求失败，Utopia 会降级使用本地系统时间，不影响功能。

如不希望 Utopia 发起这些请求，可在设置中关闭时间系统，或将浏览器配置为离线模式。

### Hugging Face 模型仓库

用户主动下载语义模型时，Utopia 会从 Hugging Face 拉取模型文件：

- 域名：`https://huggingface.co`
- 用途：下载嵌入模型
- 隐私：仅传递模型 ID，不传递用户数据

---

## 完整许可文本

以下是所有第三方组件的完整许可文本。为便于查阅，按字母顺序排列。

### Apache License 2.0

见项目根目录的 [LICENSE](LICENSE) 文件。

本许可适用于：Transformers.js、DOMPurify（二选一）、可选语义模型、Kokoro。

### MIT License

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

本许可适用于：ONNX Runtime Web、Marked、MiniSearch、fflate、Font Awesome（代码部分）。

### SIL Open Font License 1.1

```
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE

The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to any
document created using the fonts or their derivatives.

DEFINITIONS

"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may include
source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components
as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software
to a new environment.

"Author" refers to any designer, engineer, programmer, technical writer
or other person who contributed to the Font Software.

PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining a
copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in
Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the
corresponding Copyright Holder. This restriction only applies to the
primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION

This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

本许可适用于：Font Awesome 字体部分。

### CC BY 4.0（Creative Commons Attribution 4.0）

完整文本见：https://creativecommons.org/licenses/by/4.0/legalcode

简要说明：

您可以自由地：

- **共享** — 以任何媒介或格式复制和分发材料
- **改编** — 重混、转换和基于材料进行创作，用于任何目的，甚至商业目的

只要您遵守许可条款：

- **署名** — 您必须给出适当的署名，提供指向本许可的链接，并指出是否进行了修改

本许可适用于：Font Awesome 图标部分。

---

## 声明完整性

本清单尽力覆盖 Utopia 使用的所有第三方组件。如您发现遗漏，请提交 Issue 或 Pull Request。

**最后更新**：2026 年 9 月