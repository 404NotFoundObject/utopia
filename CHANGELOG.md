# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [3.9.6] - 2026-10-05

移动端 PWA 导航与安全区适配、朋友圈交互对齐微信；修复离线长跨度下的睡眠债建模、`/print` 计数恒为 0、`/undo` 与群聊发消息两处实机不可用。

### 移动端 / PWA

- **返回手势与返回键（新增 `js/ui/layout/backNavigation.js`）**：应用是纯 DOM 切屏、不产生历史记录，此前在 PWA 里按返回手势/返回键会直接退到桌面，只能点顶部返回按钮。新增基于 `pushState` 的视图栈并接入两层——`modal.js`（所有模态二级页：朋友圈、设置、世界书…打开即占一条历史记录）与 `wechatTheme.setMobileView`（聊天页 ↔ 列表层）。栈顶 id 校验免疫「关闭后立刻重开」等竞态；UI 上的关闭按钮仍走 `releaseView + history.back()`，行为不变
- **安全区适配**：`index.html` 补上缺失的 `viewport-fit=cover`（页面延伸进状态栏/手势条的前提）。朋友圈封面高度改为 `calc(240px + env(safe-area-inset-top))`，背景图铺进状态栏（与微信一致），顶栏返回/相机按钮、磨砂栏与标题按 inset 下移；底部 dock 的 `height` / `padding` 加 `env(safe-area-inset-bottom)` 贴到屏幕底缘，消除那条缝隙；列表层与 `#app` 按安全区退让

### 朋友圈

- **发布交互对齐微信**：移除顶部「+ 发布」按钮与整条白色 `social-header`（顶部不再有白条）；**右上角相机按钮改为发表动态**（转发给隐藏的发布按钮，发布框逻辑零改动复用）；**点击封面区域更换背景图**（头像/昵称区除外）
- **移除机械兜底文案**：AI 调用失败或返回空时，`generateComment` 兜底「哈哈哈，有趣！」、`generatePostContent` 兜底「今天心情不错，发条动态。」——这两句会直接出现在用户的朋友圈里。改为重试 2 次后返回 `null`，调用方跳过（不评论 / 不发帖）；`commandEngine` 的发帖计数与自动发帖循环补上判空，失败不再计入成功数。宁缺毋滥

### 修复

- **离线长跨度下的睡眠债建模（真实缺陷）**：好几天不打开、再次上线持续推进时，角色会一直处于睡觉/昏厥状态并莫名其妙生病。两个缺陷叠加——**(a)「困倦」是死胡同**：全仓唯一的自然入睡通道是 `energy < 10 && sleepiness > 90`，等价于「必须先昏厥才能睡觉」，实测要连续清醒约 58 游戏小时；**(b) 单 tick 巨量 hours 不分段**：`updateBodyByTime` 只在入口做一次 `isSleeping` 判定就把整段 hours 一次性套用，离线 3 天整段算作一次清醒，睡眠债一口气顶到「需求 × 3」的上限，随后每小时按 1.5% 掷缺觉致病。改法：抽出 `simulateBodyStep`，按 `BODY_STEP_HOURS = 1` 分段推进（`BODY_MAX_STEPS = 720` 兜底），每步用**该步自己的游戏时刻**算昼夜节律与时段（`getTimePeriod` 改为接收 date），只在末尾落库一次；补上 困倦 → 浅睡 → 深睡 的自然入睡通道（夜间阈值降到 60，即到点就寝），并保留 `0.05 × neuroticism / 小时` 的失眠概率门控
  - 实测对照（离线 72h，`sleepNeedHours = 8`）：修复前 → 深睡/昏厥、energy 0、sleepiness 100、health 37.1、债务 24h（上限）；修复后 → 清醒/清醒、energy 89.9、sleepiness 28.7、health 96.9、债务 1.67h
- **affection 衰减乘数方向相反**：`emotionEngine` 里 `affectionBaseK` **除以** `decayMultiplier`，与六维 `k *= decayMultiplier` 反向，也与注释写的「恢复快」相反。改为相乘；下限 `0.3` 保留作防呆（`emotionalDecayFactor` 为 0 时好感不至于永久冻结）
- **`/print` 记忆条目数恒为 0**：用 `searchMemories(char.id, '', 1000)` 计数，而该函数对空查询直接返回 `[]` —— 拿检索函数当计数器必然得 0。改用 `getMemoriesByCharacter(char.id)`
- **`/undo`、`/regen` 恒提示「正在生成回复」**：不是 `sending` 卡死（所有写点都有 `finally` 复位），而是结构性恒真——命令只能在 `sendMessage` / `sendUserGroupMessage` 内部执行（全仓仅两个 `executeCommand` 调用点），那两个入口早已 `state.set('sending', true)`，处理器里再查 `sending` 必然为 true。真正的防重入由发送入口「sending 时直接 return」承担
- **群聊发消息 `ReferenceError: getGroupMembers is not defined`**：`groupChat.js` 用 `export { getGroupMembers } from './groupMembers.js'` 做再导出，而**纯再导出语法不在本模块作用域创建绑定**，本文件内部 4 处裸调用全部在运行时炸，群聊第一条消息就发不出。改为顶部正常 `import` 再 `export`；顺带修了 `character.js` 动态 import 只给内层挂 catch、模块加载失败会冒 unhandledrejection 的问题

