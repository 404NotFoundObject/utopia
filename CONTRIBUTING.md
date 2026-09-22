# 贡献指南

感谢你有兴趣为 Utopia 做贡献！

## 开发环境

Utopia 是纯前端项目，**无需构建工具**。用任意静态服务器托管即可：

```bash
git clone https://github.com/404NotFoundObject/utopia.git
cd utopia
python -m http.server 8080
```

打开 `http://localhost:8080`。

> ⚠️ 不要直接双击 `index.html`。ES Modules + IndexedDB 需要 HTTP 协议。

## 提交规范

使用清晰的动词开头：

| 前缀 | 用途 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | 修复 bug |
| `docs:` | 文档修改 |
| `refactor:` | 重构（不改变行为） |
| `style:` | 格式调整（不影响逻辑） |
| `chore:` | 杂项（依赖、配置等） |

示例：

```
feat: 支持 Gemini 2.0 模型
fix: 修复群聊 @ 提及的闭包陷阱
docs: 补充插件权限说明
```

## PR 流程

1. **先开 Issue 讨论方案**（避免无效 PR）
2. Fork 仓库，创建分支：`git checkout -b feature/your-feature`
3. **一个 PR 只做一件事**
4. 涉及核心逻辑的改动请附上测试说明
5. 提交 PR，等待 review

## 代码风格

- 使用 2 空格缩进
- 优先使用 `const` / `let`，避免 `var`
- 关键逻辑请加中文注释
- 遵循现有代码风格（不要引入新框架）

## 报告 Bug

请使用 [Bug 报告模板](.github/ISSUE_TEMPLATE/bug_report.yml)，附上：

- 浏览器与操作系统
- 复现步骤
- 控制台日志（F12）

## 安全问题

请**不要**通过公开 Issue 报告安全漏洞，详见 [SECURITY.md](SECURITY.md)。

## 许可证

提交贡献即表示你同意将代码以 [Apache License 2.0](LICENSE) 发布。