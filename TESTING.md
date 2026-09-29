# 测试指南

Utopia 的自动化测试。测试代码全部在 `tests/` 下，**不参与构建**，也不影响应用运行——删掉整个 `tests/` 与两个配置文件，应用仍照常工作。

---

## 快速开始

```bash
npm install                      # 安装测试依赖（首次）
npx playwright install chromium  # 下载 E2E 浏览器内核（首次）

npm test              # 跑全部 Vitest 用例（单元 + DOM + 集成）
npm run test:watch    # 监听模式，改代码自动重跑
npm run test:e2e      # 跑 Playwright E2E（会自动启动 server.py）
```

---

## 命令一览

| 命令 | 作用 |
|---|---|
| `npm test` | 全部 Vitest 用例，跑一次后退出 |
| `npm run test:watch` | 监听模式 |
| `npm run test:unit` | 只跑 `tests/unit`（纯逻辑） |
| `npm run test:dom` | 只跑 `tests/dom`（DOM 组件） |
| `npm run test:integration` | 只跑 `tests/integration`（引擎 + 存储） |
| `npm run test:coverage` | 生成覆盖率报告到 `coverage/` |
| `npm run test:e2e` | Playwright E2E |

带过滤的用法：

```bash
npx vitest run tests/unit/core/state.test.js   # 单文件
npx vitest run -t "escapeHtml"                 # 按用例名过滤
npx playwright test --project=chromium         # 只跑桌面端
npx playwright test --ui                       # 交互式调试
```

---

## 目录约定

```
tests/
├── setup/
│   └── vitest.setup.js      # 全局前置：fake-indexeddb、DOM 骨架、浏览器 API 垫片、日志降噪
├── helpers/
│   ├── dom-skeleton.js      # 应用 DOM 骨架的注入与重置
│   └── fixtures.js          # 最小 PNG、ST V2 / Utopia 角色卡等测试数据
├── unit/                    # 纯逻辑，零副作用
│   ├── importmap-alias.test.js
│   ├── core/                # state / utils
│   ├── modules/             # tokenBudget / sceneRegistry / profileDefaults
│   ├── ui/                  # 主题预设与视图状态机（微信主题）
│   └── utils/               # png
├── dom/                     # jsdom 环境下的 UI 组件
│   ├── toast.test.js
│   ├── banner.test.js
│   ├── modal.test.js
│   └── console.test.js
├── integration/             # 引擎 × 真实 IndexedDB（fake-indexeddb）
│   ├── db.test.js
│   ├── db-selfheal.test.js  # schema 失配的自愈与检测
│   └── emotionEngine.test.js
└── e2e/                     # 真实浏览器
    ├── smoke.spec.js
    ├── schema-recovery.spec.js
    ├── emotion.spec.js
    └── wechat-theme.spec.js     # 桌面/移动端按视口自动 skip
```

当前规模：**Vitest 17 个文件 / 430 例，E2E 4 个 spec / 27 例**（chromium 与 mobile-chrome 两个 project 各跑一遍，按视口自动跳过不适用用例）。

---

## 三个必须知道的约束

### 1. importmap 别名必须在测试侧复刻

`index.html` 用 importmap 把 `/js/` 与 `/lib/` 映射到项目根目录，源码里有 9 处依赖该映射的绝对路径导入（`core/api.js`、`core/eventBus.js`、`modules/injector.js` 等）。Node / Vite 默认会把前导斜杠当文件系统根路径，因此 `vitest.config.mjs` 里配置了同样的别名。

`tests/unit/importmap-alias.test.js` 专门守护这件事——改动别名配置会让它立刻失败，而不是让一堆无关用例报出难以定位的解析错误。

### 2. 不要逐个用例替换 `indexedDB`

有 6 个模块在模块作用域缓存了 stores 对象，绑定到具体的 IDBDatabase 连接：

```
character.js · chatOperations.js · conversation.js · settings.js · social.js · worldBook.js
```

（都是 `let _stores = null` 这种写法，且没有对外的失效接口。）

一旦底层库被删除或替换，这些缓存里的 store 句柄就失效了，后续操作会抛 `InvalidStateError`。所以**不要**在 `beforeEach` 里 `globalThis.indexedDB = new IDBFactory()`，也不要反复删库。

正确做法：依赖 Vitest 的**按文件隔离**——每个测试文件有独立的模块注册表，天然拥有全新的 fake-indexeddb 实例与全新的模块缓存。文件内部需要隔离时，用唯一 ID 而不是重建整个库。

### 3. 全局事件总线是「粘性」的

`js/core/eventBus.js` 用 `historySize: 10` 创建实例。按 `lib/event-bus/event-bus-core.js` 的设计，**新订阅者会立刻收到最近一次同类型事件**（默认只回放最后一条，`replayAll: true` 则回放全部）。

这意味着：

```js
// ❌ 会失败：listener 会先收到历史事件
globalEventBus.on('emotion:updated', listener);
await doSomething();
expect(listener).not.toHaveBeenCalled();

// ✅ 按业务主键过滤，只断言目标对象
const events = listener.mock.calls.map(args => args[0]);
expect(events.filter(e => e.characterId === char.id)).toHaveLength(0);
```

---

## 新增测试时的建议

**优先写纯逻辑测试。** `core/state.js`、`core/utils.js`、`modules/tokenBudget.js`、`modules/sceneRegistry.js`、`modules/profileDefaults.js`、`utils/png.js` 都是零依赖模块，测起来最快、最稳，回归价值也最高。

**测引擎时显式传 `emotionProfile` / `bodyProfile`。** 否则 profile 会由性格推导，断言只能写成方向性的（"变大/变小"），写不成精确值，回归能力大打折扣：