### 新增：`/status` 可修改数值（新增 `js/modules/statusFields.js`）

- 语法：`/status health 90`（绝对值）、`/status health +5`（相对增减）、`/status valence =-50`（`=` 前缀表示绝对值负数，消解与「减 50」的歧义）；`/status fields` 列出全部字段与值域；群聊支持 `/status @成员 字段 值` 指定目标
- 覆盖 25 个数值字段（`body.*` / `emotion.*` / `needs.*`），越界自动 clamp 并回报；写入走深合并并同步 `lastUpdate` 时间基准，否则下一 tick 会用陈旧时间把新值冲掉

### 内部重构

- **PNG `tEXt` 解码收敛为唯一实现**：`png.js` 与 `characterAdapter.js` 各有一份且**已经漂移**（前者只认 `chara\0` / `chara `，后者还认 `chara` 直连载荷与裸 JSON）。而应用实际走的是 `characterAdapter.parsePNG`，测试却主要覆盖 `png.js` 那份，漂移长期被掩盖。唯一实现下沉到 `utils/png.js`，`extractJSONFromPNG` 改为调它，`characterAdapter` 用别名导入后再导出（既有 import 零改动）

### 测试

- 新增：`tests/unit/modules/statusFields.test.js`（18 例）、`tests/integration/statusCommand.test.js`、`undoRegenCommand.test.js`、`groupChatBinding.test.js`、`pngCardRoundTrip.test.js`（7 例）、`tests/unit/ui/backNavigation.test.js`、`tests/unit/ui/wechatTheme.test.js` 相关例
- **端到端改走真账**：PNG 测试此前全是自产夹具（手搓 tEXt 字节直接喂给解码函数，从未走过 `parsePNG`）。新增的 `pngCardRoundTrip.test.js` 走真实链路：`embedJSONToPNG` → `File` → `parsePNG`（经 FileReader）→ `detectFormat` → `convertToUtopia` → `importCharacter` 落库，并加结构性防重复守卫 `adapter.extractTextChunk === png.extractTextChunk`（引用相等，谁再抄一份就挂）
- 反向验证：关闭分段推进 / 入睡通道 / base64 解码、恢复机械兜底文案与纯再导出、恢复 `/undo` 的 sending 检查——五组共 10 处精确失败，还原后全绿
- 顺带修好一条既有的稳定失败：「朋友圈为页面模式」此前在纯 HEAD 上 3/3 稳定失败——根因是隐藏 header 后 6 帖的滚动余量不足以让封面完全出场，磨砂态永不触发，铺帖加到 12 条后通过

---

## [3.9.5] - 2026-10-04

世界心跳与版本子系统落地；微信主题样式按需加载、朋友圈视觉统一；修复数据库自愈的「自阻塞」真实缺陷与插件模块链初始化缺陷。

### 新增

- **世界心跳（P3-4）**：新增 `js/core/worldTick.js` 作为唯一 1s 心跳，收敛 `app.js` 里三条各自为政的 `setInterval`。核心修复：后台 tick 不顺延 → 回到前台立即补跑（此前离开页面再回来，世界里的时间是停的）；async 重入保护；顺延排在 `time.js` 的 `visibilitychange` 之后，避免状态错位。配套 `tests/unit/core/worldTick.test.js`（12 例）
- **版本子系统（P3-10 阶段 B）**：新增 `version.json` 作为独立于应用资源的版本通道，配套 `js/core/appMeta.js`（运行期唯一版本真源）与 `js/core/updateChecker.js`（每 30 分钟 / 页面重新可见时检查，发现新版本主动清 SW 缓存并 reload——此前用户会长期停在旧壳上）。设置页新增「关于」面板（`settingsUI/sections/aboutSection.js`），展示版本号与最后检查时间，可手动检查更新、清除缓存并重载
- **发布脚本**：`scripts/release.mjs`——一处输入版本号，同步 `appMeta.js` / `package.json` / `version.json` / README 徽章四处副本（此前手工改必然漏改，导致 SW 缓存名陈旧与「设置页版本与实际不符」）

### 朋友圈

