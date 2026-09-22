# 安全政策

## 支持的版本

我们只对最新发布版本提供安全更新。

| 版本 | 支持状态 |
|------|---------|
| 最新版 | ✅ |
| 旧版本 | ❌ |

## 报告漏洞

**请不要通过公开 Issue 报告安全漏洞。**

请通过以下方式私下联系维护者：

- **GitHub Private Vulnerability Reporting**（推荐）：
  在仓库页面 → Security → Report a vulnerability
- **Email**：3526433323@qq.com

我们会在 **48 小时内**回复，并在修复后公开致谢（如你同意）。

## 报告内容

请尽量包含：

- 漏洞类型（XSS / 注入 / 越权 / ...）
- 复现步骤
- 影响范围
- 可能的修复方案（可选）

## 已知的安全设计

- 所有用户输入经过 `escapeHtml` 转义
- Markdown 渲染使用 DOMPurify 过滤
- 插件运行在 Worker 中，通过权限系统隔离
- API Key 存储在本地 IndexedDB，不上传

## 不在范围内

- 浏览器扩展读取 IndexedDB（用户环境问题）
- 用户自行接入的第三方 API 的行为
- 社交工程攻击