```js
const char = {
  personalityParameters: { neuroticism: 50, /* ... */ },
  emotionProfile: { emotionalDecayFactor: 1.0, /* ... */ },  // 让衰减系数确定
  emotionState: getInitialEmotionState(personality),
};
```

**DOM 测试用 `resetDom()` 收尾**（已在全局 `afterEach` 中自动调用）。它清空容器内容但**不重建**骨架节点——因为 `modal.js` / `toast.js` 在模块导入期就抓住了节点引用，重建会让它们持有游离引用。

**E2E 只断言应用自身的行为。** 不要在 E2E 里断言 CDN 资源（marked / DOMPurify / MiniSearch / Font Awesome）加载成功——离线环境下加载失败是预期内的。要守住的是「应用代码不抛未捕获异常」，用 `page.on('pageerror')` 捕获。

---

## 数据库 schema 自愈

`openDB()` 会在打开后校验实际 schema 与 `EXPECTED_SCHEMA` 的偏差，分两类处置：

- **缺表 / 缺索引** → 自动补全。关闭当前连接，用 `max(已有版本 + 1, DB_VERSION)` 重开触发 upgrade，由 `ensureSchema` 补齐，**不丢数据**。
- **主键路径（keyPath）不一致** → 无法就地修复，抛出 `SchemaMismatchError`，错误信息点名具体是哪张表、库中是什么、期望是什么。`checkDatabase()` 会把它转成 `{ok: false}`，应用随之弹出「数据库初始化失败 → 删除并重建」对话框。

这条路径对应一个实际线上问题：同源下存在「版本号相同但 schema 不同」的旧 `UtopiaDB` 时，`onupgradeneeded` 不触发，应用会带着缺表的库继续运行，最终在使用到缺失 store 的地方抛出难以定位的 `DataError`。

回归测试：`tests/integration/db-selfheal.test.js`（逻辑层）与 `tests/e2e/schema-recovery.spec.js`（真实浏览器，含数据保留验证）。

> 注意：自愈会抬升数据库版本号。`openDB()` 对 `VersionError` 做了兜底——若已有库版本高于 `DB_VERSION`，会改用其当前版本打开，不会因此启动失败。

---

## 冷启动耗时

E2E 的等待阈值直接取决于应用冷启动有多慢，所以这里留一份实测基线（本机沙箱，无缓存全新 profile）：

| 阶段 | 耗时 |
|---|---|
| `domcontentloaded` | ~2.1 s |
| `__utopiaReady`（init 全程结束） | ~3.0 s |
| 其中「网络阶段」（DOM 就绪 → init 完成） | ~0.8 s |

也就是说**应用自身冷启动约 3 秒**，`waitForFunction` 给到 45 s 已相当宽裕。若你观察到启动显著超过这个量级，基本可以断定是外部因素，按下列顺序排查：

1. **CDN 阻塞**。`index.html` 在 `<head>` 里以**阻塞式** `<script>` 引入 `marked` / `DOMPurify` / `MiniSearch`（jsdelivr）与 Font Awesome（cdnjs）。阻塞脚本会挡住整个 HTML 解析，任一 CDN 抖动都会让 `domcontentloaded` 一起推迟，表现为「白屏很久」。这是本项目启动耗时最大的外部变量。
2. **在线时间接口**。`syncTime()` 会请求淘宝与 WorldTimeAPI，失败属预期（离线时必然失败）。该请求已加 3 s 超时封顶（`js/modules/time.js` 的 `NETWORK_TIME_TIMEOUT_MS`），最坏只影响约 6 s。加这个封顶的原因是：`syncTime()` 在 `init()` 中被 `await`，早于 UI 事件绑定，接口卡住会让「页面渲染出来了但点什么都没反应」。
3. **语义模型初始化**。仅当 `settings.semanticModelId` 有配置时才会加载本地 ONNX 模型（约 122 MB），默认未配置，跳过。

---

## 已知的环境限制

- **`openDB()` 返回的连接不受单例管理。** 只有 `getDB()` / `getStores()` 走 `dbInstance` 缓存。测试里直接调用 `openDB()` 时必须自己 `close()`，否则后续 `deleteDatabase()` 会 `onblocked`。
- **E2E 串行执行。** 应用冷启动要加载 40+ 个 ES 模块、建 11 张表，还会尝试访问在线时间接口（离线时会等到超时）。并发多个页面资源竞争明显，曾导致启动等待超时，因此 `workers: 1`。
- **E2E 造旧库要借 404 页面。** `tests/e2e/schema-recovery.spec.js` 需要在一个「不加载应用」的同源页面上先造好旧库再导航到应用；若先打开应用，它会持有连接，`deleteDatabase` 会被阻塞。这里用 `page.goto('/__seed__')`（404 页）取得同源环境。
- **E2E 等待就绪要用 `window.__utopiaReady`，不要用 `window.__eventBus`。** 后者在数据库校验通过后就挂载（`app.js` 中 init 的早期），此时侧栏各按钮的事件绑定还没执行完，点击 `#settingsBtn` 不会有任何反应。`__utopiaReady` 在 init 全程结束时才置位。
- **窄屏下点侧栏按钮要「开抽屉 + 展开次级行」两步。** `js/ui/layout/sidebar.js` 按 `isMobile` 分支重建 footer：桌面端 8 个按钮平铺；窄屏端拆成 `primary-row`（主题/朋友圈/世界书/插件）与 `secondary-row`（设置/导入/创建/创建群组，初始 `display:none`），且整条 `#sidebar` 是抽屉式（`translateX(-100%)` 配 `.open`）。所以窄屏下 `#settingsBtn` 的尺寸是 `0×0`，直接点击会一直等到超时。`tests/e2e/emotion.spec.js` 的 `openSettings()` 统一处理了这两步。