- **移除头部「🌐 朋友圈」标题**：sticky 顶栏标题由 `wechatTheme.js` 独立注入，不依赖此标题，返回后顶栏仍有标题。头部背景由 `transparent` 改为与帖子一致
- **帖子区域背景统一**：`.social-feed` / `.social-posts` / `.social-publish-box` 由灰底 `--color-bg-secondary` 改为与帖子同色；微信主题下该变量为 `#f5f5f5` 与白卡不同值，故显式覆盖为 `#ffffff` / `#1f1f1f`（dark）。消除帖子上下灰色空白与白卡的割裂

### 微信主题

- **`css/wechat.css` 改为按需加载**：从 `index.html` 移除常驻 `<link>`，改由 `wechatTheme.js` 激活微信主题时注入、停用时移除——非微信主题下这几十 KB 规则不再参与样式匹配。注入点强制插在 `titlebar.css` 之前（窗口装饰器依赖加载顺序覆盖 wechat 变量）；`sw.js` 补 `EXTRA_PRECACHE` 显式预缓存（移除 link 后预缓存爬取已不可达，否则离线切微信主题会缺样式）
- **消除按需加载引入的 FOUC**：注入前挂 `html[data-wx-loading]` 禁用全站过渡（否则 `main.css` 的 `* { transition: background-color 250ms }` 会让整页背景做动画），加载后双 rAF 解除；`activateWechatTheme` 等样式表真正就绪，`app.js` 在置 `__utopiaReady` 之前 `await initWechatTheme()`——启动恢复路径不再闪
- **皮肤生命周期对称**：`wechatTheme.js` 的副作用全部登记 `disposers` 回收（阶段 C）

### 修复

- **数据库自愈「自阻塞」（真实生产缺陷）**：`DB_VERSION` 与旧库同版本时首次 open 不触发 upgrade，自愈发现缺表后 `db.close()` 立即 `openAtVersion(更高版本)`，而 `inspectSchema` 的只读事务尚未提交、连接仍在占位 → **自己把自己 blocked** → 旧逻辑在 `onblocked` 里立即 reject → 弹出「数据库被其他页面阻塞 / 删除所有数据重建」。三处修复：`inspectSchema` 改异步并等事务 `oncomplete` 后再返回（治本）；`onblocked` 由立即失败改为只告警并等待（blocked 是可恢复中间态），加 10s 超时兜底；`getDB()` 单例注册 `onversionchange` 主动释放连接。危害不止测试——真实用户缺表自愈时会被推进「删除全部数据」的不可恢复对话框
- **插件模块链初始化缺陷**：`pluginApi → modules/index → chat → chatUI → uiBridge → pluginRuntime → pluginApi` 成静态环。以 `pluginApi.js` 为入口会 TDZ 崩溃（`Cannot access 'eventBroadcaster' before initialization`），以 `modules/index.js` 为入口会 `Object.keys(undefined)` 崩溃。修复：`let eventBroadcaster` → `var`（消除 TDZ，已加注释禁止改回）；自动装载循环改 `ensureModulesLoaded()` 惰性执行，由 `resolveApiMethod` / `invokeApiMethod` / `listApiMethods` 首次调用触发。浏览器入口顺序本就安全（app.js 动态 import 插件），故此为排雷而非修生产事故——现在任意入口顺序都免疫
- **关于 / 帮助**：移除「版本号以 js/core/appMeta.js 为准」的内部实现说明；「最近检查」两行合一为「最后检查时间：yyyy-mm-dd hh:mm:ss」（补秒）；使用指南同步到当前版本并新增「关于」小节

### 测试

- 新增：`tests/unit/core/worldTick.test.js`、`updateChecker.test.js`、`versionConsistency.test.js`、`tests/unit/ui/settingsSections.test.js`、`themeVars.test.js`、`wechatThemeLifecycle.test.js`、`tests/unit/plugins/pluginApiEntry.test.js`、`modulesIndexEntry.test.js`、`pluginApiSurface.test.js`、`tests/e2e/social-visual.spec.js`、`update-check.spec.js`、`tests/e2e/helpers/wx-theme-ready.js`
- 去重：抽出共享的 `waitForWxStylesheet` helper；「wechat.css 已注入且排在 titlebar.css 之前」的断言归并到 `wechat-theme`（主题层职责），`social-visual` 只保留朋友圈视觉断言
- `schema-recovery.spec.js` 第三例此前断言的是已被废弃的旧契约（空错配 store 按 A-2 缺陷③应无损重建、不报错），补种「缺新主键字段」的记录后才真正命中不可无损迁移路径

---

## [3.9.4] - 2026-10-03

朋友圈界面第二轮对齐微信；内部重复实现收敛为单一来源（无用户可见行为变化）。

### 朋友圈

