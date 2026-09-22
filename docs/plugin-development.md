# Utopia 插件系统开发说明

> 本文档面向插件开发者，系统介绍 Utopia 插件系统的架构设计、插件标准格式、完整 API 参考与最佳实践，帮助你快速构建安全、稳定、可扩展的插件。

---

## 目录

- [概览](#概览)
- [快速开始](#快速开始)
- [系统架构](#系统架构)
- [manifest.json 详解](#manifestjson-详解)
- [main.js（Worker 侧）](#mainjsworker-侧)
- [ui.js（界面侧）](#uijs界面侧)
- [生命周期](#生命周期)
- [权限系统](#权限系统)
- [Worker 侧 API](#worker-侧-api)
- [UI 侧 API](#ui-侧-api)
- [扩展点](#扩展点)
- [最佳实践](#最佳实践)
- [调试与测试](#调试与测试)
- [完整示例](#完整示例)
- [常见问题](#常见问题)

---

## 概览

### 什么是 Utopia 插件？

Utopia 插件是运行在**独立 Worker** 中的可扩展单元。它通过**声明式权限**与主应用进行受控交互，可以：

- 监听并拦截核心模块的方法调用（钩子系统）
- 读取或修改角色、会话、世界书、朋友圈等数据
- 向界面注入按钮、面板、槽位组件
- 注册自定义命令（`/yourcommand`）
- 订阅系统事件（消息发送、角色切换、群组变更等）
- 使用 TTS / STT / API 等共享服务

### 核心特性

| 特性 | 说明 |
|------|------|
| 🛡️ **Worker 隔离** | 每个插件在独立 Worker 中运行，崩溃不影响主应用 |
| 🔐 **权限声明** | Manifest 显式声明所需权限，安装时用户确认 |
| 🪝 **钩子系统** | 核心方法自动支持 before / after / error 钩子 |
| 🎯 **UI 槽位** | 通过 `data-plugin-slot` 标注锚点，无需侵入式 DOM 操作 |
| 💾 **独立存储** | 每个插件拥有独立的 KV 存储与配置命名空间 |
| 🧰 **全套 UI 工具** | 对话框、热键、右键菜单、提示、拖拽等开箱即用 |

---

## 快速开始

一个最小可用的 Utopia 插件包含三个文件：

```
my-plugin/
├── manifest.json   ← 插件清单
├── main.js         ← Worker 侧逻辑（必需）
└── ui.js           ← 界面侧脚本（可选）
```

### Step 1 · 编写 manifest.json

```json
{
  "id": "com.example.hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "一个最简示例插件",
  "author": "Your Name",
  "main": "main.js",
  "ui": "ui.js",
  "permissions": [
    "character:read",
    "event:subscribe"
  ],
  "utopia": {
    "minVersion": "1.0.0"
  }
}
```

### Step 2 · 编写 main.js

```js
// Worker 侧入口：导出 setup(api, manifest)
export function setup(api, manifest) {
  // 1. 订阅角色切换事件
  api.events.on('character:switched', (payload) => {
    console.log('[HelloWorld] 切换到角色:', payload.characterId);
  });

  // 2. 订阅应用启动
  api.events.on('app:started', () => {
    console.log('[HelloWorld] 插件已就绪');
  });

  // 3. 返回 teardown 函数（可选）
  return function teardown() {
    console.log('[HelloWorld] 插件卸载');
  };
}
```

### Step 3 · 编写 ui.js（可选）

```js
// 界面侧入口：导出 setup(uiApi, manifest)
export function setup(uiApi, manifest) {
  // 在设置面板底部注入一个区块
  uiApi.registerSlot('settings-bottom', () => {
    const div = uiApi.dom.h('div', {
      style: 'padding: 0.5rem; border-top: 1px solid var(--color-border);'
    }, [
      uiApi.dom.h('strong', {}, 'Hello World 插件'),
      uiApi.dom.h('p', { style: 'color: var(--color-text-muted); font-size: 0.85rem;' },
        '这是由插件注入的区块。'),
    ]);
    return div;
  });

  return function teardown() {
    // uiApi.registerSlot 返回的取消函数会自动处理；此处可做额外清理
  };
}
```

### Step 4 · 安装

1. **打包为 ZIP** — 将整个插件目录压缩为 `my-plugin.zip`，确保 `manifest.json` 位于 ZIP 根目录。
2. **在应用中安装** — 打开 侧栏 → 插件 → 从文件安装，选择 ZIP。确认权限对话框。
3. **启用并验证** — 点击「启用」，打开浏览器控制台，观察日志输出。

---

## 系统架构

Utopia 插件系统由**主线程侧**与**Worker 侧**两部分组成：

```
┌─────────────────────────────────────────────────────┐
│  🎨 UI 层（主线程 DOM）                             │
│  ┌───────────────────────────────────────────────┐  │
│  │ uiBridge · uiRuntime · data-plugin-slot       │  │
│  │ 渲染器覆写                                     │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  🧩 插件管理层（主线程）                             │
│  ┌───────────────────────────────────────────────┐  │
│  │ pluginManager · pluginApi · hookSystem        │  │
│  │ permissionChecker · pluginVfs                 │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  ⚙️ 插件运行时（Worker 隔离）                       │
│  ┌───────────────────────────────────────────────┐  │
│  │ workerRuntime · pluginRuntime                 │  │
│  │ Blob URL 模块打包                              │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  🔧 业务模块层                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │ character · conversation · chat · groupChat   │  │
│  │ emotion · bodyState · worldBook · social      │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  ⚡ 核心基础设施                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ db (IndexedDB) · state · api · eventBus       │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 关键设计

#### 1. Worker 隔离

每个插件运行在独立 Worker 中。Worker 无法直接访问 DOM，所有界面操作通过 `uiApi`（运行在主线程）完成。这一设计确保：

- 插件崩溃不影响主应用
- 插件无法绕过权限校验直接操作 DOM
- 插件可以执行 CPU 密集任务而不阻塞 UI

#### 2. 声明式权限

Manifest 中通过 `permissions` 数组声明所需权限。主线程在执行每次 RPC 调用前会通过 `assertPermission()` 校验，未声明的权限直接拒绝。

#### 3. 自动化钩子注入

`pluginApi.js` 通过 Proxy 自动包装所有业务模块方法，在方法调用前后触发 `:before` / `:after` / `:error` 钩子。插件通过 `api.hooks.register()` 注册钩子，即可拦截任意核心方法。

#### 4. 槽位式 UI 注入

核心界面通过 `data-plugin-slot="xxx"` 标注锚点。`uiRuntime` 通过 MutationObserver 监听 DOM 变化，自动填充新出现的槽位。插件通过 `uiApi.registerSlot()` 注册渲染函数，无需关心 DOM 生命周期。

---

## manifest.json 详解

插件清单是所有插件的入口元数据。完整字段说明如下：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 反向域名格式，如 `com.example.my-plugin`，全局唯一 |
| `name` | string | ✅ | 显示名称 |
| `version` | string | ✅ | 语义化版本，如 `1.0.0` 或 `1.0.0-beta` |
| `main` | string | ✅ | Worker 侧入口文件，如 `main.js` |
| `ui` | string | ⬜ | 界面侧入口文件，如 `ui.js` |
| `description` | string | ⬜ | 功能描述 |
| `author` | string | ⬜ | 作者名 |
| `permissions` | string[] | ⬜ | 所需权限列表。缺省视为无需权限 |
| `utopia` | object | ⬜ | 兼容性声明，见下 |

### 兼容性声明（utopia 字段）

```json
"utopia": {
  "minVersion": "1.0.0",
  "maxVersion": "2.0.0"
}
```

- `minVersion`：要求的最低 API 版本
- `maxVersion`：支持的最高 API 版本（可选）

### ID 规范

> ⚠️ **命名约束**
> 插件 ID 必须符合反向域名格式：`^[a-z0-9]+(\.[a-z0-9-]+)+$`
>
> - ✅ 正确：`com.example.my-plugin` · `io.github.alice.tools`
> - ❌ 错误：`my-plugin` · `MyPlugin` · `com..example`

---

## main.js（Worker 侧）

`main.js` 运行在独立 Worker 中，是插件的逻辑主体。它必须导出 `setup` 函数。

### 导出契约

```js
// 方式 1：具名导出 setup（推荐）
export function setup(api, manifest) {
  // api:      完整 API 对象（受权限控制）
  // manifest: 插件元数据
  return function teardown() { /* 可选 */ };
}

// 方式 2：默认导出对象
export default {
  setup(api, manifest) {
    return function teardown() { /* 可选 */ };
  },
  teardown() { /* 备用 teardown */ }
};
```

### 支持的模块语法

- ES Module（`import` / `export`）
- 相对导入：`import { foo } from './utils.js'`
- 父级导入：`import { bar } from '../lib/helper.js'`
- 支持多文件拆分，导入自动重写为 Blob URL
- 不支持外部 URL 导入（安全限制）

### 限制

> 🚫 **Worker 侧不可用**
>
> - 无法访问 `document` / `window` / DOM
> - 无法使用 `state.subscribe` / `state.subscribeAll`（回调无法跨 Worker 传递）
> - 无法传递函数给主线程（结构化克隆限制）
> - 无法直接读写 localStorage
>
> 如需订阅状态，请使用 `api.events.on()` 或在 `ui.js` 中使用 `uiApi.api.state.subscribe()`。

---

## ui.js（界面侧）

`ui.js` 运行在主线程，用于操作 DOM、注册槽位、绑定热键等。它是**可选的**——如果插件无界面需求，可以省略。

### 导出契约

```js
export function setup(uiApi, manifest) {
  // uiApi: 全套界面工具对象
  return function teardown() { /* 可选 */ };
}
```

### 与 Worker 通信

UI 与 Worker 通过消息通道通信：

```js
// UI → Worker
uiApi.sendToWorker({ action: 'fetchData', id: 123 });

// Worker → UI
uiApi.onWorkerMessage((payload) => {
  console.log('收到 Worker 消息:', payload);
});
```

Worker 侧发送消息：

```js
// 在 main.js 中
api.postToUI({ type: 'dataReady', data: [...] });
```

---

## 生命周期

```
┌────────────────────────────────────────────┐
│ 安装（Install）                             │
│   下载 ZIP → 解压校验 → 权限确认 → 写入 VFS │
└────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────┐
│ 启用（Enable）                              │
│   创建 Worker → Blob URL 打包 → 加载 ui.js  │
│   → 调用 setup()                            │
└────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────┐
│ 运行（Running）                             │
│   响应事件 · 触发钩子 · 渲染槽位 · 执行命令  │
└────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────┐
│ 禁用 / 卸载（Disable / Uninstall）          │
│   调用 teardown() → 清理钩子/槽位 → 终止 Worker│
└────────────────────────────────────────────┘
```

### setup 与 teardown 的契约

- `setup` 可以是同步或异步函数（返回 Promise 也可以）
- `teardown` 通过以下两种方式之一提供：
  - `setup` 的返回值（推荐）
  - 模块导出的 `teardown` 函数
- `teardown` 应清理所有副作用：定时器、监听器、外部连接
- 框架会自动清理：钩子、事件订阅、槽位、热键、loading、右键菜单

---

## 权限系统

### 权限模型

权限是插件系统的安全边界。每次 `api.xxx.yyy()` 调用都会在主线程侧校验权限，未声明的调用会抛出错误。

### 权限粒度

权限采用「资源:操作」的命名规范：

- `character:read` / `character:write`
- `conversation:read` / `conversation:write`
- `group:read` / `group:write`
- ……

### 通配符

`*` 表示完全访问权限。声明 `*` 后所有方法均可调用。**强烈不建议**在公开插件中使用。

> ⚠️ **关于完全访问权限**
> 声明 `"*"` 会在安装时向用户展示醒目的红色警告。用户对来源不明的插件授予此权限存在风险，请仅在自用插件中使用。

### 完整权限清单

#### 资源读写

| 权限 | 说明 |
|------|------|
| `character:read` | 读取角色信息 |
| `character:write` | 创建/修改/删除角色 |
| `conversation:read` | 读取会话记录 |
| `conversation:write` | 修改会话记录 |
| `chat:read` | 读取聊天消息 |
| `chat:write` | 发送消息 |
| `group:read` | 读取群聊 |
| `group:write` | 发送群聊消息 |
| `memory:read` | 读取记忆 |
| `memory:write` | 写入/删除记忆 |
| `worldbook:read` | 读取世界书 |
| `worldbook:write` | 修改世界书 |
| `social:read` | 读取朋友圈 |
| `social:write` | 发布朋友圈 |
| `settings:read` | 读取设置 |
| `settings:write` | 修改设置 |
| `time:read` | 读取游戏时间 |
| `time:write` | 修改游戏时间 |
| `injector:read` | 读取注入器 |
| `injector:write` | 修改注入规则 |

#### 系统能力

| 权限 | 说明 |
|------|------|
| `hook:register` | 注册钩子（拦截系统行为） |
| `command:register` | 注册自定义命令 |
| `ui:inject` | 注入界面元素 |
| `event:subscribe` | 订阅系统事件 |
| `event:emit` | 发布系统事件 |
| `api:call` | 调用 AI API |
| `tts:use` | 使用语音合成 |
| `stt:use` | 使用语音识别 |
| `http:request` | 发起网络请求 |
| `storage:local` | 使用 localStorage |
| `storage:indexeddb` | 使用 IndexedDB |
| `*` | ⚠️ 完全访问（不推荐） |

---

## Worker 侧 API

### API 总览

Worker 侧的 `api` 对象提供以下命名空间：

| 命名空间 | 用途 | 所需权限 |
|---------|------|---------|
| `api.state` | 读取 / 修改全局状态 | `settings:read/write` |
| `api.events` | 订阅 / 发布事件 | `event:subscribe/emit` |
| `api.hooks` | 注册 / 注销钩子 | `hook:register` |
| `api.character` | 角色管理 | `character:read/write` |
| `api.conversation` | 会话管理 | `conversation:read/write` |
| `api.chat` | 单聊消息 | `chat:read/write` |
| `api.groupChat` | 群聊管理 | `group:read/write` |
| `api.groupChatEngine` | 群聊引擎 | `group:read/write` |
| `api.groupChatOps` | 群聊高级操作 | `group:read/write` |
| `api.emotion` | 情感引擎 | `character:read/write` |
| `api.bodyState` | 身体状态引擎 | `character:read/write` |
| `api.profileDefaults` | 个性化参数 | `character:read` |
| `api.memory` | 长期记忆 | `memory:read/write` |
| `api.time` | 游戏时间 | `time:read/write` |
| `api.worldBook` | 世界书 | `worldbook:read/write` |
| `api.injector` | 提示词注入 | `injector:read/write` |
| `api.personality` | 性格量化 | `character:read/write` |
| `api.social` | 朋友圈 | `social:read/write` |
| `api.proactiveChat` | 主动对话 | `character:read/write` |
| `api.settings` | 设置 | `settings:read/write` |
| `api.commandEngine` | 命令引擎 | `command:register` |
| `api.summary` | 对话摘要 | `conversation:read` |
| `api.suggestions` | 推荐回复 | `chat:read` |
| `api.firstMessage` | 动态开场白 | `character:read` |
| `api.api` | AI API 调用 | `api:call` |
| `api.db` | 数据库访问 | `storage:indexeddb` |
| `api.utils` | 工具函数 | 无需权限 |
| `api.tts` | 语音合成 | `tts:use` |
| `api.stt` | 语音识别 | `stt:use` |

### api.state

| 方法 | 签名 | 说明 |
|------|------|------|
| `get` | `(path) => any` | 读取状态。`path` 为点号路径，如 `"settings.theme"` |
| `set` | `(path, value) => void` | 修改状态 |
| `subscribe` | `(path, cb) => unsubscribe` | ⚠️ Worker 侧不可用，请使用 `uiApi.api.state.subscribe` |
| `subscribeAll` | `(cb) => unsubscribe` | ⚠️ Worker 侧不可用 |

```js
// 读取当前角色
const charId = await api.state.get('currentCharacterId');

// 读取所有角色
const characters = await api.state.get('characters');

// 修改状态（需 settings:write）
await api.state.set('sidebarOpen', true);
```

### api.events

| 方法 | 说明 |
|------|------|
| `on(event, handler)` | 订阅事件，返回取消函数 |
| `once(event, handler)` | 单次订阅，触发后自动取消 |
| `off(event, handler)` | 取消订阅 |
| `emit(event, ...args)` | 发布事件（需 `event:emit`） |
| `emitAsync(event, ...args)` | 异步发布，等待所有订阅者 |
| `getEventNames()` | 获取所有已注册的事件名 |

#### 常用系统事件

| 事件名 | 触发时机 | Payload |
|--------|---------|---------|
| `app:started` | 应用启动完成 | `{ version, timestamp, settings }` |
| `character:switched` | 切换角色 | `{ characterId, character, timestamp }` |
| `message:before-send` | 用户消息发送前 | `{ characterId, content, timestamp }` |
| `message:received` | AI 回复完成 | `{ characterId, content, timestamp }` |
| `emotion:interaction` | 情感引擎响应事件 | `{ characterId, eventType, intensity, state }` |
| `emotion:updated` | 情感状态随时间变化 | `{ characterId, state }` |
| `body:updated` | 身体状态随时间变化 | `{ characterId, state }` |
| `body:wakeup` | 角色被唤醒 | `{ characterId, state }` |
| `body:injury` | 角色受伤 | `{ characterId, injury }` |
| `worldbook:rule-triggered` | 世界书规则触发 | `{ ruleId, content }` |
| `time:updated` | 游戏时间更新 | `{ gameTime, realTime, speed, paused }` |
| `time:advanced` | 游戏时间被推进 | `{ gameTime, delta }` |
| `group:created` | 群组创建 | `{ group }` |
| `group:message` | 群聊新消息 | `{ groupId, message }` |
| `group:member-added` | 群成员加入 | `{ groupId, member }` |
| `group:member-removed` | 群成员移除 | `{ groupId, memberId, memberType }` |
| `proactive:new` | 角色发起主动消息 | `{ characterId, type, content }` |
| `voice:call-ended` | 语音通话结束 | `{ characterId, duration }` |
| `settings:updated` | 设置被修改 | `{ oldSettings, newSettings }` |

```js
// 订阅消息接收
api.events.on('message:received', ({ characterId, content }) => {
  console.log(`角色 ${characterId} 回复: ${content}`);
});

// 发布自定义事件（需 event:emit 权限）
api.events.emit('myplugin:something-happened', { data: 123 });

// 其他插件可以订阅
api.events.on('myplugin:something-happened', (payload) => {
  console.log('收到自定义事件:', payload);
});
```

### api.hooks

钩子系统允许插件拦截核心模块的方法调用。所有通过 `pluginApi.js` 暴露的方法都自动支持 `:before` / `:after` / `:error` 三类钩子。

| 方法 | 说明 |
|------|------|
| `register(hookName, handler, opts)` | 注册钩子。`opts.priority` 控制执行顺序（越小越先） |
| `unregister(hookName)` | 注销钩子 |
| `unregisterAll()` | 注销该插件的所有钩子 |
| `list()` | 列出所有已注册的钩子 |

#### 钩子命名规范

格式为 `module:event`，常见的钩子名：

| 钩子名 | 触发时机 |
|--------|---------|
| `character.createCharacter:before` | 创建角色前，可修改参数或取消 |
| `character.updateCharacter:after` | 更新角色后，可修改返回值 |
| `chat.sendMessage:before` | 发送单聊消息前 |
| `chat.sendMessage:after` | 发送单聊消息后 |
| `groupChat.sendGroupMessage:before` | 发送群聊消息前 |
| `memory.addMemory:before` | 添加记忆前 |
| `worldBook.addRule:after` | 添加世界书规则后 |
| `injector.applyInjection:before` | 应用注入前 |
| `api.sendChatRequest:before` | 调用 AI API 前 |
| `settings.updateSettings:after` | 更新设置后 |

#### 钩子处理函数签名

```js
// before 钩子：可修改参数、取消调用
api.hooks.register('chat.sendMessage:before', (context) => {
  // context = { args, module, method, cancelled }
  // 修改参数
  context.args[0] = context.args[0].replace(/敏感词/g, '***');
  // 返回 context 或 { args: [...] } 生效

  // 取消调用（抛异常）
  // return false;  // 或 context.cancelled = true;
}, { priority: 100 });

// after 钩子：可修改返回值
api.hooks.register('chat.sendMessage:after', (context) => {
  // context = { args, result }
  // 修改 result 生效
  context.result = { ...context.result, injected: true };
});

// error 钩子：捕获异常
api.hooks.register('chat.sendMessage:error', (context) => {
  // context = { args, error }
  console.error('sendMessage 失败:', context.error);
});
```

> 💡 **如何取消方法调用**
> `before` 钩子返回 `false` 或设置 `context.cancelled = true` 即可取消调用。主线程会抛出带 `_cancelled` 标记的异常，调用方需自行处理。

### 业务模块 API（节选）

#### api.character

| 方法 | 权限 | 说明 |
|------|------|------|
| `getCurrentCharacter()` | character:read | 获取当前角色 |
| `loadCharacters()` | character:read | 重新加载角色列表 |
| `createCharacter(data)` | character:write | 创建角色 |
| `updateCharacter(id, updates)` | character:write | 更新角色 |
| `deleteCharacter(id)` | character:write | 删除角色 |
| `selectCharacter(id)` | character:read | 切换角色 |
| `exportCharacter(id, format)` | character:read | 导出角色卡 |
| `syncCharacterState(id)` | character:write | 同步角色引擎状态 |

```js
// 获取当前角色
const char = await api.character.getCurrentCharacter();
console.log(char.name, char.emotionState);

// 修改角色描述
await api.character.updateCharacter(char.id, {
  description: '一个全新的简介'
});
```

#### api.emotion

| 方法 | 权限 | 说明 |
|------|------|------|
| `getEmotionLabel(state)` | character:read | 获取情绪标签 |
| `getEmotionDescription(character)` | character:read | 获取情绪描述 |
| `buildEmotionPrompt(character)` | character:read | 构建情感提示词 |
| `handleInteraction(character, type, intensity)` | character:write | 处理情感事件 |
| `classifyUserMessage(text, useLLM)` | character:read | 分类用户消息 |

#### api.worldBook

| 方法 | 权限 | 说明 |
|------|------|------|
| `getAllRules()` | worldbook:read | 获取所有规则 |
| `addRule(ruleData)` | worldbook:write | 添加规则 |
| `updateRule(id, updates)` | worldbook:write | 更新规则 |
| `deleteRule(id)` | worldbook:write | 删除规则 |
| `toggleRule(id)` | worldbook:write | 启用/禁用规则 |
| `getEnabledRules(context)` | worldbook:read | 获取生效的规则 |

```js
// 添加一条"深夜提示"规则
await api.worldBook.addRule({
  name: '深夜提示',
  type: 'conditional',
  condition: {
    path: 'gameTime.hour',
    op: 'gte',
    value: 23,
  },
  content: '现在是深夜，你感到困倦。',
  position: 'before',
  priority: 50,
  enabled: true,
});
```

#### api.api

| 方法 | 权限 | 说明 |
|------|------|------|
| `sendChatRequest(params)` | api:call | 发送 AI 请求（支持流式） |
| `fetchModels()` | api:call | 获取可用模型列表 |
| `testApiConnection()` | api:call | 测试 API 连通性 |

```js
// 用 AI 分析一段文本
const response = await api.api.sendChatRequest({
  messages: [
    { role: 'user', content: '分析这段话的情绪：今天心情很好' }
  ],
  systemPrompt: '你是情感分析专家。',
  temperature: 0.1,
  maxTokens: 50,
  stream: false,
});

console.log(response.content);
```

> ⚠️ **关于 api.sendChatRequest 的流式模式**
> 流式模式下，`onChunk` 回调会传递每个文本块。注意：如果插件在 Worker 中调用，`onChunk` 是异步执行的，请确保错误处理正确。

---

## UI 侧 API

### uiApi 总览

`ui.js` 的 `setup(uiApi, manifest)` 中，`uiApi` 提供以下工具：

| 模块 | 用途 |
|------|------|
| `uiApi.api` | 与 Worker 侧 api 等价（带权限校验的代理） |
| `uiApi.storage` | 插件专属持久化存储 |
| `uiApi.config` | 插件配置管理 |
| `uiApi.dialog` | 对话框工具 |
| `uiApi.logger` | 命名空间日志 |
| `uiApi.dom` | DOM 便捷方法 |
| `uiApi.hotkey` | 快捷键注册 |
| `uiApi.contextMenu` | 右键菜单 |
| `uiApi.tooltip` | 悬停提示 |
| `uiApi.loading` | 加载遮罩 |
| `uiApi.dragDrop` | 拖拽支持 |
| `uiApi.modal` | 模态框 |
| `uiApi.utils` | 快捷方法（toast/banner/markdown 等） |
| `uiApi.loadModule` | 动态加载核心模块 |
| `uiApi.registerSlot` | 注册 UI 槽位 |
| `uiApi.overrideRenderer` | 覆写渲染器 |
| `uiApi.injectPanel` | 注入面板（兼容旧 API） |
| `uiApi.injectMessageAction` | 注入消息操作（兼容旧 API） |
| `uiApi.injectSettingsSection` | 注入设置区块（兼容旧 API） |
| `uiApi.injectSidebarButton` | 注入侧栏按钮（兼容旧 API） |
| `uiApi.onWorkerMessage` | 接收 Worker 消息 |
| `uiApi.sendToWorker` | 向 Worker 发送消息 |

### uiApi.dom · DOM 工具

#### h(tag, attrs, ...children)

快速创建 DOM 元素，支持 CSS 选择器式 tag：

```js
// 基础用法
const btn = uiApi.dom.h('button.btn.btn-primary', { onclick: () => alert('点击') }, '点击我');

// 复杂结构
const box = uiApi.dom.h('div#container', { style: 'padding: 1rem;' }, [
  uiApi.dom.h('h3', {}, '标题'),
  uiApi.dom.h('p', {}, '段落'),
  uiApi.dom.h('img', { src: '/avatar.png', alt: '头像' }),
]);

// 事件绑定
uiApi.dom.h('input', {
  type: 'text',
  placeholder: '输入...',
  oninput: (e) => console.log(e.target.value),
});
```

#### 其他方法

| 方法 | 说明 |
|------|------|
| `cssVar(name, fallback)` | 读取主题 CSS 变量 |
| `createIcon(name, opts)` | 创建 Font Awesome 图标 |
| `observe(selector, cb, opts)` | 监听元素出现 |
| `debounce(fn, delay)` | 防抖 |
| `throttle(fn, delay)` | 节流 |
| `waitFor(selector, timeout)` | 等待元素出现 |
| `escapeHtml(text)` | 转义 HTML |
| `fromHTML(html)` | 从 HTML 字符串解析元素 |

### uiApi.dialog · 对话框工具

```js
// 确认框
const ok = await uiApi.dialog.confirm('确定要删除吗？', {
  title: '危险操作',
  okText: '删除',
  danger: true,
});

// 输入框
const name = await uiApi.dialog.prompt('请输入新名称', '默认值', {
  placeholder: '名称...',
});

// 提示框
await uiApi.dialog.alert('操作完成！', { type: 'success' });

// 多字段表单
const result = await uiApi.dialog.form({
  title: '插件设置',
  fields: [
    { name: 'apiKey', label: 'API Key', type: 'password' },
    { name: 'model', label: '模型', type: 'select', options: ['gpt-4o', 'claude-3'], value: 'gpt-4o' },
    { name: 'enabled', label: '启用', type: 'checkbox', value: true },
  ],
});
console.log(result); // { apiKey: '...', model: 'gpt-4o', enabled: true }
```

### uiApi.modal

```js
// 打开自定义模态框
await uiApi.modal.open(`
  <button class="modal-close">&times;</button>
  <h2 class="modal-title">自定义内容</h2>
  <div>...你的 HTML...</div>
`, () => {
  console.log('模态框关闭');
});

// 关闭当前模态框
uiApi.modal.close();

// 创建标准模态框 HTML
const html = uiApi.modal.create('标题', '<p>内容</p>');
```

### uiApi.hotkey · 快捷键

```js
// 注册快捷键
const off = uiApi.hotkey.register('Ctrl+K', (e) => {
  console.log('Ctrl+K 按下');
  return true;  // 返回 true 阻止浏览器默认行为
});

// 取消注册
off();

// 列出所有已注册的快捷键
console.log(uiApi.hotkey.list());
```

### uiApi.tooltip · 悬停提示

```js
// 为某选择器的所有元素绑定 tooltip
const off = uiApi.tooltip.attach('.my-button', '点击保存', {
  placement: 'top',
  delay: 300,
});

// 支持动态内容
uiApi.tooltip.attach('.avatar', (el) => `用户：${el.alt}`, {
  placement: 'bottom',
});

// 手动显示
uiApi.tooltip.show(targetEl, '这是提示内容');

// 隐藏
uiApi.tooltip.hide();
```

### uiApi.contextMenu · 右键菜单

插件注册的右键菜单会与核心菜单**自动合并**，按 priority 排序。

```js
// 为消息气泡添加自定义菜单项
uiApi.contextMenu.register('.message', [
  {
    label: '📋 复制内容',
    onClick: (e, target) => {
      const text = target.querySelector('.bubble-content')?.textContent;
      navigator.clipboard.writeText(text);
    },
  },
  { separator: true },
  {
    label: '🔍 分析情绪',
    danger: false,
    onClick: async (e, target) => {
      const text = target.querySelector('.bubble-content')?.textContent;
      // ...调用 API 分析
    },
  },
], {
  priority: 150,  // 数字越小越先合并
});

// 动态生成菜单项
uiApi.contextMenu.register('.character-item', (target) => {
  const id = target.dataset.id;
  return [
    { label: `编辑 ${id.slice(0, 6)}...`, onClick: () => edit(id) },
  ];
});
```

#### 菜单项配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `label` | string | 菜单项文字 |
| `icon` | string | Font Awesome 图标名（可选） |
| `onClick` | Function | 点击回调 `(event, target) => void` |
| `danger` | boolean | 危险操作（红色） |
| `disabled` | boolean | 禁用状态 |
| `separator` | boolean | 分隔线（此时其他字段忽略） |

#### 选项说明

| 选项 | 默认 | 说明 |
|------|------|------|
| `priority` | 100 | 数字越小越先执行。核心菜单为 50 |
| `exclusive` | false | 返回非空后，其他 provider 不执行 |
| `claim` | false | 返回非空后，跳过后续 provider |

### uiApi.loading · 加载遮罩

```js
// 显示加载遮罩（支持嵌套计数）
uiApi.loading.show('正在处理...');

// 隐藏
uiApi.loading.hide();

// 或使用 wrap 自动管理
const result = await uiApi.loading.wrap(async () => {
  return await fetchData();
}, '加载数据中...');
```

### uiApi.dragDrop · 拖拽

```js
// 让元素可拖动
const cleanup = uiApi.dragDrop.draggable(myEl, {
  data: { type: 'message', id: 'xxx' },
  onDragEnd: (data, e) => console.log('拖动结束', data),
});

// 让元素可接收拖放
uiApi.dragDrop.droppable(dropZone, {
  accepts: (data) => data.type === 'message',
  onDrop: (data, e) => console.log('接收到', data),
});

// 自定义拖拽（不用原生 drag）
uiApi.dragDrop.customDrag(source, data, {
  onDrop: (target, data) => {},
});
```

### uiApi.storage · 独立存储

每个插件拥有独立的 KV 存储命名空间，无需担心 key 冲突：

```js
// 读写
await uiApi.storage.set('myKey', { foo: 'bar' });
const value = await uiApi.storage.get('myKey', 'default');
await uiApi.storage.remove('myKey');

// 批量操作
await uiApi.storage.setMany({ a: 1, b: 2 });
const all = await uiApi.storage.getMany(['a', 'b']);

// 前缀查询
const keys = await uiApi.storage.keys('user:');

// 检查存在
if (await uiApi.storage.has('myKey')) { /* ... */ }

// 清空该插件的所有数据
await uiApi.storage.clear();
```

### uiApi.config · 配置管理

```js
// 设置默认值
uiApi.config.setDefaults({
  enabled: true,
  threshold: 0.5,
  apiKey: '',
});

// 读取配置（合并默认值）
const config = await uiApi.config.get();
console.log(config.threshold);  // 0.5

// 读写单项
await uiApi.config.set('threshold', 0.8);
const threshold = await uiApi.config.getItem('threshold');

// 批量更新
await uiApi.config.update({ threshold: 0.6, apiKey: 'xxx' });

// 重置为默认值
await uiApi.config.reset();

// 订阅变更
const off = uiApi.config.onChange((config, changes) => {
  console.log('配置变更:', changes);
  applyConfig(config);
});
```

### uiApi.logger · 命名空间日志

```js
// 自动添加插件前缀
uiApi.logger.debug('调试信息');
uiApi.logger.info('普通信息');
uiApi.logger.warn('警告');
uiApi.logger.error('错误');

// 打印表格
uiApi.logger.table([{ a: 1 }, { a: 2 }]);

// 计时
const stop = uiApi.logger.time('耗时任务');
// ... 执行任务
const elapsed = stop();  // 返回毫秒数
```

---

## 扩展点

### UI 槽位系统

槽位系统是插件注入界面的**推荐方式**。核心界面通过 `data-plugin-slot="xxx"` 标注锚点，插件只需提供渲染函数。

#### 可用槽位

| 槽位名 | 位置 |
|--------|------|
| `sidebar-top` | 侧栏顶部 |
| `sidebar-bottom` | 侧栏底部（footer 上方） |
| `sidebar-footer-extra` | 侧栏 footer 内附加按钮 |
| `chat-header-actions` | 聊天头部右侧按钮区 |
| `welcome-content` | 欢迎页内容 |
| `input-actions-left` | 输入框左侧按钮 |
| `input-actions-right` | 输入框右侧按钮 |
| `message` | 每条消息容器 |
| `message-bubble` | 消息气泡 |
| `message-actions` | 消息操作区 |
| `character-item` | 角色列表项 |
| `character-item-actions` | 角色项操作区 |
| `character-form-top` | 角色表单顶部 |
| `character-form-middle` | 角色表单中部 |
| `character-form-bottom` | 角色表单底部 |
| `group-item` | 群组列表项 |
| `settings-top` | 设置面板顶部 |
| `settings-sections` | 设置面板 sections 区 |
| `settings-bottom` | 设置面板底部 |
| `worldbook-header` | 世界书面板头部 |
| `worldbook-toolbar` | 世界书工具栏 |
| `worldbook-rule-actions` | 世界书规则操作区 |
| `social-header-actions` | 朋友圈头部按钮 |
| `social-post-actions` | 朋友圈帖子操作区 |

#### registerSlot

```js
// 注册槽位
uiApi.registerSlot('message-actions', (context) => {
  // context 包含 messageEl / messageId / messageRole 等
  const btn = uiApi.dom.h('button.icon-btn', {
    title: '收藏',
    onclick: () => favorite(context.messageId),
  }, '⭐');
  return btn;
}, { priority: 100 });
```

#### context 字段说明

| 字段 | 说明 |
|------|------|
| `slotName` | 槽位名称 |
| `slotEl` | 槽位 DOM 元素 |
| `messageEl` | 所在消息元素（如果在消息内） |
| `messageId` | 消息 ID |
| `messageRole` | 消息角色（user / assistant） |
| `characterId` | 角色 ID |
| `groupId` | 群组 ID |
| `query(sel)` | 在消息范围内查询元素 |

#### 渲染器覆写

覆写核心渲染器，用于改造气泡样式等高级用途：

```js
// 覆写消息气泡渲染器
uiApi.overrideRenderer('message-bubble', (msg, defaultRender) => {
  const html = defaultRender(msg);
  // 在原始 HTML 后追加内容
  return html + '<div class="my-marker">✨</div>';
});
```

### 钩子系统（UI 场景）

除了 Worker 侧的 `api.hooks`，UI 侧通过 `uiApi.api.hooks` 也能注册钩子：

```js
uiApi.api.hooks.register('chat.sendMessage:before', (context) => {
  // 修改参数
  context.args[0] = context.args[0].trim();
  return context;
});

// 注意：uiApi.api 的权限校验与 Worker 侧一致
// 需要在 manifest 中声明 hook:register 权限
```

### 自定义命令

注册自定义命令后，用户可以在输入框中通过 `/yourcommand` 触发。

```js
// 注册命令（需 command:register 权限）
api.commandEngine.registerCommand(
  'weather',
  async (args, context) => {
    // args:      命令参数（字符串）
    // context:   { character, conversation, state, settings }

    const city = args.trim() || '北京';
    const result = await api.api.sendChatRequest({
      messages: [{ role: 'user', content: `查询${city}的天气` }],
      systemPrompt: '只输出一句话天气描述。',
      temperature: 0.3,
      maxTokens: 50,
      stream: false,
    });

    return {
      // 输出到控制台气泡
      console: `🌤️ ${city}: ${result.content}`,
      consoleType: 'info',
      // 顶部旁白提示
      banner: `天气查询成功`,
    };
  },
  {
    description: '查询天气',
    aliases: ['w'],  // 别名 /w
  }
);
```

> 💡 **命令返回值**
> - `{ console, consoleType }` — 输出到控制台气泡
> - `{ banner }` — 顶部旁白提示
> - `{ handled: false }` — 交由后续命令处理（罕见）

---

## 最佳实践

### 1. 权限最小化

> ✅ **只申请必要权限**
> 用户会在安装时看到权限列表。仅申请真正需要的权限，可以大幅提升安装转化率。例如：只读取角色信息的插件不要申请 `character:write`。

```json
{
  "permissions": [
    "character:read",
    "event:subscribe"
  ]
}
```

### 2. teardown 必做

所有在 `setup` 中创建的资源都应在 `teardown` 中清理。虽然框架会自动处理钩子、槽位、事件订阅等，但以下需要**手动清理**：

- 定时器（`setInterval` / `setTimeout`）
- Worker 侧的外部连接（WebSocket 等）
- UI 侧手动绑定的事件监听器（`addEventListener`）
- UI 侧手动创建的 DOM 元素

```js
export function setup(uiApi, manifest) {
  const timer = setInterval(() => {
    console.log('tick');
  }, 1000);

  return function teardown() {
    clearInterval(timer);  // ← 必做
  };
}
```

### 3. 错误处理

Worker 中的未捕获异常会通过 `plugin:error` 消息通知主线程，但建议在关键路径显式捕获：

```js
api.events.on('message:received', async (payload) => {
  try {
    const result = await someRiskyOperation(payload);
    // ...
  } catch (err) {
    console.error('[MyPlugin] 处理失败:', err);
    // 不要把异常抛回框架
  }
});
```

### 4. 异步钩子慎用

> ⚠️ **钩子有 5 秒超时**
> 钩子处理函数超过 5 秒会被强制终止。如果需要长时间处理，请使用 `api.events` 异步触发，而非在钩子中阻塞。

### 5. 使用槽位而非侵入式 DOM 操作

```js
// ❌ 不推荐：直接操作 DOM
document.querySelector('#chatHeader').innerHTML += '<button>...</button>';

// ✅ 推荐：使用槽位
uiApi.registerSlot('chat-header-actions', () => {
  return uiApi.dom.h('button.icon-btn', {}, '点击');
});
```

### 6. Worker 侧不做 DOM 相关推断

Worker 无法访问 DOM。如果插件需要基于界面状态做决策，请通过 `api.state` 读取状态，或在 `ui.js` 中处理。

### 7. 状态隔离

插件自己的运行时状态不要放在 `api.state` 的全局状态中（除了 UI 状态），而是使用 `uiApi.storage` 或闭包变量：

```js
// ✅ 推荐：闭包内的模块级变量
let counter = 0;

export function setup(api, manifest) {
  api.events.on('message:received', () => {
    counter++;
  });
}

// ❌ 不推荐：污染全局状态
api.state.set('myplugin.counter', 0);
```

### 8. 版本控制

使用语义化版本。当权限或 API 契约发生**不兼容变化**时，主版本号递增：

- `1.0.0` → `1.0.1`：修复 bug
- `1.0.0` → `1.1.0`：新增功能（向后兼容）
- `1.0.0` → `2.0.0`：破坏性变更

### 9. 日志规范

使用 `uiApi.logger` 而非直接 `console.log`。日志器会自动添加插件前缀，便于用户排查问题：

```js
// ✅ 推荐
uiApi.logger.info('插件已加载');
uiApi.logger.error('API 调用失败', err);

// ❌ 不推荐
console.log('[MyPlugin] 插件已加载');
console.error('[MyPlugin] API 调用失败', err);
```

### 10. 配置默认值

始终为配置项提供合理的默认值，使用户在首次使用时无需配置即可工作：

```js
uiApi.config.setDefaults({
  enabled: true,
  threshold: 0.5,
  model: 'gpt-4o-mini',
});
```

---

## 调试与测试

### 全局调试 API

打开浏览器控制台，访问 `window.__utopiaPlugins`：

```js
// 列出所有已安装插件
__utopiaPlugins.list()

// 列出运行中的插件
__utopiaPlugins.running()

// 启用 / 禁用 / 重载
await __utopiaPlugins.enable('com.example.my-plugin')
await __utopiaPlugins.disable('com.example.my-plugin')
await __utopiaPlugins.reload('com.example.my-plugin')

// 查看已注册的钩子
await __utopiaPlugins.hooks()

// 查看槽位注册表
await __utopiaPlugins.slots()

// 查看 API 方法列表
await __utopiaPlugins.api()

// 查看运行状态
__utopiaPlugins.runtime('com.example.my-plugin')
```

### 日志级别控制

```js
// 设置全局日志级别
localStorage.setItem('utopia:plugin-log-level', 'debug');
// 可选：debug / info / warn / error
```

### Worker 调试

Chrome DevTools 支持 Worker 独立调试：Sources 面板 → 左侧选择插件 Worker → 即可设置断点、查看变量。

### 卸载清理测试

验证插件的清理逻辑，请检查以下场景：

- 禁用后，钩子、事件、槽位是否全部移除？
- 禁用后，Worker 是否终止？
- 重新启用是否正常工作（不残留旧监听器）？
- 卸载后，重新安装相同 ID 是否成功？

---

## 完整示例

### 示例 1：消息发送前自动检测敏感词

**manifest.json**

```json
{
  "id": "com.example.word-filter",
  "name": "敏感词过滤器",
  "version": "1.0.0",
  "description": "发送消息前自动替换敏感词",
  "main": "main.js",
  "permissions": [
    "hook:register",
    "event:subscribe"
  ]
}
```

**main.js**

```js
const WORDS = ['测试敏感词1', '测试敏感词2'];

export function setup(api, manifest) {
  api.hooks.register('chat.sendMessage:before', (context) => {
    if (!context.args || !context.args[0]) return context;

    let text = context.args[0];
    for (const w of WORDS) {
      text = text.replace(new RegExp(w, 'g'), '*'.repeat(w.length));
    }
    context.args[0] = text;
    return context;
  }, { priority: 100 });

  return () => {};
}
```

### 示例 2：侧栏添加自定义按钮 + 自定义对话框

**manifest.json**

```json
{
  "id": "com.example.sidebar-tool",
  "name": "侧栏工具",
  "version": "1.0.0",
  "main": "main.js",
  "ui": "ui.js",
  "permissions": [
    "ui:inject",
    "character:read"
  ]
}
```

**main.js**

```js
export function setup(api, manifest) {
  api.events.on('mybutton:clicked', async () => {
    const char = await api.character.getCurrentCharacter();
    api.postToUI({
      type: 'showCharacter',
      name: char?.name || '未选择'
    });
  });

  return () => {};
}
```

**ui.js**

```js
export function setup(uiApi, manifest) {
  // 在侧栏底部注入按钮
  const offSlot = uiApi.registerSlot('sidebar-footer-extra', () => {
    return uiApi.dom.h('button.sidebar-btn', {
      onclick: async () => {
        uiApi.sendToWorker({ action: 'click' });
      },
    }, [
      uiApi.dom.createIcon('fa-star'),
      uiApi.dom.h('span', {}, '我的工具'),
    ]);
  });

  // 监听 Worker 消息
  const offMsg = uiApi.onWorkerMessage(async (payload) => {
    if (payload.type === 'showCharacter') {
      await uiApi.dialog.alert(`当前角色：${payload.name}`, {
        type: 'info',
      });
    }
  });

  return () => {
    offSlot();
    offMsg();
  };
}
```

### 示例 3：注册自定义命令

**manifest.json**

```json
{
  "id": "com.example.custom-cmd",
  "name": "自定义命令",
  "version": "1.0.0",
  "main": "main.js",
  "permissions": [
    "command:register",
    "character:read"
  ]
}
```

**main.js**

```js
export function setup(api, manifest) {
  api.commandEngine.registerCommand(
    'hello',
    async (args, context) => {
      const char = context.character;
      const name = args.trim() || (char ? char.name : '世界');
      return {
        console: `👋 Hello, ${name}!`,
        consoleType: 'success',
        banner: `👋 已向 ${name} 打招呼`,
      };
    },
    {
      description: '打招呼（/hello [名字]）',
      aliases: ['hi'],
    }
  );

  return () => {};
}
```

---

## 常见问题

### Q: 为什么 Worker 里不能使用 document？

Worker 是独立线程，没有 DOM。这是**设计意图**——确保插件不能直接操作界面，必须通过 `uiApi`（运行在主线程）进行受控的界面操作。如需操作界面，请把对应逻辑放在 `ui.js` 中。

### Q: 我的插件需要长时间运行任务怎么办？

Worker 本身就适合 CPU 密集任务。`setup` 可以是异步函数，但注意**不要在钩子中执行超过 5 秒的同步操作**。长时间任务建议：

- 通过 `api.events.on()` 触发后台异步任务
- 使用 `api.postToUI()` 通知 UI 更新进度
- 使用 `uiApi.loading` 显示加载状态

### Q: 如何在插件中读写应用设置？

使用 `api.settings`（需 `settings:read` / `settings:write`）：

```js
const settings = await api.settings.loadSettings();
console.log(settings.apiProvider);

await api.settings.updateSettings({
  temperature: 0.9,
});
```

### Q: 插件间如何通信？

通过 `api.events`。插件 A 发布自定义事件，插件 B 订阅：

**plugin-a/main.js**

```js
api.events.emit('myplugin:data-ready', { data: [...] });
```

**plugin-b/main.js**

```js
api.events.on('myplugin:data-ready', (payload) => {
  console.log('收到数据:', payload);
});
```

建议事件名加上插件名前缀（如 `myplugin:xxx`），避免与核心事件冲突。

### Q: 插件可以访问其他插件的数据吗？

不能。每个插件的 `storage` 与 `config` 是隔离的命名空间。如果需要共享数据，通过事件通信或让用户显式配置。

### Q: 如何让插件兼容未来版本的 Utopia？

在 manifest 中声明 `utopia.minVersion` / `maxVersion`。当用户升级 Utopia 后，如果 API 不兼容，插件会被提示需要更新。

### Q: 钩子可以取消核心方法调用吗？

可以。`before` 钩子返回 `false` 或设置 `context.cancelled = true`，主线程会抛出带 `_cancelled` 标记的异常，原方法不会被执行。调用方（用户操作）会看到相应提示。

### Q: 我的插件崩溃了，会影响主应用吗？

不会。Worker 与主线程隔离，Worker 崩溃不会影响主应用。但插件会停止工作，用户需要重新启用。请确保关键路径有 try-catch。

### Q: 如何测试插件？

Utopia 未提供内置测试框架。推荐方式：

- 使用 `uiApi.logger` 输出关键日志
- 利用 `window.__utopiaPlugins` 检查注册状态
- 在浏览器控制台手动触发事件测试
- 通过 `uiApi.dialog.form` 构造测试输入

---

**Utopia 插件系统开发说明** · v1.0 · 基于插件系统 v1.0.0

如有疑问，请在项目仓库提交 Issue 或联系维护者。