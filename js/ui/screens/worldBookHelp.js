// js/ui/screens/worldBookHelp.js - 世界书使用教程 v3.2

export function renderWorldBookTutorial() {
  return `
    <button class="modal-close">&times;</button>
    <div class="help-content" style="max-height:75vh;overflow-y:auto;padding-right:0.5rem;">
      <style>
        .help-content .tut-section { margin-bottom: 1.8rem; }
        .help-content .tut-section h3 {
          font-size: 1.15rem;
          margin: 0 0 0.4rem 0;
          color: var(--color-text-primary);
          border-left: 4px solid var(--color-primary);
          padding-left: 0.7rem;
        }
        .help-content .tut-section h4 {
          font-size: 1rem;
          margin: 0.8rem 0 0.3rem 0;
          color: var(--color-text-secondary);
        }
        .help-content .tut-section p, .help-content .tut-section li {
          font-size: 0.9rem;
          color: var(--color-text-secondary);
          line-height: 1.7;
        }
        .help-content .tut-section ul, .help-content .tut-section ol {
          padding-left: 1.3rem;
          margin: 0.3rem 0;
        }
        .help-content .tut-section code {
          background: var(--color-bg-secondary);
          padding: 0.1rem 0.4rem;
          border-radius: 4px;
          font-size: 0.82rem;
          color: var(--color-primary);
          font-family: monospace;
        }
        .help-content .tut-section .example-box,
        .help-content .tut-section .warning-box,
        .help-content .tut-section .tip-box,
        .help-content .tut-section .danger-box,
        .help-content .tut-section .change-box {
          background: var(--color-bg-secondary);
          padding: 0.6rem 1rem;
          margin: 0.5rem 0;
          border-radius: 4px;
        }
        .help-content .tut-section .example-box { border-left: 3px solid var(--color-secondary); }
        .help-content .tut-section .warning-box { border-left: 3px solid var(--color-warning); }
        .help-content .tut-section .tip-box { border-left: 3px solid var(--color-primary-light); }
        .help-content .tut-section .danger-box { background: rgba(225, 112, 85, 0.08); border-left: 3px solid var(--color-danger); }
        .help-content .tut-section .change-box { background: rgba(108, 92, 231, 0.08); border-left: 3px solid var(--color-primary); }
        .help-content .tut-section table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.5rem 0;
          font-size: 0.85rem;
        }
        .help-content .tut-section th, .help-content .tut-section td {
          border: 1px solid var(--color-border);
          padding: 0.3rem 0.6rem;
          text-align: left;
        }
        .help-content .tut-section th { background: var(--color-bg-secondary); font-weight: 600; }
        .help-content .tut-section .feature-badge {
          display: inline-block;
          background: var(--color-primary-light);
          color: var(--color-primary-dark);
          font-size: 0.55rem;
          padding: 0.05rem 0.4rem;
          border-radius: var(--radius-full);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .help-content .tut-section .rule-type-badge {
          display: inline-block;
          padding: 0.05rem 0.4rem;
          border-radius: var(--radius-full);
          font-size: 0.65rem;
          font-weight: 600;
          margin-right: 0.3rem;
        }
        .help-content .tut-section .type-conditional { background: rgba(108, 92, 231, 0.15); color: var(--color-primary); }
        .help-content .tut-section .type-constant { background: rgba(0, 184, 148, 0.15); color: var(--color-secondary); }
        .help-content .tut-section .type-semantic { background: rgba(108, 92, 231, 0.2); color: var(--color-accent, #6c5ce7); }
        .help-content .tut-section .type-sticky { background: rgba(253, 203, 110, 0.25); color: #b8860b; }
        .help-content .tut-section .macro-table td:first-child code {
          background: transparent;
          padding: 0;
          color: var(--color-primary);
          font-weight: 600;
        }
        .help-content .tut-section .field-table td:first-child { font-weight: 600; }
        .help-content .tut-section .step {
          display: inline-block;
          background: var(--color-primary);
          color: #fff;
          width: 20px;
          height: 20px;
          text-align: center;
          line-height: 20px;
          border-radius: 50%;
          font-size: 0.7rem;
          font-weight: 700;
          margin-right: 0.4rem;
        }
        .help-content .tut-section .good { color: var(--color-secondary); font-weight: 600; }
        .help-content .tut-section .bad { color: var(--color-danger); font-weight: 600; }
        .help-content .tut-section .new-badge {
          display: inline-block;
          background: #ffeaa7;
          color: #b8860b;
          font-size: 0.55rem;
          padding: 0.05rem 0.4rem;
          border-radius: var(--radius-full);
          margin-left: 0.3rem;
          font-weight: 600;
        }
      </style>

      <h2 style="font-size:1.8rem;margin-top:0;margin-bottom:0.3rem;background:var(--color-primary-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">📖 世界书使用教程</h2>
      <p style="font-size:0.9rem;color:var(--color-text-muted);margin-bottom:1.5rem;">动态规则注入系统 · 完整指南 v3.2</p>

      <!-- ================================ -->
      <!-- 第零章：v3.2 变更摘要 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>🆕 v3.2 关键变更</h3>
        <div class="change-box">
          <p style="margin:0.3rem 0;"><strong>稳定性提升：</strong></p>
          <ul style="margin:0.3rem 0;">
            <li><strong>语义测试面板</strong>：当语义引擎加载失败或向量计算异常时，不再静默显示"全不匹配"，而是明确提示或返回空结果。<span class="new-badge">v3.2</span></li>
            <li><strong>规则维度保护</strong>：当规则的向量与当前查询向量的维度不匹配时，该规则会被安全跳过（不出现在测试结果中），而不是返回错误的相似度分数。</li>
            <li><strong>输入有效性校验</strong>：测试面板对空输入、非字符串输入做前置防御，避免引擎内部抛错。</li>
          </ul>
          <p style="margin:0.3rem 0;font-size:0.85rem;color:var(--color-text-muted);">
            这些改动不改变语义触发的核心逻辑，只提升了异常场景下的可预期性。
          </p>
        </div>
      </div>

      <!-- ================================ -->
      <!-- 第一章：概述 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>🎯 什么是世界书？</h3>
        <p>
          <strong>世界书（World Book）</strong> 是一套动态规则注入系统。它允许你在对话中，根据
          <strong>用户消息内容、角色状态、游戏时间、群组信息</strong> 等任意条件，
          自动向 AI 注入额外信息，从而改变剧情走向、角色反应或世界观设定。
        </p>
        <p style="font-size:1.05rem;font-weight:600;color:var(--color-text-primary);margin:0.5rem 0;">
          核心公式：<code style="font-size:1.1rem;">当 X 发生时 → 自动告诉 AI 信息 Y</code>
        </p>
        <div class="tip-box">
          <strong>💡 一句话理解：</strong> 世界书就是给 AI 的"情境触发器"——当剧情满足某个条件时，自动向 AI 的"大脑"中注入一段设定或描述。
        </div>
        <div class="tip-box">
          <strong>🎯 两种触发方式：</strong>
          <ul style="margin: 0.3rem 0 0 0;">
            <li><strong>条件触发（关键词/数值/时间）</strong>：传统方式，精确可控。</li>
            <li><strong>语义触发（自然语言描述）</strong>：<span class="feature-badge">v2.0 新增</span> 用一句话描述场景意图，系统自动匹配语义相近的用户消息，无需堆砌关键词。</li>
          </ul>
        </div>
        <div class="tip-box">
          <strong>📢 与其他模块的关系：</strong>
          <ul style="margin: 0.3rem 0 0 0;">
            <li>世界书规则同样适用于<strong>主动消息</strong>和<strong>语音通话</strong>。</li>
            <li>世界书是<strong>注入器（Injector）的上层应用</strong>——所有规则最终由注入器统一编排执行。</li>
            <li>语义触发依赖<strong>长期记忆</strong>中的语义模型（向量引擎），两者共享同一份模型配置。</li>
            <li>⚠️ <strong>世界书语义阈值</strong>（控制规则触发灵敏度）与<strong>记忆检索阈值</strong>（控制记忆召回精准度）是<strong>两个独立设置</strong>，互不影响。详见第三章"阈值对比"小节。</li>
          </ul>
        </div>
      </div>

      <!-- ================================ -->
      <!-- 第二章：核心概念 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>🧱 核心概念</h3>

        <h4>📄 规则（Rule）</h4>
        <p>规则是系统的原子单位，定义了一条完整的触发逻辑：<strong>当什么条件满足时，向 AI 注入什么内容</strong>。</p>
        <table>
          <thead><tr><th>字段</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>名称 / 描述</td><td>方便识别和管理</td></tr>
            <tr><td>作用域</td><td>全局 / 指定角色 / 指定群组</td></tr>
            <tr><td>所属规则组</td><td>可选，将规则放入组中便于统一管理</td></tr>
            <tr><td>规则类型</td><td>条件触发 / 常驻注入 / 语义触发 / 粘性</td></tr>
            <tr><td>触发条件</td><td>支持 AND/OR/NOT 嵌套组合（条件类型使用）</td></tr>
            <tr><td>语义查询</td><td>自然语言描述（语义类型使用）</td></tr>
            <tr><td>语义阈值</td><td>0~1，覆盖全局世界书语义阈值（可选）</td></tr>
            <tr><td>注入内容</td><td>满足条件时发送给 AI 的文本，支持宏模板</td></tr>
            <tr><td>位置</td><td>前置（消息前）/ 后置（消息后）</td></tr>
            <tr><td>优先级</td><td>数字越小越先执行（默认 50）</td></tr>
            <tr><td>概率</td><td>0~1，控制触发的随机性</td></tr>
            <tr><td>互斥组</td><td>同组内只触发一条规则</td></tr>
            <tr><td>规则链</td><td>触发后自动激活/停用其他规则</td></tr>
            <tr><td>粘性标识</td><td>粘性类型的唯一标识</td></tr>
          </tbody>
        </table>

        <h4>🎭 四种规则类型</h4>
        <table>
          <thead><tr><th>类型</th><th>说明</th><th>适用场景</th></tr></thead>
          <tbody>
            <tr>
              <td><span class="rule-type-badge type-conditional">条件触发</span></td>
              <td>根据条件表达式判断是否注入</td>
              <td>精确关键词、数值阈值、时间窗口</td>
            </tr>
            <tr>
              <td><span class="rule-type-badge type-constant">常驻注入</span></td>
              <td>每轮对话都注入</td>
              <td>角色核心设定、世界观基础规则</td>
            </tr>
            <tr>
              <td><span class="rule-type-badge type-semantic">语义触发</span></td>
              <td>用自然语言描述场景，系统自动匹配语义相似度</td>
              <td>情绪识别、意图判断、模糊场景</td>
            </tr>
            <tr>
              <td><span class="rule-type-badge type-sticky">粘性</span></td>
              <td>首次满足条件后持续注入，直到 <code>/reset</code></td>
              <td>持续状态（"角色已经知道秘密"）</td>
            </tr>
          </tbody>
        </table>

        <h4>📁 规则组（Group）</h4>
        <ul>
          <li><strong>批量管理</strong>：统一启用/禁用组内规则</li>
          <li><strong>组间互斥</strong>：同一时刻只有互斥组中的一个生效</li>
          <li><strong>组级规则链</strong>：触发后自动激活/停用其他组</li>
          <li><strong>优先级</strong>：组内规则默认继承组的优先级</li>
        </ul>

        <h4>🔗 规则链（Rule Chain）</h4>
        <p>一条规则触发时可以激活或停用其他规则/规则组，用于构建剧情状态机。</p>

        <h4>🚫 互斥组（Exclusive Group）</h4>
        <p>同组规则在本轮对话中只会触发一条。按优先级决定胜出者。</p>
      </div>

      <!-- ================================ -->
      <!-- 第三章：语义触发完整指南 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>🧠 语义触发完整指南</h3>

        <p>传统世界书依赖关键词精确匹配。语义触发允许你用一句自然语言描述场景意图，系统通过向量相似度自动匹配用户消息的变体表达。</p>

        <h4>🎯 前置条件</h4>
        <ol>
          <li><strong>配置语义模型</strong>：进入"设置 → 长期记忆"，选择语义模型（推荐 <code>Xenova/paraphrase-multilingual-MiniLM-L12-v2</code>，多语言，中文效果好）并下载。</li>
          <li><strong>选择 dtype</strong>：推荐 <code>q8</code>（8 位量化，体积小、速度快）。</li>
          <li><strong>启用世界书语义触发</strong>：进入"设置 → 世界书语义触发"，确保开关打开。</li>
          <li><strong>等待向量就绪</strong>：应用启动时会自动为所有语义规则生成向量（可手动点击"立即同步向量"）。</li>
        </ol>

        <div class="warning-box">
          <strong>⚠️ 引擎未就绪的表现：</strong>
          <ul style="margin: 0.3rem 0 0 0;">
            <li>语义规则编辑器中会出现"⚠️ 语义引擎未配置"的红色提示。</li>
            <li>规则卡片上会显示"向量未生成"（红色）。</li>
            <li>规则<strong>不会触发</strong>，但不影响其他类型规则。</li>
          </ul>
        </div>

        <h4>📝 三步创建一条语义规则</h4>
        <ol>
          <li>点击"创建规则"，填写名称/描述，选择作用域。</li>
          <li>在"规则类型"中选择 <strong>语义触发</strong>，界面会显示"语义触发"面板。</li>
          <li>在"描述触发场景"中填写一句自然语言。选择性地设置阈值（留空使用世界书全局默认）。</li>
          <li>填写"注入内容"（支持宏模板），保存。</li>
        </ol>

        <h4>✍️ 如何写好语义查询</h4>
        <div class="example-box">
          <p><strong class="good">✅ 推荐写法</strong>（描述意图，粒度适中）</p>
          <ul style="margin: 0.3rem 0;">
            <li>用户表达了孤独、悲伤或需要陪伴的情绪</li>
            <li>用户提到了童年的回忆或往事</li>
            <li>用户在深夜向角色倾诉心事</li>
            <li>用户询问角色对某件事的看法</li>
            <li>用户表达了爱意或亲密情感</li>
          </ul>

          <p><strong class="bad">❌ 避免的写法</strong></p>
          <ul style="margin: 0.3rem 0;">
            <li><span class="bad">关键词堆砌</span>：孤独、寂寞、难过、伤心、抑郁</li>
            <li><span class="bad">过于具体</span>：用户说"我很孤独"</li>
            <li><span class="bad">过于模糊</span>：询问过去</li>
            <li><span class="bad">多意图混合</span>：用户表达了高兴或难过或生气</li>
          </ul>

          <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:0.5rem;">
            核心思路：用一句话描述"什么场景应该触发"，让系统理解意图，而不是匹配字面。
          </p>
        </div>

        <h4>🧪 测试匹配</h4>
        <ol>
          <li>点击"🧪 测试匹配"展开测试面板。</li>
          <li>输入一段测试文本，如"我今天有点难过，想找人说说话"。</li>
          <li>点击"运行测试"。</li>
          <li>系统会显示匹配分数、当前阈值、是否会触发。</li>
        </ol>
        <div class="tip-box">
          <strong>💡 调试建议：</strong>
          <ul style="margin: 0.3rem 0 0 0;">
            <li><strong>分数偏高（&gt;0.8）</strong>：语义查询很精确，但可能漏掉变体。</li>
            <li><strong>分数中等（0.5-0.7）</strong>：比较理想，配合 0.55 的阈值效果最佳。</li>
            <li><strong>分数偏低（&lt;0.4）</strong>：语义查询与测试文本差异较大。</li>
          </ul>
        </div>

        <div class="warning-box">
          <strong>⚠️ 关于"无匹配结果"<span class="new-badge">v3.2</span></strong>
          <p style="margin:0.3rem 0;">当测试结果显示"无匹配结果"时，可能的原因有：</p>
          <ul style="margin:0.3rem 0;">
            <li><strong>语义不相关</strong>：测试文本与所有规则的语义查询都不匹配（正常情况）。</li>
            <li><strong>引擎未就绪</strong>：语义模型未配置或向量生成未完成。此时编辑器会显示"⚠️ 语义引擎未配置"的提示。</li>
            <li><strong>向量维度不匹配</strong>：规则的向量是旧模型生成的，与当前模型维度不一致。该规则会被自动跳过（控制台会输出 <code>[WorldBook] testSemanticMatch: 规则 "xxx" 向量维度不匹配，跳过</code>）。</li>
            <li><strong>模型异常</strong>：向量化过程中出现内部异常。此时控制台会输出 <code>[WorldBook] testSemanticMatch: 向量化失败</code> 或 <code>向量化返回无效数据</code>。</li>
          </ul>
          <p style="margin:0.3rem 0;font-size:0.85rem;">
            <strong>排查步骤：</strong>先看控制台日志，再看设置中语义模型是否就绪，最后才是调整语义查询。
          </p>
        </div>

        <h4>🎚️ 世界书语义阈值</h4>
        <p>阈值决定"多相似才算触发"，是世界书语义规则的<strong>核心调优参数</strong>。</p>
        <table>
          <thead><tr><th>阈值</th><th>效果</th><th>适用场景</th></tr></thead>
          <tbody>
            <tr><td>0.40 - 0.50</td><td>宽松，召回多，可能误触发</td><td>探索性规则、调试阶段</td></tr>
            <tr><td>0.55（推荐）</td><td>平衡，兼顾召回和精度</td><td>大部分场景</td></tr>
            <tr><td>0.65 - 0.75</td><td>严格，召回少但精准</td><td>关键剧情、易误触发的规则</td></tr>
            <tr><td>0.80+</td><td>极严格，只匹配几乎同义</td><td>需要精确控制的场景</td></tr>
          </tbody>
        </table>
        <p>每条规则可以单独设定阈值（留空使用世界书全局默认）。全局默认在"设置 → 世界书语义触发"中配置。</p>

        <h4>⚖️ 世界书语义阈值 vs 记忆检索阈值</h4>
        <p>这两个阈值都涉及"向量相似度"，但<strong>控制完全不同的功能</strong>，两者互不影响：</p>
        <table>
          <thead>
            <tr><th>对比项</th><th>世界书语义阈值</th><th>记忆检索阈值</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>控制的功能</td>
              <td>世界书语义规则是否触发</td>
              <td>长期记忆是否被召回</td>
            </tr>
            <tr>
              <td>配置位置</td>
              <td>设置 → 世界书语义触发</td>
              <td>设置 → 长期记忆</td>
            </tr>
            <tr>
              <td>默认值</td>
              <td>0.55</td>
              <td>0.55</td>
            </tr>
            <tr>
              <td>调高影响</td>
              <td>规则触发更严格，只匹配高度相似的消息</td>
              <td>召回的记忆更精准，但可能漏掉相关内容</td>
            </tr>
            <tr>
              <td>调低影响</td>
              <td>规则更易触发，但可能误触发</td>
              <td>召回更多记忆，但可能包含不相关内容</td>
            </tr>
            <tr>
              <td>典型用途</td>
              <td>控制剧情注入的精准度</td>
              <td>控制上下文记忆的丰富度</td>
            </tr>
          </tbody>
        </table>
        <div class="tip-box">
          <strong>💡 调优思路：</strong>
          <ul style="margin: 0.3rem 0 0 0;">
            <li>如果 AI 老是插入不该插入的剧情 → <strong>调高世界书语义阈值</strong></li>
            <li>如果 AI 总是忘记之前聊过的内容 → <strong>调低记忆检索阈值</strong></li>
            <li>如果发现回复中经常夹杂不相关的记忆 → <strong>调高记忆检索阈值</strong></li>
            <li>如果关键剧情规则总是不触发 → <strong>调低世界书语义阈值</strong></li>
          </ul>
        </div>

        <h4>🔗 高级：附加额外约束</h4>
        <p>语义触发面板下方展开"▸ 高级：添加额外约束条件"，设置的条件会与语义命中<strong>以 AND 组合</strong>。</p>
        <div class="example-box">
          <p><strong>示例：深夜安慰</strong></p>
          <ul style="margin: 0.3rem 0;">
            <li><strong>语义查询</strong>：用户表达孤独、难过或需要安慰</li>
            <li><strong>额外约束</strong>：游戏时间-小时 &gt;= 22</li>
            <li><strong>效果</strong>：只有深夜 + 情绪低落时才触发</li>
          </ul>
        </div>

        <h4>🔄 向量同步</h4>
        <p>语义规则的向量在以下时机自动生成/更新：</p>
        <ul>
          <li><strong>保存规则时</strong>：生成语义查询的向量</li>
          <li><strong>修改语义查询时</strong>：重新生成向量</li>
          <li><strong>切换语义模型时</strong>：所有旧向量自动失效，后台重新生成</li>
          <li><strong>应用启动时</strong>：如果启用了"启动时自动同步向量"</li>
        </ul>
        <p>也可以在世界书主界面点击"🧠 同步向量"按钮，或在设置面板点击"立即同步向量"手动触发。</p>

        <h4>🐛 调试语义触发</h4>
        <p>使用 <code>/inspect</code>（或 <code>/ins</code>）命令，可以查看<strong>上一轮对话中所有语义规则的匹配轨迹</strong>：</p>
        <pre>🔍 上一轮语义匹配轨迹
用户消息: "我今天心情不太好，想找人说说话"
  ✅ 孤独安慰          0.6823 ██████░░░░ (阈值 0.55)
  ❌ 童年回忆          0.3102 ███░░░░░░░ (阈值 0.55)
  ✅ 深夜倾诉          0.6104 ██████░░░░ (阈值 0.55)</pre>
        <ul>
          <li><code>✅</code> 表示会触发（分数 ≥ 阈值）</li>
          <li><code>❌</code> 表示不会触发</li>
          <li>进度条直观显示分数与阈值的相对位置</li>
          <li>每行末尾的阈值来自规则自定义或世界书全局默认</li>
        </ul>
      </div>

      <!-- ================================ -->
      <!-- 第四章：条件编辑器 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>🧩 条件编辑器（AND / OR / NOT）</h3>
        <p>条件触发和粘性类型使用条件编辑器。通过"转为组合条件"可将简单条件升级为组合条件。</p>

        <table>
          <thead><tr><th>类型</th><th>含义</th><th>使用场景</th></tr></thead>
          <tbody>
            <tr><td><code>AND</code></td><td>所有子条件必须同时满足</td><td>"用户提到钥匙 <strong>且</strong> 角色在密室中"</td></tr>
            <tr><td><code>OR</code></td><td>任一子条件满足即可触发</td><td>"用户提到箱子 <strong>或</strong> 提到宝箱"</td></tr>
            <tr><td><code>NOT</code></td><td>条件取反</td><td>"用户消息 <strong>不包含</strong> 放弃"</td></tr>
          </tbody>
        </table>

        <div class="example-box">
          <p><strong>✅ 示例：混合嵌套条件</strong></p>
          <p><code>AND</code>（用户消息包含 "密室"）</p>
          <p style="padding-left:1.5rem;"><code>OR</code>（用户消息包含 "钥匙" <strong>OR</strong> 用户消息包含 "锁"）</p>
          <p><code>AND</code> 角色愉悦度 &lt; -20</p>
        </div>
      </div>

      <!-- ================================ -->
      <!-- 第五章：可用条件路径 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>📋 可用条件路径</h3>

        <table class="field-table">
          <thead>
            <tr><th>路径</th><th>说明</th><th>示例值 / 范围</th></tr>
          </thead>
          <tbody>
            <tr><td><code>user.message</code></td><td>当前用户消息</td><td>"你好，今天天气真好"</td></tr>
            <tr><td><code>character.name</code></td><td>当前角色名称</td><td>"猫猫"</td></tr>
            <tr><td><code>character.description</code></td><td>角色描述</td><td>"一只可爱的猫咪"</td></tr>
            <tr><td><code>character.personality</code></td><td>角色性格</td><td>"活泼好动"</td></tr>
            <tr><td><code>character.relationship</code></td><td>角色关系</td><td>"宠物"</td></tr>
            <tr><td><code>emotionState.valence</code></td><td>情感-愉悦度</td><td>-100 ~ 100</td></tr>
            <tr><td><code>emotionState.arousal</code></td><td>情感-唤醒度</td><td>-100 ~ 100</td></tr>
            <tr><td><code>emotionState.dominance</code></td><td>情感-支配度</td><td>-100 ~ 100</td></tr>
            <tr><td><code>emotionState.affection</code></td><td>情感-好感度</td><td>-100 ~ 100</td></tr>
            <tr><td><code>bodyState.energy</code></td><td>身体-精力</td><td>0 ~ 100</td></tr>
            <tr><td><code>bodyState.sleepiness</code></td><td>身体-睡意</td><td>0 ~ 100</td></tr>
            <tr><td><code>bodyState.health</code></td><td>身体-健康</td><td>0 ~ 100</td></tr>
            <tr><td><code>bodyState.sleepStatus</code></td><td>身体-睡眠状态</td><td>"清醒" / "困倦" / "浅睡" / "深睡"</td></tr>
            <tr><td><code>gameTime.hour</code></td><td>游戏时间-小时</td><td>0 ~ 23</td></tr>
            <tr><td><code>gameTime.minute</code></td><td>游戏时间-分钟</td><td>0 ~ 59</td></tr>
            <tr><td><code>gameTime.period</code></td><td>游戏时间-时段</td><td>"清晨" / "上午" / "中午" / "下午" / "傍晚" / "夜晚" / "深夜"</td></tr>
            <tr><td><code>gameTime.full</code></td><td>游戏时间-完整</td><td>"2026年9月15日 星期一 14:30"</td></tr>
            <tr><td><code>group.name</code></td><td>群组-名称</td><td>"深夜咖啡馆"</td></tr>
            <tr><td><code>group.description</code></td><td>群组-描述</td><td>"一个安静的社交场所"</td></tr>
            <tr><td><code>group.memberCount</code></td><td>群组-成员数</td><td>5</td></tr>
            <tr><td><code>group.activeLevel</code></td><td>群组-活跃度</td><td>"活跃" / "正常" / "低活跃" / "冷清"</td></tr>
          </tbody>
        </table>

        <div class="warning-box">
          <strong>⚠️ 路径可用性：</strong>
          <ul style="margin: 0.3rem 0 0 0;">
            <li>情感路径只在<strong>单聊</strong>模式下有效。</li>
            <li>群组路径只在<strong>群聊</strong>模式下有效。</li>
            <li>情感/身体字段需要对应引擎开启。</li>
          </ul>
        </div>
      </div>

      <!-- ================================ -->
      <!-- 第六章：操作符列表 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>⚙️ 条件操作符</h3>
        <table>
          <thead>
            <tr><th>操作符</th><th>含义</th><th>适用类型</th></tr>
          </thead>
          <tbody>
            <tr><td><code>eq</code></td><td>等于</td><td>全部</td></tr>
            <tr><td><code>neq</code></td><td>不等于</td><td>全部</td></tr>
            <tr><td><code>gt</code></td><td>大于</td><td>数字</td></tr>
            <tr><td><code>gte</code></td><td>大于等于</td><td>数字</td></tr>
            <tr><td><code>lt</code></td><td>小于</td><td>数字</td></tr>
            <tr><td><code>lte</code></td><td>小于等于</td><td>数字</td></tr>
            <tr><td><code>contains</code></td><td>字符串包含</td><td>字符串</td></tr>
            <tr><td><code>not_contains</code></td><td>字符串不包含</td><td>字符串</td></tr>
            <tr><td><code>startsWith</code></td><td>以...开头</td><td>字符串</td></tr>
            <tr><td><code>endsWith</code></td><td>以...结尾</td><td>字符串</td></tr>
            <tr><td><code>regex</code></td><td>正则匹配</td><td>字符串</td></tr>
            <tr><td><code>exists</code></td><td>值存在</td><td>全部</td></tr>
            <tr><td><code>empty</code></td><td>值为空</td><td>全部</td></tr>
            <tr><td><code>between</code></td><td>数值在区间内</td><td>数字（value 为数组）</td></tr>
            <tr><td><code>lengthGt</code></td><td>字符串长度大于</td><td>字符串</td></tr>
            <tr><td><code>lengthLt</code></td><td>字符串长度小于</td><td>字符串</td></tr>
            <tr><td><code>in</code></td><td>值包含于数组</td><td>字符串（value 为数组）</td></tr>
            <tr><td><code>not_in</code></td><td>不包含于数组</td><td>字符串（value 为数组）</td></tr>
            <tr style="background: var(--color-bg-secondary);"><td><code>semantic_match</code></td><td>语义匹配（<strong>系统内部使用</strong>）</td><td>—</td></tr>
          </tbody>
        </table>
      </div>

      <!-- ================================ -->
      <!-- 第七章：规则组管理 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>📁 规则组管理</h3>

        <div class="example-box">
          <p><strong>📌 使用场景：剧情线切换</strong></p>
          <ul>
            <li><strong>组 A - 日常对话</strong>：问候、闲聊等规则</li>
            <li><strong>组 B - 战斗模式</strong>：战斗相关规则</li>
          </ul>
          <p>当用户说 "拔剑" 时：激活组 B，停用组 A。实现剧情无缝切换。</p>
        </div>

        <h4>🔧 组编辑器字段</h4>
        <table>
          <thead><tr><th>字段</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>组名称</td><td>必填</td></tr>
            <tr><td>描述</td><td>可选</td></tr>
            <tr><td>启用此组</td><td>关闭后组内规则全部失效</td></tr>
            <tr><td>优先级</td><td>0 ~ 999</td></tr>
            <tr><td>组内规则</td><td>从下拉列表添加</td></tr>
            <tr><td>组间互斥</td><td>选择互斥组</td></tr>
            <tr><td>激活组 / 停用组</td><td>组级规则链</td></tr>
          </tbody>
        </table>

        <h4>🧹 清空组内规则</h4>
        <p>编辑已有组时底部有"🗑️ 清空组内规则"按钮。只移除规则与组的关联，不删除规则本身。</p>
      </div>

      <!-- ================================ -->
      <!-- 第八章：宏模板 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>📌 宏模板</h3>
        <p>在"注入内容"中可以使用以下占位符，运行时被替换为实际值。</p>

        <table class="macro-table">
          <thead>
            <tr><th>宏</th><th>来源</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr><td><code>{{character.name}}</code></td><td>角色</td><td>当前角色名称</td></tr>
            <tr><td><code>{{character.description}}</code></td><td>角色</td><td>角色简介</td></tr>
            <tr><td><code>{{character.personality}}</code></td><td>角色</td><td>角色性格描述</td></tr>
            <tr><td><code>{{character.relationship}}</code></td><td>角色</td><td>角色与用户的关系</td></tr>
            <tr><td><code>{{character.callUser}}</code></td><td>角色</td><td>角色对用户的称呼</td></tr>
            <tr><td><code>{{user.name}}</code></td><td>用户</td><td>用户名</td></tr>
            <tr><td><code>{{user.message}}</code></td><td>用户</td><td>当前用户消息内容</td></tr>
            <tr><td><code>{{gameTime.full}}</code></td><td>时间</td><td>完整游戏时间</td></tr>
            <tr><td><code>{{gameTime.natural}}</code></td><td>时间</td><td>自然语言时间</td></tr>
            <tr><td><code>{{gameTime.period}}</code></td><td>时间</td><td>时段</td></tr>
            <tr><td><code>{{gameTime.hour}}</code></td><td>时间</td><td>小时（24 小时制）</td></tr>
            <tr><td><code>{{gameTime.minute}}</code></td><td>时间</td><td>分钟</td></tr>
            <tr><td><code>{{gameTime.description}}</code></td><td>时间</td><td>时段的详细描述</td></tr>
            <tr><td><code>{{group.name}}</code></td><td>群组</td><td>群组名称</td></tr>
            <tr><td><code>{{group.description}}</code></td><td>群组</td><td>群组描述</td></tr>
            <tr><td><code>{{group.memberCount}}</code></td><td>群组</td><td>成员总数</td></tr>
            <tr><td><code>{{group.members}}</code></td><td>群组</td><td>成员名称列表</td></tr>
            <tr><td><code>{{group.activeLevel}}</code></td><td>群组</td><td>活跃度</td></tr>
            <tr><td><code>{{group.rules}}</code></td><td>群组</td><td>群组设置的规则文本</td></tr>
          </tbody>
        </table>

        <div class="warning-box">
          <strong>⚠️ 路径宏的默认值：</strong> 支持 <code>{{path || default}}</code> 语法。例如 <code>{{character.relationship || 朋友}}</code>，路径不存在时渲染为"朋友"。
        </div>
      </div>

      <!-- ================================ -->
      <!-- 第九章：实战示例 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>🌤️ 实战示例一：天气系统</h3>
        <ul>
          <li>用户提到天气时，以概率触发（不是每次必应）</li>
          <li>一天内不会频繁变化</li>
          <li>天气互斥（晴天、雨天、阴天不同时出现）</li>
        </ul>

        <div class="example-box">
          <p><strong>规则 1：晴天</strong></p>
          <ul>
            <li><strong>类型</strong>：条件触发</li>
            <li><strong>触发条件</strong>：AND (用户消息包含"天气"，用户消息包含"今天"，时段="清晨")</li>
            <li><strong>注入内容</strong>：<code>【天气】今天是晴天，阳光明媚，适合出门散步。</code></li>
            <li><strong>概率</strong>：0.35</li>
            <li><strong>互斥组</strong>：<code>weather</code></li>
          </ul>
        </div>
        <p>雨天、阴天规则类似，共享同一互斥组，概率各 0.30 / 0.35。</p>
      </div>

      <div class="tut-section">
        <h3>🎭 实战示例二：语义触发（情绪安抚）</h3>

        <div class="example-box">
          <p><strong>规则：情绪安抚</strong></p>
          <ul>
            <li><strong>类型</strong>：<span class="rule-type-badge type-semantic">语义触发</span></li>
            <li><strong>语义查询</strong>：<code>用户表达了孤独、难过、沮丧或需要陪伴的情绪</code></li>
            <li><strong>语义阈值</strong>：<code>0.55</code>（或留空用世界书全局默认）</li>
            <li><strong>高级额外约束</strong>：角色好感度 ≥ 30</li>
            <li><strong>注入内容</strong>：<code>{{character.name}} 注意到你的情绪，眼神柔和下来，轻轻靠近了一些。</code></li>
          </ul>
        </div>

        <h4>🧪 测试匹配</h4>
        <ol>
          <li>展开"🧪 测试匹配"</li>
          <li>输入不同表达测试："我今天有点难过" → 应命中；"今天吃了火锅" → 不应命中</li>
          <li>如果分数不理想，调整语义查询或阈值</li>
        </ol>

        <h4>🎯 扩展语义规则组</h4>
        <table>
          <thead><tr><th>规则名</th><th>语义查询</th><th>注入内容风格</th></tr></thead>
          <tbody>
            <tr><td>孤独安慰</td><td>用户表达孤独、想找人陪</td><td>温柔陪伴</td></tr>
            <tr><td>悲伤安抚</td><td>用户表达悲伤、难过、想哭</td><td>安静陪伴</td></tr>
            <tr><td>愤怒疏导</td><td>用户表达生气、烦躁、抱怨</td><td>耐心倾听</td></tr>
            <tr><td>焦虑缓解</td><td>用户表达焦虑、紧张、担心</td><td>给予安全感</td></tr>
            <tr><td>快乐分享</td><td>用户分享喜悦、兴奋、好消息</td><td>跟着开心</td></tr>
          </tbody>
        </table>
        <div class="tip-box">
          <strong>💡 用互斥组避免冲突：</strong> 给所有情绪规则打上相同互斥组（如 <code>emotion-response</code>），确保一轮对话最多只触发一种。
        </div>
      </div>

      <!-- ================================ -->
      <!-- 第十章：更多实战示例 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>🎭 更多实战示例</h3>

        <div class="example-box">
          <p><strong>📌 深夜劝睡</strong></p>
          <ul>
            <li><strong>条件</strong>：<code>gameTime.hour</code> 大于 23 OR 小于 5</li>
            <li><strong>注入</strong>：夜深了，{{character.name}} 的眼皮开始打架，声音带着困意。</li>
          </ul>
        </div>

        <div class="example-box">
          <p><strong>📌 情绪联动</strong></p>
          <ul>
            <li><strong>条件</strong>：<code>emotionState.valence</code> 小于 -30</li>
            <li><strong>注入</strong>：{{character.name}} 低着头，声音有些哽咽，似乎心情很低落。</li>
          </ul>
        </div>

        <div class="example-box">
          <p><strong>📌 疲惫状态</strong></p>
          <ul>
            <li><strong>条件</strong>：<code>bodyState.energy</code> 小于 30</li>
            <li><strong>注入</strong>：{{character.name}} 打了个哈欠，眼神有些涣散，似乎很累。</li>
          </ul>
        </div>

        <div class="example-box">
          <p><strong>📌 群组专属设定</strong></p>
          <ul>
            <li><strong>作用域</strong>：群组 → 选择你的群组</li>
            <li><strong>条件</strong>：<code>user.message</code> 包含 "咖啡馆"</li>
            <li><strong>注入</strong>：{{group.description}} 弥漫着咖啡豆的香气，角落里的留声机放着爵士乐。</li>
          </ul>
        </div>

        <div class="example-box">
          <p><strong>📌 规则链（剧情推进）</strong></p>
          <ul>
            <li>规则 A：用户说"打开密室" → 注入"你闻到潮湿的泥土气息"，激活规则 B</li>
            <li>规则 B：用户说"箱子" → 注入"你发现了一个古老箱子"</li>
          </ul>
        </div>

        <div class="example-box">
          <p><strong>📌 粘性规则（持续状态）</strong></p>
          <ul>
            <li><strong>类型</strong>：粘性</li>
            <li><strong>粘性标识</strong>：<code>secret_revealed</code></li>
            <li><strong>条件</strong>：用户说"告诉我真相"</li>
            <li><strong>注入</strong>：你已经知道了真相，这件事必须保密。</li>
            <li>一旦触发，后续每轮都会注入，直到 <code>/reset</code></li>
          </ul>
        </div>
      </div>

      <!-- ================================ -->
      <!-- 第十一章：导入导出 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>📤 导入导出</h3>

        <h4>导出</h4>
        <p>世界书主界面"📤 导出"按钮可导出规则、规则组或全部。文件名：<code>worldbook_rules_YYYY-MM-DD.json</code></p>

        <h4>导入</h4>
        <p>选择 JSON 文件，系统会自动识别是规则还是组。</p>
        <div class="warning-box">
          <strong>⚠️ 导入注意事项：</strong>
          <ul style="margin: 0.3rem 0 0 0;">
            <li>导入的规则会<strong>追加</strong>，不会覆盖已有规则。</li>
            <li>如果规则携带的 <code>vector</code> 与当前语义模型不匹配，会被自动清空。<span class="new-badge">v3.2</span></li>
            <li>如果规则携带 <code>groupId</code> 但对应的组不存在，系统会自动创建一个空组。</li>
            <li>语义规则的 <code>_userCondition</code>（高级额外约束）会保留；如发现导入后的语义规则条件异常，可尝试重新编辑保存以触发规范化。</li>
          </ul>
        </div>

        <h4>字段兼容性<span class="new-badge">v3.2</span></h4>
        <table>
          <thead><tr><th>字段</th><th>跨版本兼容性</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>缺失时自动生成；重复时会作为新规则导入</td></tr>
            <tr><td><code>condition</code></td><td>旧格式（含语义 cond 混杂）会在导入时被规范化</td></tr>
            <tr><td><code>_userCondition</code></td><td>语义规则的额外约束；缺失时视为无额外约束</td></tr>
            <tr><td><code>vector</code> / <code>vectorModel</code></td><td>模型不匹配时自动清空，下次同步时重建</td></tr>
            <tr><td><code>semanticThreshold</code></td><td>null 或缺失表示"使用全局默认"</td></tr>
            <tr><td><code>onTrigger</code></td><td>缺失时自动填充空数组</td></tr>
            <tr><td><code>exclusiveGroup</code></td><td>缺失时视为无互斥</td></tr>
          </tbody>
        </table>
      </div>

      <!-- ================================ -->
      <!-- 第十二章：常见问题 -->
      <!-- ================================ -->
      <div class="tut-section">
        <h3>❓ 常见问题</h3>

        <h4>规则为什么不生效？</h4>
        <ol>
          <li>规则是否<strong>启用</strong>？</li>
          <li>所属组是否<strong>启用</strong>？</li>
          <li>作用域是否匹配当前对话（角色/群组）？</li>
          <li>条件路径和值是否正确？建议用 <code>/inspect</code> 查看当前生效规则。</li>
          <li>概率是否设置得太低？（调试时可设为 1.0）</li>
          <li><strong>语义规则</strong>额外检查：
            <ul>
              <li>语义模型是否已配置？</li>
              <li>规则卡片上是否显示"向量已生成"？</li>
              <li>"设置 → 世界书语义触发"是否启用？</li>
            </ul>
          </li>
        </ol>

        <h4>如何测试规则？</h4>
        <ul>
          <li><strong>条件规则</strong>：发送匹配条件的消息，观察 AI 回复。也可以将概率设为 1.0 确保触发。</li>
          <li><strong>语义规则</strong>：使用编辑器内的"🧪 测试匹配"面板。</li>
          <li><strong>综合调试</strong>：发送消息后执行 <code>/inspect</code>，查看上一轮触发了哪些规则。</li>
        </ul>

        <h4>世界书语义阈值和记忆检索阈值有什么区别？</h4>
        <p>见本教程第三章"⚖️ 世界书语义阈值 vs 记忆检索阈值"小节。简要说明：</p>
        <ul>
          <li><strong>世界书语义阈值</strong>：控制"世界书规则是否触发"。配置位置：设置 → 世界书语义触发。</li>
          <li><strong>记忆检索阈值</strong>：控制"长期记忆是否被召回"。配置位置：设置 → 长期记忆。</li>
          <li>两者<strong>互不影响</strong>，可以独立调优。</li>
        </ul>

        <h4>测试匹配面板显示"无匹配结果"是怎么回事？<span class="new-badge">v3.2</span></h4>
        <p>"无匹配结果"可能表示以下几种情况，请按顺序排查：</p>
        <ol>
          <li><strong>正常情况</strong>：测试文本与所有规则的语义查询确实不相关，分数低于阈值。</li>
          <li><strong>引擎未就绪</strong>：打开浏览器控制台，检查是否有 <code>[WorldBook] testSemanticMatch: 语义引擎未就绪</code> 或 <code>embedder 未初始化</code> 的日志。若有，进入设置 → 长期记忆，确认语义模型已下载并加载。</li>
          <li><strong>向量维度不匹配</strong>：控制台若输出 <code>规则 "xxx" 向量维度不匹配，跳过</code>，说明该规则的向量是旧模型生成的。在世界书主界面点击"🧠 同步向量"重建。</li>
          <li><strong>向量化失败</strong>：控制台若输出 <code>向量化失败</code> 或 <code>向量化返回无效数据</code>，说明语义引擎内部异常。尝试重启应用或重新下载模型。</li>
        </ol>
        <div class="tip-box">
          <strong>💡 排查顺序：</strong>控制台日志 → 引擎就绪状态 → 向量同步 → 语义查询内容。
        </div>

        <h4>规则组和类别（category）有什么区别？</h4>
        <p>类别只是标签用于筛选；规则组是功能性的，支持组间互斥和链式触发。</p>

        <h4>如何获取规则 ID？</h4>
        <p>编辑已有规则时顶部会显示 ID，点击"复制"即可。</p>

        <h4>互斥组怎么工作？</h4>
        <p>同互斥组内的规则在本轮只触发一条。<strong>优先级决定同组内的胜出顺序</strong>——数字小的先检查，先满足条件的先触发。</p>

        <h4>粘性规则和普通规则有什么区别？</h4>
        <p>粘性规则首次触发后，在后续所有对话中都会自动注入，直到 <code>/reset</code>。</p>

        <h4>规则链会无限循环吗？</h4>
        <p>不会。注入器核心会防止循环触发。规则链只影响后续规则的"激活状态"，同一轮内不会重复执行同一条规则。</p>

        <h4>宏模板怎么使用？</h4>
        <p>编辑规则的"注入内容"区域下方有一排宏模板标签。点击任意标签，对应占位符会插入到光标位置。</p>

        <h4>语义触发需要什么前置条件？</h4>
        <p>配置语义模型（设置 → 长期记忆）→ 启用世界书语义触发（设置 → 世界书语义触发）→ 等待向量生成完成。</p>

        <h4>语义查询写多少字合适？</h4>
        <p>推荐 1-2 句话。太短会退化为关键词匹配；太长会让语义向量过于稀释。</p>

        <h4>为什么语义规则有时触发有时不触发？</h4>
        <ul>
          <li>用户消息的表述与语义查询差异较大，分数在阈值附近波动。</li>
          <li>全局世界书阈值或规则阈值设置不合适。</li>
          <li>如果添加了"高级额外约束"，条件可能不满足。</li>
          <li>如果设置了概率，会引入随机性。</li>
        </ul>
        <p>用 <code>/inspect</code> 查看具体分数，针对性调整。</p>

        <h4>世界书规则会在主动消息和语音通话中生效吗？</h4>
        <p>会。世界书规则在单聊、群聊、主动消息、语音通话中都会生效。</p>

        <h4>如何查看当前生效的所有规则？</h4>
        <p>使用 <code>/inspect</code> 命令，输出基础规则、世界书规则、语义规则、上一轮语义轨迹。</p>

        <h4>规则数量多了会影响性能吗？</h4>
        <p>100 条以内影响可忽略。超过 500 条时建议：及时禁用不需要的规则、用规则组批量管理、控制语义规则数量。</p>

        <h4>导入世界书后语义规则不触发怎么办？<span class="new-badge">v3.2</span></h4>
        <p>从其他设备或备份导入的语义规则，其 <code>vector</code> 字段可能基于不同的语义模型生成，导入后会被自动清空。解决方式：</p>
        <ol>
          <li>确认当前设备的语义模型已配置（设置 → 长期记忆）。</li>
          <li>在世界书主界面点击"🧠 同步向量"。</li>
          <li>同步完成后，规则卡片上会显示"向量已生成"。</li>
        </ol>
      </div>

      <div style="text-align:right;font-size:0.8rem;color:var(--color-text-muted);border-top:1px solid var(--color-border);padding-top:0.5rem;margin-top:1rem;">
        世界书 v2.0 · 教程版本 3.2 · 更新于 2026-09-16
      </div>
    </div>
  `;
}