- **点赞与评论合并进同一个灰底容器**：原先点赞行与评论区是两块独立圆角条，中间断开且都有各自底噪。现改为微信式单一灰底容器——点赞在上、白色细线分隔、评论在下；既无点赞也无评论时不再渲染空容器
- **评论文案改为微信格式**：「名字: 内容」「A 回复 B: 内容」，统一半角冒号（原先混用全角「：」，回复还缺空格），作者名与 @ 对象同色链接蓝
- **点赞名单改链接蓝**，不再用「、」拼接的纯文本；「···」横排三点改为两枚小圆点图标，操作菜单改向上弹出（原先向下容易顶出可视区）
- **图片排版按微信规则**：单图大图（保持原始比例，不再被 1:1 裁切）、4 图 2×2、其余 3 列九宫格
- **首次评论无需重载即可评论**：点「评论」时若容器尚未创建，动态建立灰底区域再展开输入框（原先容器恒存在的判断被去掉后会出现点评论无反应）
- 补充端到端回归 `tests/e2e/social-reply.spec.js`，覆盖「回复显示回复对象 → 角色接话 → 二次回复同一条」完整链路

### 内部重构（P3-5）

以下四处此前在多个文件里各存一份实现，本次收敛为唯一来源，行为零变化：

- **余弦相似度**：3 份 → `js/core/vectorMath.js`（`memory.js` 原有的维度不匹配告警通过 `onMismatch` 回调保留）
- **路径取值**：2 份 → `lib/pathUtils.js`（保持中立，`api-adapter/utils.js` 继续原样导出，不让 injector 反向依赖适配器）
- **群成员查询**：2 份 → `js/modules/groupMembers.js`（`groupChat.js` 已单向依赖 `groupChatEngine.js`，只能抽第三方模块；`groupChat.js` 改为 re-export，20+ 个调用点零改动）
- **角色更新锁**：`character.js` 的私有锁与 `db.withKeyLock` 逐行等价 → 改用 `withKeyLock('character', id, fn)`

新增 27 例测试：`tests/unit/core/vectorMath.test.js`、`tests/unit/lib/pathUtils.test.js`、`tests/integration/groupMembers.test.js`、`tests/integration/characterUpdate.test.js`。四项均做反向验证（临时还原旧实现后测试确实失败）。

---

## [3.9.3] - 2026-10-03

本轮收尾一次完整代码审计的遗留项（C 级 13 项全部清零），并落地睡眠债建模与朋友圈交互重构。

### 朋友圈

- **修复回复不显示回复对象**：回复新增 `replyToAuthorType` / `replyToAuthorId`，界面按微信习惯显示「A 回复 B：…」；旧数据渲染时自动回落为被回复评论的作者，不会错乱
- **修复角色不再接话**：角色回过一次后，用户再回复所触发的接话调度被 `hasCharacterReply` 守卫掐断，导致每条评论角色只肯回一次。改为用户驱动的接话绕过该守卫，守卫只负责防止帖主对同一条评论反复自动接话
- **修复回复「某条回复」无人接话**：`userCommentPost` 新增定向回复参数，点击任意回复即可回应它，由该回复的角色作者接话
- **新增点赞**：`togglePostLike` 支持点赞与取消，点赞人以名单形式展示在灰底点赞行
- **界面微信化重构**：左侧方形圆角头像 + 蓝色昵称 + 正文 + 相对时间（刚刚 / X 分钟前 / X 小时前 / 昨天 / X 天前 / 日期）；右下角「···」弹出深色「赞 / 评论」菜单（自己的帖子含删除）；点赞行与评论区改为微信式灰底圆角条与链接蓝昵称；点击评论或回复行直接进入回复输入。图片九宫格渲染同步就位（3 列、1:1 裁切），配色走 CSS 变量以适配浅色 / 深色 / 微信主题

### 身体状态引擎（睡眠债）

- **新增睡眠债建模**：清醒时按「每日睡眠需求 ÷ 24」持续累积缺觉，睡眠时按「时长 × 睡眠质量」偿还（午休按 80% 效率），上限为每日需求 × 3。债务会放大睡意增速、清醒时的精力消耗与健康衰减，睡着时反而恢复更快（补觉睡得更沉）；无睡意的特殊体质债务恒为 0，老角色缺字段自动补齐
- **修复「长期不睡会生病」从未实现**：生病此前只看 `health < 50`，熬几个通宵毫无影响，FAQ 的说法是空头承诺。现在睡眠债超过每日需求 1.5 倍时独立触发生病判定（病因池为感冒 / 发烧 / 头痛），健康值 90 熬通宵也会病倒
- **激活三个死字段**：`totalSleepHours` 改为「当日已睡小时数」（跨游戏日清零，参与结算并展示）、`lastNapDate` 用于「今日已午休」、`dreamContent` 由睡醒时的梦境生成写入
- **新增梦境生成**（默认关闭）：设置 → 三大引擎控制 → 梦境生成。开启后角色睡醒时由 AI 生成一段梦境并注入提示词，每日每角色一次；AI 不可达时回落内置模板。关闭时零 API 调用
- `/status` 与身体状态描述新增「睡眠债 / 今日已睡 / 今日已午休」

