# 角色状态雷达图插件

在聊天头部注入雷达图按钮，点击后弹出模态框，实时可视化角色的情感六维和身体状态。

## 特性

- 📊 **双雷达图**：情感六维 + 身体状态
- 🔄 **实时刷新**：订阅 `emotion:updated`、`emotion:interaction`、`body:updated`、`body:wakeup` 四个事件
- 🎨 **主题自适应**：颜色随主题变量自动调整
- 📱 **移动端友好**：DPR 适配，Canvas 高清显示
- 📝 **详细信息**：文字面板显示所有数值
- ⚠️ **数据缺失提示**：状态未初始化时给出明确警告
- 💬 **群聊支持**：群聊下从成员列表中选择角色查看（不再沿用单聊角色）

## 群聊说明

- **单聊**：直接展示「当前角色」状态。
- **群聊**：进入群聊后全局当前角色会被清空，插件改为从**群成员**中读取角色列表。
  若群内有多个角色，模态框顶部会出现角色切换下拉；选择一个角色即可查看其状态并实时刷新。
- 群聊模式依赖 `storage:indexeddb` 权限读取群成员与角色数据。

## 权限

| 权限 | 用途 |
|---|---|
| `ui:inject` | 注入头部按钮 |
| `character:read` | 读取角色状态 |
| `event:subscribe` | 订阅情感/身体更新事件 |
| `storage:indexeddb` | 群聊下读取群成员与角色数据 |

## 可视化内容

### 情感六维（-100 ~ 100）

雷达图中心代表中性（0），最外圈代表 +100 或 -100。

- 愉悦（valence）
- 唤醒（arousal）
- 支配（dominance）
- 关注（attention）
- 意外（surprise）
- 精力（energy）

### 身体状态（0 ~ 100，部分为关系维度）

- 精力（energy） — 身体状态
- 睡意（sleepiness） — 身体状态
- 健康（health） — 身体状态
- 好感（affection） — 关系维度，范围 -100 ~ 100
- 信任（trust） — 关系维度，范围 0 ~ 100
- 亲密（intimacy） — 关系维度，范围 0 ~ 100

## 安装

### 方式一：从文件安装（推荐）

1. 打包插件：
   ```bash
   cd plugins/example-emotion-radar
   zip -r ../example-emotion-radar.zip manifest.json worker.js ui.js