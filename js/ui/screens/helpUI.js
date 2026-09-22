// js/ui/screens/helpUI.js - Utopia 使用指南（v3.7）
import { openModal } from '../components/modal.js';

export function renderHelpModal() {
  const content = `
    <div class="help-content">
      <style>
        .help-content { color: var(--color-text-primary); line-height: 1.6; }
        .help-content h1 {
          font-size: 1.8rem; margin-top: 0; margin-bottom: 0.5rem;
          background: var(--color-primary-gradient);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .help-content section { margin-bottom: 2rem; }
        .help-content h2 {
          font-size: 1.3rem; border-bottom: 2px solid var(--color-border);
          padding-bottom: 0.3rem; margin-top: 1.5rem; color: var(--color-text-primary);
        }
        .help-content h3 { font-size: 1.1rem; margin-top: 1rem; font-weight: 600; color: var(--color-text-secondary); }
        .help-content h4 { font-size: 1rem; margin-top: 0.8rem; font-weight: 600; color: var(--color-text-secondary); }
        .help-content ul, .help-content ol { padding-left: 1.5rem; margin: 0.5rem 0; }
        .help-content li { margin-bottom: 0.2rem; }
        .help-content dl { display: grid; grid-template-columns: 1fr 3fr; gap: 0.5rem 1rem; margin: 0.5rem 0; }
        .help-content dt { font-weight: 600; color: var(--color-text-secondary); }
        .help-content dd { margin: 0; }
        .help-content .note { font-size: 0.85rem; color: var(--color-text-muted); }
        .help-content .flowchart {
          text-align: center; margin: 1rem 0; background: var(--color-bg-secondary);
          border-radius: var(--radius-lg); padding: 1rem; border: 1px solid var(--color-border);
        }
        .help-content .flowchart svg { max-width: 100%; height: auto; }
        .help-content .tag {
          display: inline-block; background: var(--color-accent-light); color: var(--color-accent);
          padding: 0.1rem 0.5rem; border-radius: var(--radius-full); font-size: 0.75rem; font-weight: 600;
        }
        .help-content .future-badge {
          display: inline-block; background: var(--color-secondary-light); color: var(--color-secondary-dark);
          font-size: 0.65rem; padding: 0.05rem 0.5rem; border-radius: var(--radius-full);
          margin-left: 0.3rem; font-weight: 600;
        }
        .help-content .new-badge {
          display: inline-block; background: #ffeaa7; color: #b8860b;
          font-size: 0.65rem; padding: 0.05rem 0.5rem; border-radius: var(--radius-full);
          margin-left: 0.3rem; font-weight: 600;
        }
        .help-content .fix-badge {
          display: inline-block; background: #dfe6e9; color: #2d3436;
          font-size: 0.65rem; padding: 0.05rem 0.5rem; border-radius: var(--radius-full);
          margin-left: 0.3rem; font-weight: 600;
        }
        .help-content pre {
          background: var(--color-bg-secondary); padding: 0.8rem; border-radius: 8px;
          overflow-x: auto; font-size: 0.85rem; line-height: 1.5;
          border: 1px solid var(--color-border-light); margin: 0.5rem 0;
        }
        .help-content pre code {
          background: transparent; padding: 0;
          font-family: 'Consolas', 'Monaco', monospace; color: var(--color-text-primary);
        }
        .help-content .table-scroll-wrapper {
          overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0.5rem 0;
          border-radius: var(--radius-sm); border: 1px solid var(--color-border-light);
        }
        .help-content .table-scroll-wrapper table {
          width: 100%; min-width: 600px; border-collapse: collapse; font-size: 0.9rem;
        }
        .help-content .table-scroll-wrapper th {
          background: var(--color-bg-secondary); font-weight: 600; text-align: left;
          padding: 0.4rem 0.6rem; border-bottom: 2px solid var(--color-border); white-space: nowrap;
        }
        .help-content .table-scroll-wrapper td {
          padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--color-border-light); vertical-align: top;
        }
        .help-content .table-scroll-wrapper .cmd-name { font-weight: 600; color: var(--color-primary); white-space: nowrap; }
        .help-content .table-scroll-wrapper .cmd-alias { font-size: 0.8rem; color: var(--color-text-muted); }
        .help-content .table-scroll-wrapper .cmd-desc { color: var(--color-text-secondary); }
        .help-content .table-scroll-wrapper .group-header {
          background: var(--color-bg-sidebar); font-weight: 600; font-size: 0.85rem;
          color: var(--color-text-primary); letter-spacing: 0.3px;
        }
        @media (max-width: 600px) {
          .help-content dl { grid-template-columns: 1fr; }
          .help-content .table-scroll-wrapper table { font-size: 0.8rem; min-width: 480px; }
          .help-content .table-scroll-wrapper th, .help-content .table-scroll-wrapper td { padding: 0.3rem 0.4rem; }
        }
        @media (max-width: 400px) {
          .help-content .table-scroll-wrapper table { min-width: 360px; font-size: 0.7rem; }
        }
      </style>

      <h1>📖 Utopia 使用指南</h1>
      <p class="note">版本 v3.7 · 文档更新于 2026-09-19</p>

      <section>
        <h2>✨ 概述</h2>
        <p>Utopia 是一款 AI 虚拟伴侣平台，支持多角色、多引擎驱动的沉浸式对话体验。所有数据存储在本地，隐私安全。</p>
        <p><strong>核心特点：</strong></p>
        <ul>
          <li><strong>三大引擎联动</strong>：时间、情感、身体状态相互影响，角色具备"生命力"。</li>
          <li><strong>个性化引擎</strong><span class="new-badge">v3.6</span>：每个角色拥有独立的体质与情绪特质，军人抗病、林黛玉体弱、夜猫子深夜精力旺盛、修仙者不眠不休。</li>
          <li><strong>午休系统</strong><span class="new-badge">v3.7</span>：个性化触发午休小睡，午休倾向可调（从不 / 偶尔 / 经常 / 每次）。</li>
          <li><strong>受伤系统</strong><span class="new-badge">v3.7</span>：语义裁决的受伤判定，不做类型枚举，<code>injuryResistance</code> 影响判定倾向、severity 缩放与恢复速率。</li>
          <li><strong>多层级记忆</strong>：全文检索 + 语义检索 + 对话摘要，确保长期记忆和一致性。</li>
          <li><strong>强大的注入器</strong>：支持规则链、条件组合、定时、概率等复杂逻辑。</li>
          <li><strong>世界书系统 v2.0</strong>：规则组、嵌套条件、宏模板、<strong>语义触发</strong>与向量同步。</li>
          <li><strong>插件系统 v1.0</strong>：Worker 隔离、钩子系统、UI 槽位、权限声明。</li>
          <li><strong>统一右键菜单</strong>：核心菜单与插件菜单自动合并，按优先级排列。</li>
          <li><strong>朋友圈社交</strong>：角色和用户可发布动态，AI 自动互动。</li>
          <li><strong>群聊支持</strong>：多角色同屏对话，@提及、@触发回复、自动发言轮询。</li>
          <li><strong>🔊 语音合成 (TTS)</strong>：Web Speech API / Kokoro，每角色可独立配置音色。</li>
          <li><strong>🎤 语音输入 (STT)</strong>：长按麦克风或按住 Ctrl/Alt 说话。</li>
          <li><strong>📞 主动语音通话</strong>：状态机驱动的交替对话，字幕显示。通话结束具备补偿机制。</li>
          <li><strong>💬 主动对话引擎</strong>：角色长时间未互动且清醒时自动联系。</li>
          <li><strong>⌨️ 完整命令行系统</strong>：涵盖环境查看、时间控制、采样参数、记忆管理、角色切换等 20+ 命令。</li>
          <li><strong>🛠️ 开发者监控</strong>：实时观测引擎事件与 API 请求。</li>
        </ul>
      </section>

      <section>
        <h2>⚙️ 设置项说明</h2>

        <h3>👤 用户信息</h3>
        <ul>
          <li><strong>用户名</strong>：用于对话中标识用户。</li>
          <li><strong>头像</strong>：上传图片，显示在聊天界面。</li>
        </ul>

        <h3>🔌 API 配置</h3>
        <ul>
          <li><strong>厂商</strong>：OpenAI、Anthropic、Google Gemini、Cohere、DeepSeek、Mistral、Groq、Perplexity、xAI。</li>
          <li><strong>API Key</strong>：从对应平台获取的密钥。</li>
          <li><strong>API Base URL</strong>：可选，留空自动使用厂商默认地址。填入本地推理引擎（Ollama / LM Studio / vLLM 等）的 OpenAI 兼容端点即可接入本地模型。</li>
          <li><strong>模型名称</strong>：指定使用的模型。点击"获取模型列表"可快速获取。</li>
        </ul>

        <h3>🎛️ 模型参数</h3>
        <ul>
          <li><strong>温度 (0-2)</strong>：控制随机性。可通过 <code>/temp</code> 覆盖。</li>
          <li><strong>最大输出 Token</strong>：回复最大长度。可通过 <code>/max</code> 覆盖。</li>
          <li><strong>高阶采样参数</strong>：频率惩罚、存在惩罚、Top-K、重复惩罚。</li>
        </ul>

        <h3>⏰ 时间系统</h3>
        <ul>
          <li><strong>时间流速</strong>：游戏时间与现实时间的比例（1x ~ 48x）。可通过 <code>/time speed &lt;n&gt;</code> 覆盖。</li>
          <li><strong>时间暂停</strong>：停止游戏时间流动。可通过 <code>/time pause</code> 控制。</li>
        </ul>
        <p class="note">💡 时间流速不仅影响游戏内时钟，也影响冷落感知、跨天感知、主动对话的触发节奏——8x 流速下 1 小时真实时间 = 8 小时游戏时间。</p>

        <h3>🧠 三大引擎控制</h3>
        <ul>
          <li><strong>情感引擎</strong>：六维情绪模型 + 五类需求 + 三类关系。</li>
          <li><strong>身体状态引擎</strong>：精力、睡意、健康、意识、睡眠周期、疾病、受伤。</li>
          <li><strong>时间系统</strong>：游戏时间流逝和离线计算。</li>
          <li class="note">⚠️ 三个引擎可以独立开关。全部开启时形成闭环。关闭引擎可能导致角色互动失去真实感。</li>
        </ul>

        <h3>情感引擎高级选项</h3>
        <ul>
          <li><strong>启用 LLM 辅助情感分类</strong>：词库匹配不明确时调用 AI 分析意图。</li>
        </ul>

        <h3>🧠 长期记忆</h3>
        <ul>
          <li><strong>检索模式</strong>：关键词 / 语义 / 混合检索。</li>
          <li><strong>语义模型</strong>：
            <ul>
              <li><code>Xenova/all-MiniLM-L6-v2</code>（英文，~80MB）</li>
              <li><code>Xenova/paraphrase-multilingual-MiniLM-L12-v2</code>（多语言，~235MB，中文推荐）</li>
            </ul>
          </li>
          <li><strong>精度（dtype）</strong>：fp32 / fp16 / q8 / int8 / uint8 / q4 / q4f16 / bnb4。q8 体积最小速度最快，fp32 精度最高。
            <span class="fix-badge">v3.5 修复</span> dtype 列表探测结果会缓存 1 小时，避免反复触发本地文件检查。
          </li>
          <li><strong>自动下载模型</strong>：启动时自动下载缺失的模型。</li>
          <li><strong>记忆检索阈值</strong>：
            <ul>
              <li>控制<strong>长期记忆召回</strong>的相似度门槛，独立于世界书语义阈值</li>
              <li>0.4 = 宽松（召回多）</li>
              <li>0.55 = 平衡（推荐）</li>
              <li>0.7 = 严格（精准）</li>
              <li>调低 → AI 更容易"想起"之前聊过的内容；调高 → 只召回高度相关的记忆</li>
            </ul>
          </li>
        </ul>

        <h3>📖 世界书语义触发</h3>
        <p style="font-size:0.85rem;color:var(--color-text-muted);">允许世界书规则使用「语义触发」——根据用户消息的语义相似度匹配，而不只是关键词。</p>
        <ul>
          <li><strong>启用语义触发</strong>：总开关，关闭后所有 semantic 类型规则不会触发。</li>
          <li><strong>全局相似度阈值</strong>（0-1）：
            <ul>
              <li>0.4 = 宽松（召回多）</li>
              <li>0.55 = 平衡（推荐）</li>
              <li>0.7 = 严格（召回少但精准）</li>
            </ul>
          </li>
          <li><strong>单次最多命中</strong>：每轮对话最多触发多少条语义规则（默认 5）。</li>
          <li><strong>启动时自动同步向量</strong>：应用启动时为所有语义规则生成/更新向量。</li>
          <li><strong>立即同步向量</strong>：手动触发一次同步。</li>
        </ul>
        <div style="background: rgba(253, 203, 110, 0.15); border-left: 3px solid var(--color-warning); padding: 0.5rem 0.8rem; border-radius: 4px; font-size: 0.85rem; margin-top: 0.5rem;">
          <strong>⚖️ 与记忆检索阈值的区别：</strong>
          <br>「世界书语义阈值」控制<b>规则是否触发</b>；「记忆检索阈值」控制<b>记忆是否被召回</b>。两者独立配置，互不影响。详见常见问题。
        </div>

        <h3>📝 对话摘要</h3>
        <ul>
          <li><strong>启用摘要</strong>：开启后自动总结对话。</li>
          <li><strong>摘要频率</strong>：每 N 条消息生成一次摘要（默认 10）。</li>
          <li><strong>摘要最大长度</strong>：控制摘要详细程度（默认 200）。</li>
          <li class="note">💡 摘要始终在后台生成，但仅在"智能混合"模式下注入上下文。</li>
        </ul>

        <h3>📊 上下文模式</h3>
        <ul>
          <li><strong>智能混合</strong>（默认）：最近 20 条消息 + 摘要 + 记忆检索。</li>
          <li><strong>全量上下文</strong>：发送全部历史消息，适合大上下文模型。</li>
          <li><strong>仅摘要</strong>：仅发送摘要，极简模式。</li>
        </ul>

        <h3>🔊 TTS 语音合成</h3>
        <ul>
          <li><strong>提供商</strong>：Web Speech API (Edge TTS) / Kokoro / 自定义 OpenAI 兼容 API。</li>
          <li><strong>Kokoro API URL</strong>：默认 <code>http://localhost:8880/v1/audio/speech</code>。</li>
          <li><strong>默认音色</strong>：全局默认，角色可单独覆盖。支持按语言分组、性别推断。</li>
          <li><strong>默认语速</strong>（0.1-10）/ <strong>默认音调</strong>（0-2）。</li>
          <li><strong>通话中自动语音</strong>：语音通话中自动朗读角色消息。</li>
        </ul>

        <h3>🎤 STT 语音识别</h3>
        <ul>
          <li><strong>提供商</strong>：
            <ul>
              <li><strong>Web Speech API</strong>（浏览器内置，仅 Chromium，流式）</li>
              <li><strong>HTTP Whisper</strong>（远程 API，全平台，一次性上传）</li>
            </ul>
          </li>
          <li><strong>识别语言</strong>：zh-CN / zh-TW / en-US / ja-JP / ko-KR。</li>
          <li><strong>Whisper API URL</strong>：支持 OpenAI Whisper API 兼容接口。</li>
        </ul>
        <p>使用方式：点击麦克风按钮并按住说话；松开自动填入识别文本。PC 端可按住 Ctrl 或 Alt 键说话（长按 200ms 触发）。</p>

        <h3>💬 主动对话</h3>
        <ul>
          <li><strong>启用主动对话</strong>：总开关。</li>
          <li><strong>空闲阈值</strong>：角色至少多久未互动才主动联系（游戏小时，默认 6）。</li>
          <li><strong>单次最多触发数</strong>：每轮扫描最多触发几个角色（默认 2）。</li>
          <li><strong>角色冷却</strong>：同一角色再次触发的冷却时间（游戏小时，默认 24）。</li>
          <li><strong>语音触发概率</strong>：触发语音通话的概率（默认 30%）。</li>
          <li><strong>立即检测</strong>：手动触发一次主动对话扫描。</li>
          <li class="note">💡 同一轮扫描中最多只有一个角色触发语音通话。触发需要同时满足"游戏时间阈值"和"真实时间阈值"。</li>
        </ul>

        <h3>🧬 个性化引擎（角色体质与情绪特征）<span class="new-badge">v3.6</span></h3>
        <p style="font-size:0.85rem;color:var(--color-text-muted);">
          每个角色除性格外，还可拥有独立的<strong>体质</strong>和<strong>情绪特征</strong>，
          让不同人设的生理与情感行为差异化。例如军人抗病、林黛玉体弱、
          夜猫子深夜精力旺盛、修仙者不眠不休。
        </p>

        <h4>📐 影响范围</h4>
        <ul>
          <li><strong>身体状态</strong>：精力消耗/恢复速率、睡意积攒速率、昼夜节律、每日睡眠需求、午休习惯与倾向、生病概率、受伤判定与恢复速率、唤醒难度</li>
          <li><strong>情绪反应</strong>：事件影响的敏感度、情绪波动幅度、情绪平复速度、依恋建立速度、信任恢复倍率</li>
        </ul>

        <h4>🎛️ 配置位置</h4>
        <p style="font-size:0.85rem;">
          角色编辑表单 → "⚙️ 进阶设定（可选，不填则自动推断）"。
          打开后包含：
        </p>
        <ul>
          <li><strong>快捷模板</strong>：标准型 / 健壮型 / 体弱型 / 夜猫子 / 早起鸟 / 午休党 / 修仙者 / 赛博格</li>
          <li><strong>生理节律</strong>：作息类型、每日睡眠需求、是否午休、午休倾向</li>
          <li><strong>体质</strong>：体质强弱、疾病抵抗、受伤抵抗、恢复速度、精力消耗、唤醒容易度</li>
          <li><strong>情绪特质</strong>：情绪敏感度、情绪波动性、情绪恢复速度、依恋建立速度、信任恢复倍率</li>
          <li><strong>特殊类型</strong>：10 种预设（不死之身 / 天使 / 人造生命 / 赛博格 / 亡灵 / 灵体 / 吸血鬼 / 恶魔 / 兽族 / 植物）</li>
        </ul>

        <h4>🩹 受伤抵抗（injuryResistance）<span class="new-badge">v3.7</span></h4>
        <p style="font-size:0.85rem;color:var(--color-text-muted);">
          控制角色对受伤的抵抗能力，在<b>三个环节</b>共同生效：
        </p>
        <ol style="font-size:0.85rem;">
          <li><strong>判定倾向</strong>：作为描述写入 LLM prompt，高抵抗角色更难被判定受伤</li>
          <li><strong>严重度缩放</strong>：<code>severity × (1 - r × 0.5)</code>，r=0.5 → ×0.75，r=1.0 → ×0.50</li>
          <li><strong>恢复速率</strong>：恢复系数 <code>(0.5 + r)</code>，r=1.0 → 恢复快 1.5 倍</li>
        </ol>
        <p class="note">💡 与"疾病抵抗"的设计区别：疾病是内生（健康低时按概率触发），受伤是外源（需要语义上有明确致伤事件）。</p>

        <h4>😴 午休倾向（napTendency）<span class="new-badge">v3.7</span></h4>
        <p style="font-size:0.85rem;color:var(--color-text-muted);">
          控制角色在午休窗口（12:00 - 14:00）触发午休小睡的概率：
        </p>
        <ul style="font-size:0.85rem;">
          <li><strong>触发条件</strong>：勾选"习惯午休" + 处于午休窗口 + 睡意 ≥ 55 + 精力 < 75 + 每日仅判定一次</li>
          <li><strong>触发概率</strong>：<code>Math.random() &lt; napTendency</code></li>
          <li><strong>午休时长</strong>：<code>0.3 + napTendency × 0.7</code> 小时（0.3 → 约 18 分钟，0.8 → 约 55 分钟）</li>
          <li><strong>醒来补偿</strong>：睡意 -40，精力 +20，睡眠质量微增</li>
        </ul>
        <p class="note">💡 午休窗口之外的睡眠不受影响，与夜间睡眠独立。用户可用 <code>/wake</code> 主动打断午休。</p>

        <h4>⚙️ 自动推断机制</h4>
        <ul>
          <li>未配置时，系统会根据 6 维性格参数<strong>自动推导</strong>合理默认值</li>
          <li>创建/导入角色时，若已配置 API，会通过 LLM 一次性量化出性格 + 体质 + 情绪三组参数</li>
          <li>LLM 会识别描述中的关键词（如"军人"→健壮、"体弱"→虚弱、"夜猫子"→evening、"午休"→午休党），自动匹配</li>
        </ul>

        <h4>🌟 特殊类型</h4>
        <p style="font-size:0.85rem;color:var(--color-text-muted);">
          特殊类型会在运行时<strong>临时覆盖</strong>部分参数（如不死之身强制无睡意、不生病），
          但不会改变你在滑块上设置的原始值。取消特殊类型后，原始值继续生效。
        </p>
        <div style="background: rgba(253, 203, 110, 0.15); border-left: 3px solid var(--color-warning); padding: 0.5rem 0.8rem; border-radius: 4px; font-size: 0.85rem; margin-top: 0.5rem;">
          <strong>⚠️ 注意事项：</strong>
          <br>特殊类型的字段覆盖只影响运行时行为。
          <br>若你希望某个字段始终按特定值生效，请直接调整对应滑块，并<strong>不要</strong>选择会覆盖它的特殊类型。
        </div>

        <h4>⌨️ 命令</h4>
        <div class="table-scroll-wrapper">
          <table>
            <thead>
              <tr><th>命令</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr><td><code>/profile</code></td><td>查看当前角色的体质与情绪特征</td></tr>
              <tr><td><code>/profile special</code></td><td>列出所有可用特殊类型</td></tr>
              <tr><td><code>/profile special &lt;type&gt;</code></td><td>设置特殊类型（如 <code>/profile special vampire</code>）</td></tr>
              <tr><td><code>/profile set &lt;key&gt; &lt;value&gt;</code></td><td>设置单个字段（如 <code>/profile set constitution 0.8</code>）</td></tr>
              <tr><td><code>/profile reset</code></td><td>重置为基于性格的自动推导值</td></tr>
            </tbody>
          </table>
        </div>

        <h4>🔌 插件 API</h4>
        <p style="font-size:0.85rem;color:var(--color-text-muted);">
          插件可通过 <code>api.profileDefaults.*</code> 读取/推导角色的配置，
          通过 <code>api.character.updateCharacter()</code> 修改。
          需要使用 <code>character:read</code> 和 <code>character:write</code> 权限。
        </p>
      </section>

      <section>
        <h2>⌨️ 输入框命令系统</h2>
        <p>以 <code>/</code> 开头的特殊命令。命令不会进入对话历史，执行结果通过 <strong>"Utopia 控制台"</strong> 气泡展示。</p>

        <h3>📋 基础命令</h3>
        <div class="table-scroll-wrapper">
          <table>
            <thead>
              <tr><th>命令</th><th>别名</th><th>说明</th><th>示例</th></tr>
            </thead>
            <tbody>
              <tr><td><span class="cmd-name">/help</span></td><td>—</td><td class="cmd-desc">显示所有可用命令</td><td><code>/help</code></td></tr>
              <tr><td><span class="cmd-name">/inject</span></td><td><span class="cmd-alias">/i</span></td><td class="cmd-desc">一次性注入提示词到下一轮对话（发送后自动清除）</td><td><code>/inject 你现在心情很好</code></td></tr>
              <tr><td><span class="cmd-name">/print</span></td><td>—</td><td class="cmd-desc">打印当前环境信息</td><td><code>/print</code></td></tr>
              <tr><td><span class="cmd-name">/model</span></td><td><span class="cmd-alias">/m</span></td><td class="cmd-desc">显示当前厂商、模型和 Base URL</td><td><code>/model</code></td></tr>
              <tr><td><span class="cmd-name">/clear</span></td><td>—</td><td class="cmd-desc">清空聊天容器（不删除历史）</td><td><code>/clear</code></td></tr>
              <tr><td><span class="cmd-name">/reset</span></td><td>—</td><td class="cmd-desc">重置注入器状态（含待注入清除）</td><td><code>/reset</code></td></tr>
              <tr><td><span class="cmd-name">/time</span></td><td>—</td><td class="cmd-desc">时间控制（查看/流速/暂停/设置/推进/重置）</td><td><code>/time speed 8</code></td></tr>
              <tr><td><span class="cmd-name">/wake</span></td><td>—</td><td class="cmd-desc">尝试唤醒睡眠中的角色（<code>force</code> 强制唤醒）</td><td><code>/wake force</code></td></tr>
              <tr><td><span class="cmd-name">/undo</span></td><td>—</td><td class="cmd-desc">撤回上一轮对话（用户消息 + 角色回复）</td><td><code>/undo</code></td></tr>
              <tr><td><span class="cmd-name">/regen</span></td><td><span class="cmd-alias">/regenerate</span></td><td class="cmd-desc">重新生成上一条角色回复</td><td><code>/regen</code></td></tr>
              <tr><td><span class="cmd-name">/switch</span></td><td><span class="cmd-alias">/sw</span></td><td class="cmd-desc">切换到指定角色（支持模糊匹配）</td><td><code>/switch 猫猫</code></td></tr>
              <tr><td><span class="cmd-name">/inspect</span></td><td><span class="cmd-alias">/ins</span></td><td class="cmd-desc">查看当前生效的注入规则（含语义轨迹、Token 预算、会话状态）</td><td><code>/inspect</code></td></tr>
              <tr><td><span class="cmd-name">/worldbook</span></td><td><span class="cmd-alias">/wb</span></td><td class="cmd-desc">世界书工具（<code>test</code> 子命令测试语义匹配）</td><td><code>/worldbook test 我今天有点难过</code></td></tr>
              <tr><td><span class="cmd-name">/status</span></td><td><span class="cmd-alias">/s</span></td><td class="cmd-desc">查看当前角色/群组状态</td><td><code>/status</code> 或 <code>/status @猫猫</code></td></tr>
              <tr><td><span class="cmd-name">/memory</span></td><td><span class="cmd-alias">/mem</span></td><td class="cmd-desc">记忆管理：list / search / clear</td><td><code>/memory list</code></td></tr>
              <tr><td><span class="cmd-name">/stats</span></td><td>—</td><td class="cmd-desc">系统统计信息</td><td><code>/stats</code></td></tr>
              <tr><td><span class="cmd-name">/whoami</span></td><td>—</td><td class="cmd-desc">显示当前身份和模式</td><td><code>/whoami</code></td></tr>
              <tr><td><span class="cmd-name">/call</span></td><td>—</td><td class="cmd-desc">发起语音通话（仅单聊）</td><td><code>/call</code></td></tr>
              <tr><td><span class="cmd-name">/social</span></td><td><span class="cmd-alias">/soc</span></td><td class="cmd-desc">朋友圈管理（list/detail/clear/generate/comment/reply/delete）</td><td><code>/social list</code></td></tr>
              <tr><td><span class="cmd-name">/profile</span></td><td><span class="cmd-alias">/pf</span></td><td class="cmd-desc">查看/设置当前角色的体质与情绪特征</td><td><code>/profile</code> 或 <code>/profile special vampire</code></td></tr>
            </tbody>
          </table>
        </div>

        <h3>🎛️ 参数控制命令（临时覆盖）</h3>
        <div class="table-scroll-wrapper">
          <table>
            <thead>
              <tr><th>命令</th><th>别名</th><th>范围</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr><td><span class="cmd-name">/temp</span></td><td><span class="cmd-alias">/t</span></td><td>0 ~ 2</td><td class="cmd-desc">设置温度</td></tr>
              <tr><td><span class="cmd-name">/max</span></td><td>—</td><td>1 ~ 32768</td><td class="cmd-desc">设置最大输出 Token</td></tr>
              <tr><td><span class="cmd-name">/fp</span></td><td>—</td><td>-2 ~ 2</td><td class="cmd-desc">设置频率惩罚</td></tr>
              <tr><td><span class="cmd-name">/pp</span></td><td>—</td><td>-2 ~ 2</td><td class="cmd-desc">设置存在惩罚</td></tr>
              <tr><td><span class="cmd-name">/topk</span></td><td>—</td><td>0 ~ 200</td><td class="cmd-desc">设置 Top-K 采样</td></tr>
              <tr><td><span class="cmd-name">/rp</span></td><td>—</td><td>1.0 ~ 2.0</td><td class="cmd-desc">设置重复惩罚</td></tr>
              <tr><td><span class="cmd-name">/reset_params</span></td><td>—</td><td>—</td><td class="cmd-desc">将所有临时参数重置为默认值</td></tr>
            </tbody>
          </table>
        </div>

        <h3>💡 命令详解</h3>
        <dl>
          <dt><code>/inject &lt;内容&gt;</code></dt>
          <dd>
            将指定内容作为系统提示词注入到<strong>下一轮</strong>对话中。
            <br>
            <strong>消费规则：</strong>
            <ul style="margin-top:0.3rem;padding-left:1.2rem;">
              <li>执行 <code>/inject X</code> 后，X 保存在内存中</li>
              <li>你发送的下一条消息会带上 X</li>
              <li>无论 AI 回复成功或失败，X 都被视为"已消费"并自动清除</li>
              <li>若在发送消息前再次执行 <code>/inject Y</code>，Y 会覆盖 X</li>
              <li>若在发送消息前执行 <code>/reset</code>，X 会被清除</li>
            </ul>
            <span class="note">⚠️ 如果需要某条提示词持续生效，请使用世界书规则而非 /inject。</span>
          </dd>

          <dt><code>/print</code></dt>
          <dd>单聊输出角色状态；群聊输出群组信息。</dd>

          <dt><code>/time</code></dt>
          <dd>
            时间控制命令。支持以下子命令：
            <ul style="margin-top:0.3rem;padding-left:1.2rem;">
              <li><code>/time</code> — 查看当前游戏时间和流速</li>
              <li><code>/time speed &lt;1-48&gt;</code> — 设置时间流速</li>
              <li><code>/time pause</code> / <code>/time resume</code> — 暂停 / 恢复时间流动</li>
              <li><code>/time set HH:MM</code> — 调整到指定时刻（如 <code>/time set 22:30</code>）。若目标时刻早于当前时间，则视为"明天的 HH:MM"</li>
              <li><code>/time advance &lt;小时&gt;</code> — 推进 N 小时（调试用，如 <code>/time advance 8</code>）</li>
              <li><code>/time reset</code> — 重置游戏时间为现实时间，并清除所有角色的冷落状态</li>
            </ul>
          </dd>

          <dt><code>/wake</code> / <code>/wake force</code></dt>
          <dd>
            尝试唤醒处于<strong>深睡</strong>或<strong>浅睡</strong>状态的角色。
            <ul style="margin-top:0.3rem;padding-left:1.2rem;">
              <li><code>/wake</code> — 按概率尝试（深睡基础成功率约 12%，随尝试次数递增）</li>
              <li><code>/wake force</code> — <strong>忽略概率强制唤醒</strong>，直接设置角色为"浅睡（迷糊）"状态</li>
              <li>若角色正在午休，主动唤醒会打断午休</li>
            </ul>
            <span class="note">💡 使用场景：连续发送多条消息都无法唤醒角色时，使用 <code>/wake force</code> 跳过概率判定。</span>
          </dd>

          <dt><code>/undo</code></dt>
          <dd>
            撤回上一轮对话。删除<strong>最后一条用户消息 + 对应的角色回复</strong>，同时清理相关的长期记忆条目。
            <br>
            <span class="note">⚠️ 生成中无法执行此命令。</span>
          </dd>

          <dt><code>/regen</code> / <code>/regenerate</code></dt>
          <dd>
            重新生成上一条角色回复。删除当前回复并基于同一用户消息重新生成，同时清理旧回复对应的记忆。
            <br>
            <span class="note">⚠️ 生成中无法执行此命令。</span>
          </dd>

          <dt><code>/switch &lt;角色名&gt;</code> / <code>/sw</code></dt>
          <dd>
            切换到指定角色。
            <ul style="margin-top:0.3rem;padding-left:1.2rem;">
              <li>匹配策略：精确匹配 → 前缀匹配 → 包含匹配（三级 fallback）</li>
              <li>多候选时会列出所有匹配项，需要更精确的名称</li>
              <li>若已在目标角色的会话中，不做切换</li>
            </ul>
            示例：<code>/switch 猫</code> 会匹配到"猫猫"、"猫咪"等角色；若只有"猫猫"，直接切换。
          </dd>

          <dt><code>/inspect</code> / <code>/ins</code></dt>
          <dd>输出当前生效的所有注入规则、Token 预算明细、会话状态机调试信息。如果上一轮触发了语义规则，会显示每个语义规则的<strong>相似度分数</strong>、<strong>进度条</strong>和<strong>阈值</strong>对比。</dd>

          <dt><code>/worldbook test &lt;文本&gt;</code> / <code>/wb test</code></dt>
          <dd>
            测试语义规则对指定文本的匹配情况。
            <ul style="margin-top:0.3rem;padding-left:1.2rem;">
              <li>列出所有启用的语义规则、匹配分数、进度条、阈值对比</li>
              <li>用法：<code>/worldbook test 我今天有点难过</code></li>
              <li>若语义引擎未就绪，会提示需要下载模型、同步向量等前置步骤</li>
            </ul>
          </dd>

          <dt><code>/status</code> / <code>/s</code></dt>
          <dd>单聊输出角色详情；群聊支持 <code>/status @成员名</code>。输出内容包括情感六维、需求、关系、身体状态（含受伤详情与叙述）、疾病/受伤、记忆条目数等。</dd>

          <dt><code>/memory</code> / <code>/mem</code></dt>
          <dd>记忆管理：<code>list</code>（列最近 10 条）/ <code>search &lt;关键词&gt;</code>（返回 Top 5）/ <code>clear</code>（需 <code>confirm_clear</code> 二次确认）。</dd>

          <dt><code>/stats</code></dt>
          <dd>系统级统计：角色数、会话数、消息总数、记忆条目数、世界书规则数、群组数、朋友圈动态数、引擎开关状态、游戏时间。</dd>

          <dt><code>/whoami</code></dt>
          <dd>显示当前上下文（角色/群组/模式）。</dd>

          <dt><code>/call</code></dt>
          <dd>发起与当前角色的语音通话（仅单聊）。<span class="note">⚠️ 角色处于深睡/浅睡/昏厥时无法通话。</span></dd>

          <dt><code>/social</code> / <code>/soc</code></dt>
          <dd>朋友圈管理命令，子命令见上表。</dd>

          <dt><code>/profile</code> / <code>/pf</code></dt>
          <dd>
            查看或设置当前角色的体质与情绪特征。
            <ul style="margin-top:0.3rem;padding-left:1.2rem;">
              <li><code>/profile</code> — 输出完整的 bodyProfile / emotionProfile</li>
              <li><code>/profile special</code> — 列出所有可用特殊类型</li>
              <li><code>/profile special &lt;type&gt;</code> — 设置特殊类型（如 <code>/profile special vampire</code>）。<code>none</code> 表示取消特殊类型</li>
              <li><code>/profile set &lt;key&gt; &lt;value&gt;</code> — 设置单个字段（如 <code>/profile set injuryResistance 0.8</code>）</li>
              <li><code>/profile reset</code> — 重置为基于性格的自动推导值</li>
            </ul>
            <span class="note">💡 特殊类型的 overrides 在运行时生效，不会覆盖此处保存的原始值。</span>
          </dd>
        </dl>

        <h3>📨 输出方式：Utopia 控制台</h3>
        <ul>
          <li>灰色背景气泡，左侧带图标（ℹ️✅❌⚠️）。</li>
          <li><strong>不会存入数据库</strong>，刷新页面后自动消失。</li>
          <li>顶部旁白提示框显示简短确认信息。</li>
        </ul>
      </section>

      <section>
        <h2>👥 群聊</h2>
        <p>Utopia 支持多角色同屏对话。核心机制：<strong>@ 提及</strong>、<strong>LLM 裁决发言</strong>、<strong>自主发言轮询</strong>。</p>

        <h3>📢 @ 提及行为</h3>
        <p>在群聊输入框输入 <code>@角色名</code> 即可提及角色。系统会自动补全为下拉列表选择。</p>

        <h4>触发规则</h4>
        <div class="table-scroll-wrapper">
          <table>
            <thead><tr><th>场景</th><th>行为</th></tr></thead>
            <tbody>
              <tr>
                <td>用户 @ <strong>1 个角色</strong></td>
                <td>被 @ 的角色直接回复（不经过 LLM 裁决）</td>
              </tr>
              <tr>
                <td>用户 @ <strong>N 个角色</strong>（N &gt; 1）</td>
                <td>被 @ 的角色<strong>依次回复</strong>，每个角色间隔 800ms</td>
              </tr>
              <tr>
                <td>用户<strong>未 @ 任何人</strong></td>
                <td>由 LLM 裁决器（GroupChatEngine）选择一个最合适的角色回复</td>
              </tr>
              <tr>
                <td>角色 A 回复中 @ 角色 B</td>
                <td>角色 B 会在 800ms 后触发回复（深度 1 层）</td>
              </tr>
              <tr>
                <td>角色 B 又 @ 角色 A</td>
                <td><strong>不触发</strong>——防止无限循环（每轮对话中每个角色最多回复一次）</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="background: rgba(108, 92, 231, 0.08); border-left: 3px solid var(--color-primary); padding: 0.6rem 1rem; border-radius: 4px; font-size: 0.85rem; margin-top: 0.5rem;">
          <strong>🛡️ 三重防循环保险：</strong>
          <ul style="margin: 0.3rem 0 0 0; padding-left: 1.2rem;">
            <li><strong>深度限制</strong>：角色 @ 角色只处理 1 层（用户→A→B），B 再 @ 不再触发</li>
            <li><strong>回复去重</strong>：同一轮对话中，每个角色最多被触发回复一次</li>
            <li><strong>自我排除</strong>：角色不会回复自己</li>
          </ul>
        </div>

        <h4>其他群聊特性</h4>
        <ul>
          <li><strong>@ 显示名称</strong>：消息中的 @ 显示角色名而非 ID</li>
          <li><strong>群聊摘要</strong>：每 10 条消息生成一次（可在设置中调整）</li>
          <li><strong>自主发言</strong>：每 5 分钟轮询一次，各角色按概率发言（性格外向/精力高的角色概率更高）</li>
          <li><strong>成员管理</strong>：右键成员消息可禁言/移出（仅群主）</li>
        </ul>
      </section>

      <section>
        <h2>📖 世界书系统</h2>
        <p>世界书是一套<strong>动态规则注入系统</strong>，允许你在对话中根据任意条件自动向 AI 注入额外信息。</p>

        <h3>🎯 核心功能</h3>
        <ul>
          <li><strong>四种规则类型</strong>：条件触发 / 常驻注入 / 语义触发 / 粘性</li>
          <li><strong>嵌套条件</strong>：AND / OR / NOT 任意组合</li>
          <li><strong>丰富的上下文</strong>：用户消息、角色属性、情感数值、身体状态、游戏时间、群组信息</li>
          <li><strong>宏模板注入</strong>：<code>{{character.name}}</code> 等动态变量</li>
          <li><strong>作用域控制</strong>：全局 / 特定角色 / 特定群组</li>
          <li><strong>规则链</strong>：触发后自动激活/停用其他规则</li>
          <li><strong>概率触发</strong>：0~1 的随机性</li>
          <li><strong>互斥组</strong>：同组只触发一条</li>
        </ul>

        <h3>🧠 语义触发</h3>
        <p>用一句自然语言描述触发场景，系统根据用户消息的<strong>语义相似度</strong>自动匹配。</p>
        <ul>
          <li><strong>描述触发场景</strong>：如"用户表达孤独、难过或需要安慰"</li>
          <li><strong>语义阈值</strong>：可单独设定（留空使用世界书全局默认）</li>
          <li><strong>测试匹配</strong>：输入文本查看相似度分数
            <br>也可通过 <code>/worldbook test &lt;文本&gt;</code> 命令在控制台快速测试。
          </li>
          <li><strong>高级约束</strong>：语义命中后可附加额外条件（AND 组合）</li>
        </ul>
        <p class="note">⚠️ 语义触发依赖"设置 → 长期记忆"中配置的语义模型。<strong>世界书语义阈值</strong>与<strong>记忆检索阈值</strong>是两个独立参数。</p>

        <h3>📝 使用示例</h3>
        <dl>
          <dt><strong>场景切入</strong></dt>
          <dd>条件：用户消息包含"走进森林" → 注入"你闻到潮湿的泥土气息"</dd>
          <dt><strong>情绪联动</strong></dt>
          <dd>条件：角色愉悦度 &lt; -30 → 注入"她低着头，声音有些哽咽"</dd>
          <dt><strong>时间感知</strong></dt>
          <dd>条件：游戏时间 ≥ 22:00 → 注入"夜色已深，四周静悄悄的"</dd>
          <dt><strong>语义触发</strong></dt>
          <dd>描述："用户表达孤独或需要陪伴" → 注入安慰性场景描写</dd>
          <dt><strong>剧情分支</strong></dt>
          <dd>条件：用户提及"钥匙" → 激活"密室探索"规则组，停用"日常闲聊"规则组</dd>
        </dl>

        <p>详细教程请点击侧栏"世界书"按钮 → 界面上方"📖 教程"。</p>
      </section>

      <section>
        <h2>🧩 插件系统</h2>
        <p>Utopia 提供完整的插件系统，允许开发者通过独立 Worker 运行扩展，无需修改核心源码。</p>

        <h3>🎯 核心特性</h3>
        <ul>
          <li><strong>Worker 隔离</strong>：每个插件独立运行，崩溃不影响主应用。</li>
          <li><strong>双入口</strong>：<code>worker.js</code>（逻辑）+ <code>ui.js</code>（界面）。</li>
          <li><strong>权限声明</strong>：Manifest 显式声明所需权限。</li>
          <li><strong>钩子系统</strong>：核心模块的方法自动支持 before/after/error 钩子。</li>
          <li><strong>UI 槽位</strong>：通过 <code>data-plugin-slot</code> 标注锚点。</li>
          <li><strong>右键菜单合并</strong>：插件注册的右键菜单会自动与核心菜单合并。</li>
          <li><strong>个性化 API</strong>：<code>api.profileDefaults.*</code> 可读写角色体质与情绪特征。</li>
        </ul>

        <h3>🖱️ 右键菜单</h3>
        <p>插件可通过 <code>uiApi.contextMenu.register(selector, items, opts)</code> 注册右键菜单。核心菜单（编辑/撤回/重新生成等）与插件菜单会<strong>自动合并为单一菜单</strong>，避免冲突。</p>

        <h4>合并规则</h4>
        <div class="table-scroll-wrapper">
          <table>
            <thead><tr><th>选项</th><th>行为</th></tr></thead>
            <tbody>
              <tr><td><code>priority</code>（默认 100）</td><td>数字越小越先合并。核心菜单 priority = 50，插件默认 100（排在核心项之后）。</td></tr>
              <tr><td><code>exclusive: true</code></td><td>该 provider 一旦返回非空 items，其余 provider 不再执行。用于"接管"场景。</td></tr>
              <tr><td><code>claim: true</code></td><td>该 provider 返回非空 items 后，跳过后续优先级更低的 provider。</td></tr>
            </tbody>
          </table>
        </div>

        <p>不同来源的菜单项之间会自动插入分隔线，避免视觉上两组菜单挤在一起。</p>

        <h3>🪝 钩子清单</h3>
        <p>所有通过 <code>pluginApi.js</code> 暴露的核心模块方法，自动支持三类钩子：</p>
        <div class="table-scroll-wrapper">
          <table>
            <thead>
              <tr><th>钩子后缀</th><th>时机</th><th>可做的事</th></tr>
            </thead>
            <tbody>
              <tr><td><code>:before</code></td><td>方法调用前</td><td>修改参数、取消调用</td></tr>
              <tr><td><code>:after</code></td><td>方法调用后</td><td>修改返回值、触发副作用</td></tr>
              <tr><td><code>:error</code></td><td>方法抛错时</td><td>记录错误、降级处理</td></tr>
            </tbody>
          </table>
        </div>

        <h3>🐛 调试</h3>
        <p>打开浏览器控制台，可访问 <code>window.__utopiaPlugins</code>：</p>
        <ul>
          <li><code>__utopiaPlugins.list()</code> — 列出所有已安装插件</li>
          <li><code>__utopiaPlugins.running()</code> — 列出运行中的插件</li>
          <li><code>__utopiaPlugins.hooks()</code> — 查看已注册的钩子</li>
          <li><code>__utopiaPlugins.slots()</code> — 查看槽位注册表</li>
          <li><code>__utopiaPlugins.enable(id)</code> / <code>disable(id)</code> / <code>reload(id)</code></li>
        </ul>
      </section>

      <section>
        <h2>🛠️ 开发者监控</h2>
        <p>内置的引擎监控工具，用于在真实使用中观测引擎执行路径与 API 请求。</p>

        <h3>🔧 启用</h3>
        <p>在浏览器控制台执行一次（跨会话持久化）：</p>
        <pre><code>localStorage.setItem('utopia:dev-monitor', 'on');
location.reload();</code></pre>
        <p>关闭：</p>
        <pre><code>localStorage.removeItem('utopia:dev-monitor');
location.reload();</code></pre>

        <h3>📊 实时监控</h3>
        <p>启用后，控制台会实时打印：</p>
        <ul>
          <li><strong>紫色 <code>⚡ 事件名</code></strong>：引擎事件（情感互动、身体更新、世界书触发、消息生命周期等）</li>
          <li><strong>橙色 <code>📤 API N 条</code></strong>：API 请求与消息列表（可核对各类 prompt 是否注入）</li>
        </ul>

        <h4>关键事件</h4>
        <div class="table-scroll-wrapper">
          <table>
            <thead><tr><th>事件名</th><th>触发时机</th></tr></thead>
            <tbody>
              <tr><td><code>emotion:interaction</code></td><td>情感引擎响应事件（用户消息触发分类）</td></tr>
              <tr><td><code>emotion:updated</code></td><td>情感状态因时间驱动变化</td></tr>
              <tr><td><code>body:updated</code></td><td>身体状态因时间驱动变化</td></tr>
              <tr><td><code>body:wakeup</code></td><td>角色被唤醒</td></tr>
              <tr><td><code>body:injury</code><span class="new-badge">v3.7</span></td><td>受伤引擎判定角色受伤并写入状态</td></tr>
              <tr><td><code>worldbook:rule-triggered</code></td><td>世界书规则触发</td></tr>
              <tr><td><code>message:before-send</code> / <code>message:received</code></td><td>消息发送前后</td></tr>
            </tbody>
          </table>
        </div>

        <h3>📝 API 命令</h3>
        <div class="table-scroll-wrapper">
          <table>
            <thead><tr><th>命令</th><th>功能</th></tr></thead>
            <tbody>
              <tr><td><code>__engineMonitor.report()</code></td><td>显示各事件触发次数统计</td></tr>
              <tr><td><code>__engineMonitor.snapshot()</code></td><td>记录当前角色情感/身体状态快照</td></tr>
              <tr><td><code>__engineMonitor.diff()</code></td><td>与快照对比，显示字段变化</td></tr>
              <tr><td><code>__engineMonitor.clear()</code></td><td>清空事件和 API 日志</td></tr>
              <tr><td><code>__engineMonitor.setVerbose(false)</code></td><td>关闭实时打印（仍记录到日志）</td></tr>
              <tr><td><code>__engineMonitor.stop()</code></td><td>停止监控，恢复原生 fetch</td></tr>
            </tbody>
          </table>
        </div>

        <h3>💡 典型用法</h3>
        <p><strong>验证引擎副作用：</strong></p>
        <pre><code>await __engineMonitor.snapshot();
// 发送一条"你真漂亮"
await __engineMonitor.diff();
// 应看到 valence / affection 上升</code></pre>

        <p><strong>检查 API 注入内容：</strong></p>
        <pre><code>// 发送一条消息后
__engineMonitor.state.apiLog.at(-1).messages</code></pre>
        <p>可以看到最终发送给 AI 的完整消息列表，核对情感 prompt、身体 prompt、跨天 prompt、世界书规则、记忆片段是否按预期注入。</p>

        <h3>🔍 全局调试变量</h3>
        <ul>
          <li><code>window.__lastBudgetStats</code> — 上一轮 Token 预算统计</li>
          <li><code>window.__lastSemanticTrace</code> — 上一轮语义匹配轨迹</li>
          <li><code>window.__utopiaApi</code> — 插件 API 聚合对象</li>
          <li><code>window.__utopiaPlugins</code> — 插件调试 API（见上）</li>
        </ul>
      </section>

      <section>
        <h2>🧩 三大引擎原理</h2>
        <div class="flowchart">
          <svg viewBox="0 0 900 480" style="background:transparent;max-height:480px;">
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6c5ce7" />
              </marker>
              <marker id="arrow-dash" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#a29bfe" />
              </marker>
              <style>
                .eng-text { font-size: 13px; fill: #1a1a2e; font-family: -apple-system, sans-serif; }
                .eng-text-sm { font-size: 11px; fill: #6a6a8a; }
                .eng-box { fill: #f8f9fd; stroke: #6c5ce7; stroke-width: 1.5; rx: 8; }
                .eng-box-accent { fill: #f0f2f8; stroke: #00b894; stroke-width: 1.5; rx: 8; }
                .eng-box-config { fill: #fff8e7; stroke: #fdcb6e; stroke-width: 1.5; rx: 8; }
                .eng-label { text-anchor: middle; dominant-baseline: middle; }
              </style>
            </defs>

            <!-- 第一层：配置层（个性化引擎） -->
            <rect class="eng-box-config" x="20" y="20" width="200" height="80" />
            <text class="eng-text eng-label" x="120" y="45" style="font-weight:600;">🎭 个性化引擎</text>
            <text class="eng-text-sm eng-label" x="120" y="65">bodyProfile / emotionProfile</text>
            <text class="eng-text-sm eng-label" x="120" y="80">SPECIAL_TYPES (10 种)</text>

            <!-- 配置层向下分发的箭头 -->
            <line x1="120" y1="100" x2="120" y2="135" stroke="#a29bfe" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-dash)" />
            <text class="eng-text-sm" x="130" y="120">读取</text>

            <!-- 第二层：三大引擎 -->
            <rect class="eng-box" x="30" y="140" width="140" height="60" />
            <text class="eng-text eng-label" x="100" y="170" style="font-weight:600;">⏰ 时间引擎</text>

            <rect class="eng-box" x="330" y="140" width="140" height="60" />
            <text class="eng-text eng-label" x="400" y="170" style="font-weight:600;">❤️ 情感引擎</text>

            <rect class="eng-box" x="630" y="140" width="240" height="60" />
            <text class="eng-text eng-label" x="750" y="170" style="font-weight:600;">🏃 身体状态引擎</text>

            <!-- 第二层引擎之间的影响 -->
            <line x1="170" y1="170" x2="320" y2="170" stroke="#6c5ce7" stroke-width="2" marker-end="url(#arrow)" />
            <text class="eng-text-sm" x="245" y="162" text-anchor="middle">影响情绪</text>

            <line x1="470" y1="170" x2="620" y2="170" stroke="#6c5ce7" stroke-width="2" marker-end="url(#arrow)" />
            <text class="eng-text-sm" x="545" y="162" text-anchor="middle">影响身体</text>

            <!-- 双向虚线：情感 ↔ 身体 -->
            <path d="M 400 200 Q 400 240 750 240 L 750 205" stroke="#6c5ce7" stroke-width="1.5" fill="none" marker-end="url(#arrow)" stroke-dasharray="4,4" />
            <text class="eng-text-sm" x="570" y="235" text-anchor="middle">情感 ↔ 身体 双向影响</text>

            <!-- 受伤子引擎（身体引擎内嵌） -->
            <rect class="eng-box-accent" x="630" y="270" width="240" height="100" />
            <text class="eng-text eng-label" x="750" y="292" style="font-weight:600;">🩹 受伤子引擎</text>
            <text class="eng-text-sm eng-label" x="750" y="312">① 关键词预筛（确定性）</text>
            <text class="eng-text-sm eng-label" x="750" y="330">② LLM 语义裁决（开放类型）</text>
            <text class="eng-text-sm eng-label" x="750" y="348">③ 数值落地（severity / duration）</text>

            <!-- 身体引擎 → 受伤子引擎 -->
            <line x1="750" y1="200" x2="750" y2="265" stroke="#00b894" stroke-width="1.5" marker-end="url(#arrow-dash)" />

            <!-- 午休子模块 -->
            <rect class="eng-box-accent" x="330" y="270" width="240" height="100" />
            <text class="eng-text eng-label" x="450" y="292" style="font-weight:600;">😴 午休模块</text>
            <text class="eng-text-sm eng-label" x="450" y="312">窗口：12:00 ~ 14:00</text>
            <text class="eng-text-sm eng-label" x="450" y="330">概率：napTendency</text>
            <text class="eng-text-sm eng-label" x="450" y="348">时长：0.3 + napTendency × 0.7h</text>

            <!-- 身体引擎 → 午休 -->
            <line x1="650" y1="200" x2="570" y2="280" stroke="#00b894" stroke-width="1.5" marker-end="url(#arrow-dash)" />

            <!-- 底部：注入器 -->
            <rect class="eng-box" x="250" y="400" width="400" height="60" />
            <text class="eng-text eng-label" x="450" y="425" style="font-weight:600;">💉 注入器 (injector + worldBook)</text>
            <text class="eng-text-sm eng-label" x="450" y="445">引擎状态 → 提示词片段 → AI 请求</text>

            <!-- 三大引擎 → 注入器 -->
            <line x1="450" y1="370" x2="450" y2="395" stroke="#6c5ce7" stroke-width="1.5" marker-end="url(#arrow-dash)" />
            <line x1="100" y1="200" x2="100" y2="420" stroke="#6c5ce7" stroke-width="1" fill="none" stroke-dasharray="3,3" />
            <line x1="100" y1="420" x2="245" y2="430" stroke="#6c5ce7" stroke-width="1" stroke-dasharray="3,3" marker-end="url(#arrow-dash)" />
            <line x1="400" y1="200" x2="400" y2="400" stroke="#6c5ce7" stroke-width="1" stroke-dasharray="3,3" />
          </svg>
        </div>

        <h3>⏰ 时间引擎</h3>
        <p>提供游戏时间基准，驱动情感和身体状态的演化。支持变速（1x ~ 48x）和暂停，离线时自动计算。</p>
        <p class="note">💡 时间流速是全局基准：所有依赖"游戏时间"的机制（冷落、跨天、主动对话、场景过期、午休判定、受伤恢复）都会随之加速。8x 流速下 1 小时真实时间对应 8 小时游戏时间。可通过 <code>/time</code> 系列命令快速调整。</p>

        <h3>❤️ 情感引擎</h3>
        <p>基于六维情绪模型，结合五类需求和三类关系，通过时间衰减和用户互动事件实时更新。</p>
        <p><strong>个性化：</strong>每个角色的<strong>情绪敏感度</strong>、<strong>波动性</strong>、<strong>恢复速度</strong>、<strong>依恋建立速度</strong>、<strong>信任恢复倍率</strong>均可独立配置。敏感型角色对同一事件的反应幅度可达 1.82x，冷血杀手则可能只有 0.49x。</p>
        <p><strong>缩放公式：</strong></p>
        <ul>
          <li><strong>六维情绪</strong>：乘以 <code>(0.5 + emotionalSensitivity) × (0.5 + emotionalVolatility)</code></li>
          <li><strong>需求维度</strong>：乘以 <code>(0.5 + emotionalSensitivity)</code>（不受波动性影响）</li>
          <li><strong>信任建立</strong>（正向）：乘以 <code>trustRecoveryFactor</code></li>
          <li><strong>信任受损</strong>（负向）：乘以 <code>(0.5 + emotionalSensitivity)</code></li>
          <li><strong>亲密建立</strong>（正向）：乘以 <code>(0.5 + attachmentSpeed)</code></li>
        </ul>

        <h3>🏃 身体状态引擎</h3>
        <p>模拟角色的精力、睡意、健康、意识状态、睡眠周期、疾病、受伤，受时间和情感双重影响。可通过 <code>/wake</code> 命令唤醒睡眠中的角色。</p>

        <h4>三大子系统</h4>
        <div class="table-scroll-wrapper">
          <table>
            <thead><tr><th>子系统</th><th>触发方式</th><th>关键参数</th></tr></thead>
            <tbody>
              <tr>
                <td><strong>睡眠</strong></td>
                <td>时间驱动 + 困倦阈值</td>
                <td><code>sleepNeedHours</code> · <code>chronotype</code> · <code>wakeEase</code></td>
              </tr>
              <tr>
                <td><strong>午休</strong><span class="new-badge">v3.7</span></td>
                <td>午休窗口 + 概率 roll</td>
                <td><code>allowNapping</code> · <code>napTendency</code></td>
              </tr>
              <tr>
                <td><strong>疾病</strong></td>
                <td>健康 &lt; 50 时按概率触发</td>
                <td><code>illnessResistance</code> · <code>recoverySpeed</code></td>
              </tr>
              <tr>
                <td><strong>受伤</strong><span class="new-badge">v3.7</span></td>
                <td>关键词 + LLM 语义裁决</td>
                <td><code>injuryResistance</code> · <code>recoverySpeed</code></td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4>个性化 profile 影响</h4>
        <p>每个角色拥有独立的<strong>昼夜节律</strong>（早起鸟/夜猫子/中性/无节律）、<strong>体质</strong>（0-1）、<strong>抗病/抗伤能力</strong>、<strong>恢复速度</strong>、<strong>每日睡眠需求</strong>、<strong>午休习惯</strong>等。可选择 10 种<strong>特殊类型</strong>（不死之身、人造生命、吸血鬼等）获得对应特性。</p>

        <div style="background: rgba(108, 92, 231, 0.08); border-left: 3px solid var(--color-primary); padding: 0.6rem 1rem; border-radius: 4px; font-size: 0.85rem; margin-top: 0.8rem;">
          <strong>💡 配置层与运行时的分离：</strong>
          <ul style="margin: 0.3rem 0 0 0; padding-left: 1.2rem;">
            <li><strong>配置层</strong>（个性化引擎）：存储用户设置的原始 profile 值</li>
            <li><strong>运行时</strong>（三大引擎）：读取 profile，叠加特殊类型 overrides，得到实际生效的参数</li>
            <li>取消特殊类型后，原始值立即恢复生效</li>
          </ul>
        </div>
      </section>

      <section>
        <h2>🔄 完整对话流程</h2>
        <ol>
          <li>用户发送消息，系统同步时间引擎。</li>
          <li>更新情感和身体状态（基于时间流逝和事件）。</li>
          <li><strong>受伤检查</strong><span class="new-badge">v3.7</span>：关键词预筛 → LLM 语义裁决 → 数值缩放写入。</li>
          <li>根据上下文模式构建消息列表。</li>
          <li>应用注入器规则（身份、时间、一致性、世界书、语义规则）。</li>
          <li>构建完整消息列表，调用 AI API。</li>
          <li>流式接收回复，保存新记忆并异步生成摘要。</li>
          <li>命令执行结果通过"Utopia 控制台"气泡展示。</li>
        </ol>
      </section>

      <section>
        <h2>📞 语音通话流程</h2>
        <p>语音通话采用状态机驱动的半双工模式：</p>
        <ul>
          <li><strong>状态机</strong>：IDLE → INCOMING → CONNECTING → SPEAKING → LISTENING → PROCESSING → SPEAKING → ... → ENDED</li>
          <li><strong>防抢答</strong>：三重保障（状态锁、并发标志、TTS 播放监听）。</li>
          <li><strong>字幕显示</strong>：实时显示角色和用户的对话内容。</li>
          <li><strong>悬浮球</strong>：可拖动的悬浮球，显示通话时长。</li>
          <li><strong>来电超时</strong>：30 秒未接听自动挂断。</li>
        </ul>

        <h3>🛡️ 通话结束补偿机制</h3>
        <p>为避免因页面关闭、崩溃、异常导致的"通话结束消息未落库"问题，Utopia 引入补偿机制：</p>
        <ol>
          <li>通话结束时（无论主动挂断还是页面关闭），系统先写入一个临时标记</li>
          <li>若消息成功落库，标记被清除；若中途失败，标记保留</li>
          <li>下次启动应用时，系统自动检测残留标记并补写"通话结束"消息</li>
        </ol>
        <p class="note">💡 补偿机制具有幂等性——即使启动多次，同一次通话也只会有一条"通话结束"记录。</p>
      </section>

      <section>
        <h2>🔮 未来规划</h2>
        <ul>
          <li><strong>全双工实时语音通话</strong>：接入 WebRTC。</li>
          <li><strong>本地 Whisper STT</strong>：离线语音识别。</li>
          <li><strong>插件市场</strong>：官方插件商店 + 一键安装。</li>
          <li><strong>富媒体消息</strong>：支持图片/音频/视频消息。</li>
          <li><strong>剧情节点系统</strong>：剧情快照、分支回滚、多时间线管理。</li>
        </ul>
      </section>

      <section>
        <h2>❓ 常见问题</h2>
        <dl>
          <dt><strong>如何导入角色？</strong></dt>
          <dd>点击侧栏"导入"按钮，选择 .json / .png 格式的角色卡文件。</dd>

          <dt><strong>支持哪些角色卡格式？</strong></dt>
          <dd>Utopia v3/v3.1、SillyTavern v2/v3（含 PNG 卡）、Character.AI、通用格式。</dd>

          <dt><strong>为什么角色在睡觉？</strong></dt>
          <dd>身体状态引擎会根据游戏时间自动触发睡眠。可通过设置调整时间流速或关闭身体状态引擎。若想立即唤醒角色，使用 <code>/wake force</code> 命令。</dd>

          <dt><strong>如何快速切换角色？</strong></dt>
          <dd>使用 <code>/switch &lt;角色名&gt;</code> 或 <code>/sw &lt;角色名&gt;</code>。支持模糊匹配（精确 → 前缀 → 包含）。</dd>

          <dt><strong>如何切换检索模式？</strong></dt>
          <dd>在设置 → 长期记忆 中选择关键词/语义/混合检索。</dd>

          <dt><strong>个性化引擎与三大引擎有什么关系？</strong></dt>
          <dd>
            个性化引擎（profileDefaults）是<strong>配置层</strong>，它定义每个角色的体质与情绪特征参数；
            三大引擎（时间/情感/身体）在运行时<strong>读取这些参数</strong>来调整衰减速率、恢复速度、
            昼夜节律、事件影响幅度等。
            <br>
            例如：夜猫子角色的"身体状态引擎"在夜晚的精力乘数为 1.3，白天为 0.7；
            敏感型角色的"情感引擎"在同一事件下的情绪变化幅度是普通角色的 1.82 倍。
          </dd>

          <dt><strong>角色受伤是怎么判定的？</strong><span class="new-badge">v3.7</span></dt>
          <dd>
            受伤采用<strong>三层分离架构</strong>：
            <ol style="margin-top:0.3rem;padding-left:1.2rem;">
              <li><strong>关键词预筛</strong>：消息含"摔/撞/烫/划"等词才进入下一层，过滤 95%+ 日常对话</li>
              <li><strong>LLM 语义裁决</strong>：由 AI 判断是否确实包含致伤事件，自由生成受伤类型（不枚举）</li>
              <li><strong>数值缩放</strong>：<code>injuryResistance</code> 缩放 severity 和恢复时长</li>
            </ol>
            <strong>为什么不做纯概率：</strong>受伤必须有"原因"，而"原因"只能从语义中提取。纯 roll 会导致"聊天突然骨折"的荒谬。
            <br>
            <strong>为什么会拒绝判定：</strong>LLM prompt 明确约束"只有叙述中确实包含可能造成物理伤害的事件才判定受伤"，日常聊天、情绪表达、亲密互动都不会触发。
            <br>
            <strong>冷却保护</strong>：同一角色 2 游戏小时内不重复判定，防止 LLM 频繁调用。
          </dd>

          <dt><strong>午休是怎么触发的？</strong><span class="new-badge">v3.7</span></dt>
          <dd>
            午休仅在<strong>12:00 - 14:00 窗口</strong>内触发，且需同时满足：
            <ul style="margin-top:0.3rem;padding-left:1.2rem;">
              <li>角色勾选了"习惯午休"（<code>allowNapping = true</code>）</li>
              <li>当前不在睡眠状态（清醒或困倦）</li>
              <li>睡意 ≥ 55 且精力 &lt; 75</li>
              <li>当日尚未判定过（每日仅一次）</li>
              <li><code>Math.random() &lt; napTendency</code></li>
            </ul>
            <strong>午休时长</strong>：<code>0.3 + napTendency × 0.7</code> 小时。<code>napTendency = 0.8</code> 时约 55 分钟。
            <br>
            <strong>醒来补偿</strong>：睡意 -40，精力 +20，睡眠质量微增。
            <br>
            <strong>打断</strong>：用户可用 <code>/wake</code> 主动打断午休，此时不再享受醒来补偿。
          </dd>

          <dt><strong>特殊类型的覆盖是什么意思？</strong></dt>
          <dd>
            选择特殊类型（如"不死之身"）后，系统会在<strong>运行时</strong>用一套预定义的参数覆盖
            部分字段（例如强制"无睡意"、"不生病"），但<strong>不会修改</strong>你在滑块上设置的原始值。
            <br>
            取消特殊类型后，滑块上的原始值立即恢复生效。
            <br>
            <span class="note">💡 这解释了为什么编辑表单里显示的滑块值与运行时的实际值可能不同——运行时会叠加特殊类型的覆盖。</span>
          </dd>

          <dt><strong>角色的体质是自动推断的吗？</strong></dt>
          <dd>
            是的。创建/导入角色时：
            <ul>
              <li>若已配置 API，会通过 LLM 分析角色描述，同时量化性格、体质、情绪三组参数</li>
              <li>LLM 识别关键词（如"军人"→健壮、"体弱"→虚弱、"夜猫子"→evening、"修仙"→immortal、"午休"→napper）</li>
              <li>若未配置 API，会基于 6 维性格参数<strong>自动推导</strong>默认值</li>
            </ul>
            你也可以在角色编辑表单的"进阶设定"中手动调整。
          </dd>

          <dt><strong>如何用命令快速设置个性化参数？</strong></dt>
          <dd>
            使用 <code>/profile</code> 系列命令：
            <ul>
              <li><code>/profile</code> — 查看当前配置</li>
              <li><code>/profile special vampire</code> — 快速设为吸血鬼</li>
              <li><code>/profile set constitution 0.8</code> — 体质设为 0.8</li>
              <li><code>/profile set injuryResistance 0.9</code> — 受伤抵抗设为 0.9</li>
              <li><code>/profile reset</code> — 重置为自动推导值</li>
            </ul>
          </dd>

          <dt><strong>记忆检索阈值与世界书语义阈值有什么区别？</strong></dt>
          <dd>两者独立，控制不同功能：
            <ul>
              <li><strong>记忆检索阈值</strong>（设置 → 长期记忆）：控制长期记忆召回。调低 → 更容易"想起"历史对话；调高 → 只召回高度相关的记忆。</li>
              <li><strong>世界书语义阈值</strong>（设置 → 世界书语义触发）：控制世界书语义规则触发。调低 → 规则更易触发（可能误触发）；调高 → 只匹配高度相似的消息。</li>
              <li>调优时根据症状选择：<br>
                · AI 忘记之前内容 → 调低<b>记忆阈值</b><br>
                · AI 插入不相关记忆 → 调高<b>记忆阈值</b><br>
                · 剧情规则老不触发 → 调低<b>世界书阈值</b><br>
                · 剧情规则老误触发 → 调高<b>世界书阈值</b>
              </li>
            </ul>
          </dd>

          <dt><strong>摘要有什么作用？</strong></dt>
          <dd>摘要自动总结对话，帮助模型保持长期记忆和一致性。仅在"智能混合"上下文模式下注入。</dd>

          <dt><strong>数据保存在哪里？</strong></dt>
          <dd>所有数据存储在浏览器本地 IndexedDB 中，不会上传到任何服务器。</dd>

          <dt><strong>群聊中角色 @ 角色的行为是怎样的？</strong></dt>
          <dd>
            <ul>
              <li>用户 @ 多个角色时，被 @ 的角色会<strong>依次回复</strong>（间隔 800ms）</li>
              <li>角色 A 回复中 @ 角色 B，B 会在 800ms 后触发回复</li>
              <li>B 又 @ A 时不再触发（防止无限循环）</li>
              <li>用户没有 @ 任何人时，由 LLM 裁决器选择最合适的角色回复</li>
            </ul>
          </dd>

          <dt><strong>群聊时侧栏列表会闪烁吗？</strong></dt>
          <dd>不会。已通过"视觉签名去重"优化，只有角色/群组卡片外观变化时才真正重建 DOM。情绪/身体/互动等不改变外观的数据更新不会触发重建。</dd>

          <dt><strong>输入框命令怎么用？</strong></dt>
          <dd>在输入框中以 <code>/</code> 开头输入命令，如 <code>/help</code>。执行结果通过"Utopia 控制台"气泡展示。</dd>

          <dt><strong>群聊中能用命令吗？</strong></dt>
          <dd>可以，所有命令在群聊中同样有效。<code>/print</code> 会自动识别群聊模式，<code>/status</code> 支持 <code>@成员</code>。</dd>

          <dt><strong>如何临时调整采样参数？</strong></dt>
          <dd>使用 <code>/temp</code>、<code>/fp</code> 等参数命令，执行后立即生效，刷新后恢复。</dd>

          <dt><strong>如何调整游戏时间？</strong></dt>
          <dd>
            使用 <code>/time</code> 系列命令：
            <ul>
              <li><code>/time speed 8</code> — 改为 8 倍速</li>
              <li><code>/time set 22:30</code> — 调整到今晚 22:30</li>
              <li><code>/time advance 6</code> — 推进 6 小时</li>
              <li><code>/time pause</code> / <code>/time resume</code> — 暂停 / 恢复</li>
            </ul>
          </dd>

          <dt><strong>如何接入本地模型？</strong></dt>
          <dd>本地推理引擎提供 OpenAI 兼容端点，把"厂商"设为 OpenAI，"API Base URL"改为本地地址（如 <code>http://localhost:11434/v1/chat/completions</code>）。注意浏览器 CORS 限制。</dd>

          <dt><strong>TTS 支持哪些引擎？</strong></dt>
          <dd>支持 Web Speech API（Edge TTS，免费）和 Kokoro（本地/自托管），以及任何 OpenAI 兼容的语音合成 API。</dd>

          <dt><strong>如何为角色设置专属语音？</strong></dt>
          <dd>在角色编辑表单中展开"语音配置"区域，选择音色、调整语速/音调。</dd>

          <dt><strong>主动对话怎么触发？</strong></dt>
          <dd>需要同时满足"游戏时间空闲阈值"（默认 6 游戏小时）和"真实时间空闲阈值"（默认 20 分钟）。8x 流速下，真实 45 分钟左右即可触发。</dd>

          <dt><strong>如何手动发起语音通话？</strong></dt>
          <dd>在单聊中输入 <code>/call</code> 命令。角色睡眠中无法通话，可先 <code>/wake force</code> 唤醒。</dd>

          <dt><strong>如何验证引擎在正常运行？</strong></dt>
          <dd>启用开发者监控（见"🛠️ 开发者监控"章节），或在控制台查看 <code>window.__lastBudgetStats</code>、<code>window.__lastSemanticTrace</code> 等调试变量。</dd>

          <dt><strong>如何排查"AI 没有响应某个功能"的问题？</strong></dt>
          <dd>按以下顺序排查：
            <ol>
              <li>打开开发者监控，观察事件是否触发</li>
              <li>用 <code>/inspect</code> 查看当前生效规则和会话状态</li>
              <li>检查 <code>__engineMonitor.state.apiLog.at(-1).messages</code> 确认注入内容</li>
              <li>用 <code>__engineMonitor.snapshot()</code> + <code>diff()</code> 验证引擎副作用</li>
            </ol>
          </dd>

          <dt><strong>/inject 的提示词会在几轮对话中生效？</strong></dt>
          <dd>
            仅<strong>一轮</strong>（一次性）。发送下一条消息后自动清除，<strong>无论 AI 回复成功或失败</strong>。
            若需要提示词持续生效，请使用世界书规则。
          </dd>

          <dt><strong>为什么我在进阶设定里选了"不死之身"，滑块值还是显示原值？</strong></dt>
          <dd>
            "不死之身"等特殊类型在<strong>运行时</strong>强制覆盖某些字段（如"精力不衰减"、
            "无睡意"、"不生病"），但不会修改你在滑块上设置的原始值。
            <br>
            这样设计的原因是：你可以随时取消特殊类型，恢复原始设置。
            <br>
            <span class="note">💡 运行时行为以特殊类型的覆盖为准。UI 滑块显示的是你的原始设置。</span>
          </dd>

          <dt><strong>为什么角色有时候不会受伤？</strong><span class="new-badge">v3.7</span></dt>
          <dd>
            以下几种情况会导致不受伤：
            <ul>
              <li>消息不含受伤关键词（第 1 层过滤）</li>
              <li>角色刚判定过受伤（2 游戏小时冷却）</li>
              <li>角色已受伤（不重复触发）</li>
              <li>角色是 immortal / angel / spirit 或 injuryResistance ≥ 0.99</li>
              <li>LLM 判定叙述中没有致伤事件</li>
              <li>LLM 判定受伤但 <code>injuryResistance</code> 高到 severity 被缩放到 &lt; 5</li>
            </ul>
          </dd>

          <dt><strong>如何用插件扩展个性化引擎？</strong></dt>
          <dd>
            插件可通过 <code>api.profileDefaults.*</code> 读取/推导角色配置：
            <ul>
              <li><code>api.profileDefaults.getBodyProfile(character)</code> — 读取体质</li>
              <li><code>api.profileDefaults.getEmotionProfile(character)</code> — 读取情绪特质</li>
              <li><code>api.profileDefaults.getSpecialTypeList()</code> — 列出所有特殊类型</li>
            </ul>
            通过 <code>api.character.updateCharacter(id, { bodyProfile, emotionProfile })</code> 修改。
            需要 <code>character:read</code> 和 <code>character:write</code> 权限。
          </dd>
        </dl>
      </section>

      <div style="text-align:right;font-size:0.8rem;color:var(--color-text-muted);margin-top:1rem;border-top:1px solid var(--color-border);padding-top:0.5rem;">
        Utopia v3.7 · 文档版本 3.4 · 2026-09-19
      </div>
    </div>
  `;

  openModal(`
    <button class="modal-close">&times;</button>
    <div style="max-height:80vh;overflow-y:auto;padding:0.5rem;">
      ${content}
    </div>
  `);
}