### 数据完整性

- **修复备份「写得出、导不回」**：备份补齐 `lastMode` / `lastCharacterId` / `lastGroupId` 与插件 VFS（记录 + 文件 + KV），新增版本头（`_format` / `_version` / `_exportedAt`）与导入前校验，并新增完整的导入恢复路径（此前只能导出不能恢复）
- 修复数据重置的 localStorage 清理从未验证：改为先收集后删除 + 读回校验 + 按 `utopia:` 前缀全量清理，并补上遗漏的 `utopia:pending-call-end`

### 角色卡

- 修复原生角色卡往返一次性格被静默重掷：`quantifyCharacter` 失败时的兜底值全 50 被当成成功结果写库（`catch` 分支实为死代码），现改为标记 `failed`，调用方检测到失败且已有参数时保留原值；跳过量化的条件去掉 `lastQuantifiedAt`，自带参数的原生卡不再被重掷
- 修复通用格式缺类型守卫：`toSafeText` 通用化并新增 `sanitizeUtopiaTextFields`，原生直通不再产出 `[object Object]`

### 记忆与适配器

- 修复记忆预算裁剪按「行」累积导致条目被拆断（改为先按条目切分、整条累加，条目不可拆分）
- 修复模型能力判定的供应商前缀 id（`openai/o3-mini` 之类）不匹配：剥离 `/` 前缀后双路匹配
- 修复日志声称禁用 penalties 但实际从未禁用的表述与行为不符（改为逐项列举实际禁用的字段，不改行为）

### 事件总线与插件

- 修复 `eventBus.off` 语义回归与 `once` 清理误删：`off` 改回「移除首个」以对齐 EventEmitter 语义，新增 `offById(id)` 让 unsubscribe 与 once 清理按订阅 ID 精确解绑（按 callback 匹配会连带注销同函数的持久订阅）
- 修复粘性事件重放按字面事件名索引，通配符订阅（如 `user:*`）永远收不到重放：改为对通配符订阅收集所有命中事件的历史并按时序归并，重放时补真实事件名作首参
- 修复粘性事件参数只存引用，外部修改对象后新订阅者回放的是改后的值（改为 structuredClone 快照，不可克隆时回退浅拷贝）
- 修复 `pluginDragDrop.destroy()` 抛 `ReferenceError: ghostEl is not defined`（`ghostEl` 提升为闭包级）

### 工具

- 修复 `server.py` 在 Windows 控制台按 Ctrl+C 后卡死、无法停止：信号处理器内直接调用 `httpd.shutdown()` 会阻塞等待 `serve_forever()` 结束，而处理器恰恰运行在 `serve_forever()` 的调用栈上（主线程），构成自死锁。改为只做非阻塞收尾（置停止标志 + 释放唤醒锁），另派守护线程执行关闭
- 修复 `server.py` 的 `allow_reuse_address` 在 `bind()` 之后才赋值导致端口复用失效（重启时易误报「端口被占用」），改为在服务器子类上声明

---

## [3.9.2] - 2026-10-02

### 数据完整性

- 修复数据库主键错配迁移非原子：主键写回移入 `onupgradeneeded` 同一 versionchange 事务（read + delete + create + put），失败自动回滚、旧数据不丢；校验显式排除 `null`/`undefined` 主键（`{id:null}` 不再误判）；空错配 store 改为无损重建
- 修复数据库错误弹窗提示不完整：补充「迁移可能已清空部分数据，删除重建前可先导出备份」

### 角色卡

- 修复 SillyTavern PNG 卡端到端断链：`chara\0` 后 base64 载荷正确解码（新增 `base64ToUtf8`），此前直接返回 base64 导致解析失败；顺带修复中文 base64 乱码（`atob` 逐字节转 Latin-1 损坏多字节 UTF-8）

### 朋友圈

- 修复情感衰减高倍速下符号翻转（`affection` 改解析解 `*= Math.exp(-k)`，负值 0.5x；`needs` 改渐近；速率因子防非有限值）
- 修复朋友圈调度持久化失败（改用 `update` 注入主键，替代无主键 `add`；写后读回验证）
- 修复朋友圈社交内容生成全是预设文案：发帖/评论/回复的 `systemPrompt` 由写死的通用助手改为注入完整角色人设（名称/描述/性格/关系/称呼/性别/核心提示词），此前仅用常为空的 `personality` 字段
- 修复角色从不评论用户帖子：评论数随机到 0 有 1/3 概率，改为至少 1 条、候选为空时提前返回
- 修复朋友圈全局每日上限计数错误（单角色计数当全局总数混加），改为跨角色累加

### 适配器与管线

- 修复 SSE 解析不识别 CRLF 事件边界（按 `\r\n`/`\r`/`\n` 统一切分），移除死代码 `flushCurrentEvent`
- 修复 Google 流式可能返回空：`alt=sse` 改为无条件拼接（抽出纯函数 `buildGoogleStreamUrl`）
- 修复 Cohere 半成品 v2：整体迁移 v2（`/v2/chat` + 单一 `messages` 数组 + `message.content[].text` 响应），删除 v1 三字段死代码
- 修复朋友圈回流仅在单聊生效：接入群聊 / 通话 / 自主对话三条管线，新增独立 `SOCIAL` 优先级（低于记忆，预算紧张先裁剪）
- 修复情感回路三路径未闭合：群聊同步路径补情感引擎更新，新增 `proactive_share`（主动分享）事件用于自主对话与发帖

---

## [3.9.1] - 2026-10-01

本轮包含一次完整代码审计后的系统性修复，覆盖安全、数据完整性、正确性与健壮性，并同步实机反馈。

### 安全

- 修复插件 `loadModule` 权限绕过（一行即可读取全部数据与 API Key）
- 修复数据重置非事务（主库已删但插件库残留仍报"成功"），改为分步报告并新增「导出数据备份」
- 修复主题导入任意变量覆盖（可覆盖应用变量、`url()` 值可作信标），改为白名单键名 + 颜色值校验

### 数据与正确性

- 修复 SillyTavern PNG 卡双向不兼容（tEXt 载荷格式不符），写入改用 `chara\0` + base64，读取兼容两种关键字与两种载荷
- 修复 Google / Cohere 适配器非流式路径永远返回空（响应键未归一为 `choices`）
- 修复 SSE 解析不处理 CRLF 导致回复静默变空
- 修复情感衰减在高倍速下符号翻转（改用解析解，不再线性超调）
- 修复角色卡转换静默丢字段（世界书、备选开场白、原生往返重掷性格）
- 修复 `detectFormat` 认不出真实 ST v2 JSON 信封
- 修复数据库无记录级迁移（keyPath 不匹配时按数据重建主键）

### 引擎与管线

- 抽取共享 `buildChatContext` / `buildFinalMessages` / `applyEngineEffects`，统一单聊 / 群聊 / 通话 / 自主对话四条管线的预算计算与情感闭环；通话与群聊补上情感/身体状态更新
- 修复群聊跨角色台词污染记忆（递归台词不再写成「用户曾说」）
- 修复朋友圈无开关无上限的 AI 自主发帖，新增开关与每日/单角色上限
- 修复朋友圈动态不回流聊天（角色看不到他人评论），新增社交上下文注入
- 修复评论调度为内存定时器（关标签页即丢），改为持久化调度

### 健壮性

- 修复 STT 不支持时的无限重试循环、`stop()` 无法取消在途 TTS、`kokoroApiKey` 保存不发送
- 修复硬编码 60 秒超时覆盖整个流式响应（改为首字节超时）
- 修复自动发言概率随倍速上升、群聊成员数无上限
- 修复离线推进丢失倍速分辨率（分段积分替代单一倍速）
- 修复 hybrid 记忆「拼接」而非「融合」（改用 RRF 融合）、记忆预算「全有或全无」（改为条目级裁剪）
- 修复模型能力判定硬编码正则、`adaptStream` 丢弃命名 SSE 事件、Cohere 走 v1 未处理 v2 事件
- 修复 `eventBus.off` 只移除首个回调、`state.js` 无 `unsubscribeAll`、主题制作器关闭不 abort、`toast`/`modal` 模块加载期捕获 DOM 等一批泄漏与失效
- 修复 `/call` 守卫死「昏厥」分支、敏感场景靠中文字符串比对、`priority || 100` 吞显式 0 等一批边界

### 实机反馈

- PWA 安装期递归预缓存全部同源代码，动态导入的功能模块离线可用
- 移动端键盘行为统一（`interactive-widget=resizes-content`），输入框始终贴键盘上方
- 微信主题移动端会话列表行高对齐微信、朋友圈返回/相机按钮固定顶栏

---

## [3.9.0] - 2026-09-30

**新增微信主题（实验功能）：以主题而非平行 UI 的方式提供微信观感。**

### 微信主题

- **新增内置主题 `wechat`（浅色）与 `wechat-dark`（暗色）**，在主题下拉中以「微信 · 实验」提供，走既有主题通路（`THEME_PRESETS` → `applyTheme`），不引入第二套 UI 结构
- **配色对齐微信**：品牌绿 `#07C160`、用户气泡绿、对方气泡白/深灰、微信灰阶与红色系，圆角体系收紧为微信式小圆角
- **气泡还原微信形态**：靠头像一侧伸出小尾巴，气泡内不再显示时间戳，宽度收窄至 72%
- **方形圆角头像**：以更高特异性覆盖既有「头像强制圆形」规则，`--radius-full` 不动，开关滑块等圆形控件不受影响
- **聊天顶栏只显示名称**：顶栏底色与聊天页一致，去分割线、以淡淡投影分层
- **桌面端**：侧栏底部按钮重排为最左垂直图标栏（纯 CSS 定位，DOM 不动），顶部显示用户头像；输入区微信化——加高、带描边圆角外框、右下角「麦克风 + 绿底发送」文字按钮
- **移动端两层视图**：`#sidebar` 变为全屏会话列表层，选中后进入对话页（头部返回按钮）；底部 dock 精简为「聊天/插件/朋友圈/设置」，其余动作收进「+」菜单
- **朋友圈页面化**：移动端全屏（封面可上传背景图），PC 端居中悬浮窗（520px 定宽、12px 圆角）
- **修复非微信主题朋友圈布局错乱**：封面仅微信主题注入，切回其他主题自动清除残留
- `wechatTheme.js` 维护移动端视图状态与注入节点，`MutationObserver` 兜底按钮重建，非微信主题下零副作用

### PWA

- **可安装为应用**：新增 `manifest.json` 与 Service Worker（同源静态资源 stale-while-revalidate、离线应用壳、跨域与写请求不拦截），缓存按版本命名
- 新增三档应用图标（192/512/maskable-512）
- 窗口装饰器色跟随主题底色，主题切换即时更新
- **窗口装饰器自绘与磨砂玻璃（实验）**：`display_override` 声明叠加层，`#pwaTitleBar` 自绘标题栏，支持磨砂玻璃开关与不透明度/模糊半径/取色来源调节。注意：`display_override` 变更需卸载重装后生效

### 测试

- 新增微信主题变量完整性、视图状态机、注入节点、朋友圈封面、窗口装饰器、PWA 资源完整性单测
- 新增 E2E：主题变量注入、图标栏、方头像、气泡尾巴、输入区布局、移动端两层视图、朋友圈悬浮窗、非微信主题回归
- `check:pwa` 新增「窗口装饰器」检查组

---

## [3.8.0] - 2026-09-27

**情感感知引擎重写 + 自动化测试模块。**

### 情感感知引擎

原有的意图识别是「词在不在串里」的累加匹配，无法区分否定与第三方施事，因此本次重写为三层级联。

- **新增规则层**：子句切分（按标点与转折连词，后置子句权重更高）+ 否定检测（限定窗口内奇偶判定，支持双重否定）+ 施事/受体识别 + 正负极性冲突检测
- **新增否定例外词表**：34 个含否定字但语义肯定的词（`特别`、`不错`、`忍不住` 等），避免把 `特别喜欢你` 的「别」、`不错` 的「不」误判为否定
- **新增语义层**：原型句向量 kNN，复用已内置的 `paraphrase-multilingual-MiniLM-L12-v2`，不新增任何依赖
- **LLM 仲裁改为按证据冲突触发**：判据从「分数是否够高」改为「前两名差距是否过小或极性是否矛盾」，避免命中词多的句子永久跳过仲裁
- **事件类别 12 → 18**：新增 `rejection`（拒绝疏离）、`rival_affection`（第三方示好）、`reassurance`（安抚澄清）、`gratitude`（感谢）、`complaint`（抱怨）、`teasing`（调侃）
- **六个新类别各自的影响向量**：六维情绪 + 五类需求 + 三类关系，并按生理反应最接近的原则归并到身体状态引擎
- **新增情绪识别调试面板**：展示子句切分、每处命中的否定/施事/受体判定、两层得分与融合权重、LLM 是否触发；支持实时输入与快捷样例试跑。入口在 设置 → 引擎，命令行为 `/emotion`
- **设置新增「情绪识别」分区**：语义层开关（关闭 / 自动 / 总是启用）与 LLM 仲裁开关，含既有配置的自动迁移

### 数据库

- **schema 自愈**：打开数据库后主动探测实际结构与期望 schema 的偏差
  - 缺表 / 缺索引 → 自动抬升版本号触发 upgrade 补齐，**不丢数据**
  - 主键路径不一致 → 无法无损修复，抛出明确错误并提示用户重建
- 增加数据库版本高于当前常量时的兜底打开，避免自愈抬升版本后反而无法启动

### 稳定性

- 网络时间校准请求增加超时上限。此前该请求无超时且在启动流程中被等待，网络受限时会连带阻塞界面事件绑定
- 启动失败提示改为携带真实原因，不再只有「请刷新重试」
- 新增应用就绪标志，供自动化测试与外部集成判断「已完全可交互」

### 自动化测试

- **新增 Vitest 测试模块**：18 个文件 / 440 个用例，覆盖单元逻辑、DOM 组件、存储与引擎集成
- **新增 Playwright E2E**：覆盖应用冷启动、数据库 schema 恢复、情绪识别接线、微信主题（桌面与移动两个视口）
- 新增 `TESTING.md` 说明运行方式与测试侧约束
- 新增 `npm test` / `test:watch` / `test:unit` / `test:dom` / `test:integration` / `test:coverage` / `test:e2e` 脚本

### 修复

- 修正 `js/modules/time.js` 中一处断裂的动态导入（指向不存在的模块），该问题使 `/reset` 命令必然抛错
- 修正 `checkDatabase()` 的两个缺陷：对 `IDBRequest` 的无效等待（实际未校验）与未关闭连接

### 清理

- 移除代码中的修复记录与开发过程痕迹（含任务编号型标记），保留 JSDoc、功能说明与设计约束

---

## [3.7.1] - 2026-09-21

**首次开源发布。**

经过长期内部迭代，整合完成首个公开版本。包含以下核心能力：

### 核心架构

- **纯前端架构**：无后端、无构建工具，浏览器打开即用
- **本地优先**：所有数据存储于浏览器 IndexedDB，不上传任何服务器
- **多厂商 API**：内置 OpenAI / Anthropic / Google Gemini / Cohere / DeepSeek / Mistral / Groq / Perplexity / xAI 共 9 家适配器
- **角色卡兼容**：支持 Utopia v3.1 / SillyTavern v2/v3（含 PNG 卡）/ Character.AI / 通用格式

### 三引擎

- **情感引擎**：六维情绪 + 五类需求 + 三类关系，事件驱动 + 时间衰减
- **身体状态引擎**：精力 / 睡意 / 健康 / 睡眠周期 / 疾病 / 受伤 / 意识状态，含午休子系统
- **时间引擎**：游戏时间 1x ~ 48x 可调，离线自动推进，网络时间校准
- 三引擎相互影响，形成闭环；任一引擎可独立关闭

### 记忆系统

- **三层记忆**：全文检索（MiniSearch）+ 语义检索（Transformers.js 本地向量）+ 对话摘要
- **三种检索模式**：`keyword` / `semantic` / `hybrid`
- 记忆检索阈值独立可调，与世界书语义阈值分离

### 世界书系统

- 四种规则类型：条件触发 / 常驻注入 / 语义触发 / 粘性
- 嵌套条件：AND / OR / NOT 任意组合
- 支持规则组、规则链、互斥组、宏模板、概率触发
- 可视化条件编辑器
- 语义触发：基于自然语言的语义相似度匹配

### 群聊

- 多角色同屏对话
- @ 提及 + @ 触发回复链（深度 1 层）
- LLM 裁决发言
- 自主发言轮询
- 三重防循环保险（深度限制 + 回复去重 + 自我排除）
- 群聊摘要自动生成

### 语音

- **TTS**：Web Speech API / Kokoro / OpenAI 兼容 API
- **STT**：Web Speech API / HTTP Whisper
- **语音通话**：状态机驱动的半自动对话，含字幕和悬浮球

### 插件系统

- **Worker 隔离**：每个插件运行在独立 Worker 中，崩溃不影响主应用
- **钩子系统**：核心模块方法自动支持 before / after / error 钩子
- **UI 槽位**：通过 `data-plugin-slot` 标注锚点，无需侵入式 DOM 操作
- **权限声明**：Manifest 显式声明所需权限，方法级校验
- **独立存储**：每个插件拥有独立的 KV 存储与配置命名空间
- 完整的 UI 工具集：对话框、热键、右键菜单、提示、拖拽等

### 其他

- **朋友圈**：角色和用户可发布动态，AI 自动互动
- **主题系统**：3 套内置主题（亮色 / 暗色 / 赛博朋克）+ 自定义主题制作器
- **命令行**：20+ 命令覆盖环境查看、时间控制、记忆管理、角色切换
- **主动对话**：角色长时间未互动且清醒时自动联系
- **开发者监控**：实时观测引擎事件与 API 请求
- **Token 预算管理**：四类分配 + 三种剪裁策略
- **个性化引擎**：bodyProfile + emotionProfile，含 10 种特殊类型

### 已知限制

- 不支持多模态消息（图片 / 视频）
- 不支持 Live2D 形象
- 不支持分支剧情树
- 插件不支持裸模块导入（设计边界）
- 依赖 CDN 加载 marked / DOMPurify / MiniSearch，离线环境首屏会受影响

---

## 后续规划

未来版本计划：

- 多模态消息支持（图片 / 音频）
- 插件市场
- 分支剧情系统
- 将 CDN 依赖本地化，实现完全离线可用

详细路线图见 [README.md](README.md)。