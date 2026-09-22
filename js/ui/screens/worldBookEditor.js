// js/ui/screens/worldBookEditor.js
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  getDefaultRule, addRule, updateRule,
  getAllGroups as getAllRuleGroups,
  getAllRules,
  serializeCondition, deserializeCondition,
} from '../../modules/worldBook.js';
import { getGroupsByUser } from '../../modules/groupChat.js';
import { getAppState } from '../../core/state.js';
import {
  createConditionEditor, getConditionData,
  renderRuleSelector, bindRuleSelector,
  renderGroupSelector, bindGroupSelector,
} from './worldBookComponents.js';
import { acquireEditLock, releaseEditLock } from './worldBookEditLock.js';

/**
 * 本地 HTML 转义（模块内复用）
 * 与 core/utils.js 的 escapeHtml 行为一致，避免额外 import。
 */
function escapeHtmlForDisplay(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

const MACRO_GROUPS = [
  {
    name: '👤 角色',
    items: [
      { name: '角色名', value: '{{character.name}}', desc: '当前角色的名称' },
      { name: '角色描述', value: '{{character.description}}', desc: '角色的简介' },
      { name: '角色性格', value: '{{character.personality}}', desc: '角色的性格描述' },
      { name: '角色关系', value: '{{character.relationship}}', desc: '角色与用户的关系' },
      { name: '角色称呼', value: '{{character.callUser}}', desc: '角色对用户的称呼' },
    ]
  },
  {
    name: '👤 用户',
    items: [
      { name: '用户名', value: '{{user.name}}', desc: '当前用户名' },
      { name: '用户消息', value: '{{user.message}}', desc: '当前用户发送的消息' },
    ]
  },
  {
    name: '⏰ 游戏时间',
    items: [
      { name: '完整时间', value: '{{gameTime.full}}', desc: '完整的游戏时间' },
      { name: '自然时间', value: '{{gameTime.natural}}', desc: '自然语言时间' },
      { name: '时段', value: '{{gameTime.period}}', desc: '时段（清晨/上午/下午等）' },
      { name: '小时', value: '{{gameTime.hour}}', desc: '小时（24小时制）' },
      { name: '分钟', value: '{{gameTime.minute}}', desc: '分钟' },
      { name: '描述', value: '{{gameTime.description}}', desc: '时段的详细描述' },
    ]
  },
  {
    name: '👥 群组',
    items: [
      { name: '群组名称', value: '{{group.name}}', desc: '当前群组名称' },
      { name: '群组描述', value: '{{group.description}}', desc: '当前群组描述' },
      { name: '成员数', value: '{{group.memberCount}}', desc: '群组成员数量' },
      { name: '成员列表', value: '{{group.members}}', desc: '群组成员名称列表' },
      { name: '活跃度', value: '{{group.activeLevel}}', desc: '群组活跃度等级' },
      { name: '群组规则', value: '{{group.rules}}', desc: '群组设置的规则' },
    ]
  },
];

const RULE_TYPES = {
  conditional: { label: '条件触发', desc: '根据条件表达式判断是否注入（关键词、数值、时间等）' },
  constant: { label: '常驻注入', desc: '每轮对话都注入，不判断条件' },
  semantic: { label: '语义触发', desc: '用自然语言描述场景，系统自动匹配用户消息的语义' },
  sticky: { label: '粘性', desc: '首次满足条件后，在后续所有对话中持续注入' },
};

/**
 * 检查语义引擎是否真的就绪
 * settings 由调用方传入，避免函数内部再调 getAppState()。
 */
async function checkSemanticStatus(settings) {
  const hasModel = !!(settings?.semanticModelId);

  if (!hasModel) {
    return { hasModel: false, engineReady: false, status: 'not-configured' };
  }

  try {
    const { isMemoryVectorReady } = await import('../../modules/memory.js');
    const ready = isMemoryVectorReady();
    return {
      hasModel: true,
      engineReady: ready,
      status: ready ? 'ready' : 'not-loaded',
    };
  } catch (e) {
    console.warn('[WorldBookEditor] 检查语义引擎状态失败:', e);
    return { hasModel: true, engineReady: false, status: 'error' };
  }
}

/**
 * 根据语义状态生成顶部警示 HTML
 */
function renderSemanticStatusBadge(semanticStatus) {
  if (semanticStatus.engineReady) return '';

  const msg = semanticStatus.status === 'not-configured'
    ? '⚠️ 语义引擎未配置'
    : '⚠️ 语义引擎未就绪';

  const detail = semanticStatus.status === 'not-configured'
    ? '请在设置 → 长期记忆中配置语义模型'
    : (semanticStatus.status === 'error'
        ? '语义引擎加载失败，请检查控制台日志'
        : '已配置模型但尚未加载，请到设置 → 长期记忆下载模型');

  return `
    <span style="margin-left:auto;font-size:0.7rem;color:var(--color-danger);padding:0.1rem 0.4rem;background:rgba(225,112,85,0.1);border-radius:var(--radius-sm);"
          title="${escapeHtmlForDisplay(detail)}">
      ${msg}
    </span>
  `;
}

/**
 * 根据语义状态生成面板内的详细提示
 */
function renderSemanticStatusHint(semanticStatus, settings) {
  if (semanticStatus.engineReady) return '';

  if (semanticStatus.status === 'not-configured') {
    return `
      <div style="font-size:0.78rem;color:var(--color-warning);padding:0.4rem 0.6rem;background:rgba(253,203,110,0.1);border-left:3px solid var(--color-warning);border-radius:4px;margin-bottom:0.6rem;">
        ⚠️ 当前未配置语义模型（设置 → 长期记忆）。保存后规则不会触发。
      </div>
    `;
  }

  if (semanticStatus.status === 'not-loaded') {
    return `
      <div style="font-size:0.78rem;color:var(--color-warning);padding:0.4rem 0.6rem;background:rgba(253,203,110,0.1);border-left:3px solid var(--color-warning);border-radius:4px;margin-bottom:0.6rem;">
        ⚠️ 已配置模型「${escapeHtmlForDisplay(settings?.semanticModelId || '')}」但尚未加载。<br>
        请到 <strong>设置 → 长期记忆</strong> 点击"下载模型"，然后刷新页面。保存后规则不会触发。
      </div>
    `;
  }

  return `
    <div style="font-size:0.78rem;color:var(--color-danger);padding:0.4rem 0.6rem;background:rgba(225,112,85,0.1);border-left:3px solid var(--color-danger);border-radius:4px;margin-bottom:0.6rem;">
      ❌ 语义引擎加载失败。请检查浏览器控制台日志，或到设置 → 长期记忆重新配置模型。
    </div>
  `;
}

export async function openRuleEditor(ruleData = null) {
  const isEdit = !!ruleData;
  const data = ruleData || getDefaultRule();
  const state = getAppState();

  const settings = state.get('settings') || {};

  const characters = state.get('characters') || [];
  const chatGroups = await getGroupsByUser('user');
  const allRuleGroups = await getAllRuleGroups();
  const allRules = await getAllRules();

  const semanticStatus = await checkSemanticStatus(settings);

  let scopeType = 'global';
  let selectedCharacterId = '';
  let selectedGroupId = '';
  if (data.scope.startsWith('character:')) {
    scopeType = 'character';
    selectedCharacterId = data.scope.split(':')[1] || '';
  } else if (data.scope.startsWith('group:')) {
    scopeType = 'group';
    selectedGroupId = data.scope.split(':')[1] || '';
  }

  const currentType = RULE_TYPES[data.type] ? data.type : 'conditional';

  const userCondition = currentType === 'semantic'
    ? (data._userCondition ?? null)
    : data.condition;
  const uiCondition = deserializeCondition(userCondition);

  const macroGroupsHtml = MACRO_GROUPS.map(group => `
    <details style="margin-bottom:0.2rem;">
      <summary style="cursor:pointer;font-size:0.8rem;color:var(--color-text-secondary);padding:0.1rem 0.2rem;user-select:none;">
        ${escapeHtmlForDisplay(group.name)} (${group.items.length})
      </summary>
      <div style="display:flex;flex-wrap:wrap;gap:0.2rem;padding:0.2rem 0 0.4rem 0.8rem;">
        ${group.items.map(item => `
          <span class="wb-macro-tag" data-value="${escapeHtmlForDisplay(item.value)}" title="${escapeHtmlForDisplay(item.desc)}" style="display:inline-block;padding:0.05rem 0.5rem;border-radius:var(--radius-full);font-size:0.7rem;background:var(--color-bg-secondary);border:1px solid var(--color-border-light);cursor:pointer;transition:all 0.15s;white-space:nowrap;">
            ${escapeHtmlForDisplay(item.name)}
          </span>
        `).join('')}
      </div>
    </details>
  `).join('');

  const ruleTypeOptionsHtml = Object.entries(RULE_TYPES).map(([type, meta]) => `
    <option value="${type}" ${currentType === type ? 'selected' : ''}>${meta.label}</option>
  `).join('');

  const statusBadgeHtml = renderSemanticStatusBadge(semanticStatus);
  const statusHintHtml = renderSemanticStatusHint(semanticStatus, settings);

  const semanticBlockHtml = `
    <div id="wb-semantic-block" class="wb-semantic-block" style="
      ${currentType === 'semantic' ? '' : 'display:none;'}
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 0.8rem 1rem;
      background: var(--color-bg-secondary);
      margin-bottom: 0.8rem;
    ">
      <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.6rem;">
        <span style="font-size:1.2rem;">🧠</span>
        <strong style="font-size:0.95rem;">语义触发</strong>
        ${statusBadgeHtml}
      </div>

      ${statusHintHtml}

      <div class="form-group" style="margin-bottom:0.6rem;">
        <label style="font-size:0.85rem;">描述触发场景（用自然语言，无需关键词）</label>
        <textarea id="wb-semantic-query" rows="2"
          placeholder="例如：用户表达孤独、难过或需要安慰"
          style="width:100%;font-size:0.9rem;">${escapeHtmlForDisplay(data.semanticQuery || '')}</textarea>
      </div>

      <div style="margin-bottom:0.6rem;">
        <button class="btn btn-sm" id="wb-semantic-test-toggle" type="button" style="font-size:0.78rem;">
          🧪 测试匹配
        </button>
        <span style="font-size:0.72rem;color:var(--color-text-muted);margin-left:0.4rem;">
          输入一段文本，查看匹配分数
        </span>
      </div>
      <div id="wb-semantic-test-panel" style="display:none;margin-bottom:0.6rem;padding:0.6rem;background:var(--color-bg-primary);border:1px solid var(--color-border-light);border-radius:var(--radius-sm);">
        <div class="form-group" style="margin-bottom:0.4rem;">
          <input type="text" id="wb-semantic-test-input" placeholder="输入测试文本，如：我今天有点难过"
            style="width:100%;font-size:0.85rem;" />
        </div>
        <div style="display:flex;gap:0.4rem;align-items:center;">
          <button class="btn btn-sm btn-primary" id="wb-semantic-test-run" type="button" style="font-size:0.78rem;">
            运行测试
          </button>
          <span style="font-size:0.72rem;color:var(--color-text-muted);">需要语义引擎已就绪</span>
        </div>
        <div id="wb-semantic-test-result" style="margin-top:0.5rem;font-size:0.8rem;"></div>
      </div>

      <details style="margin-bottom:0.6rem;">
        <summary style="cursor:pointer;font-size:0.78rem;color:var(--color-text-muted);user-select:none;">
          💡 如何写好语义查询
        </summary>
        <div style="padding:0.5rem 0.8rem;font-size:0.78rem;line-height:1.7;color:var(--color-text-secondary);">
          <div style="margin-bottom:0.3rem;"><strong style="color:var(--color-success);">✅ 推荐写法</strong></div>
          <ul style="margin:0 0 0.5rem 1.2rem;padding:0;">
            <li>用户表达了孤独、悲伤或需要陪伴的情绪</li>
            <li>用户提到了童年的回忆</li>
            <li>用户在深夜向角色倾诉</li>
          </ul>
          <div style="margin-bottom:0.3rem;"><strong style="color:var(--color-danger);">❌ 避免的写法</strong></div>
          <ul style="margin:0 0 0.5rem 1.2rem;padding:0;">
            <li>孤独、寂寞、难过、伤心、抑郁 <span style="color:var(--color-text-muted);">← 关键词堆砌</span></li>
            <li>用户说"我很孤独" <span style="color:var(--color-text-muted);">← 太具体，匹配不到变体</span></li>
            <li>询问过去 <span style="color:var(--color-text-muted);">← 太模糊，会误触发</span></li>
          </ul>
          <div style="font-size:0.72rem;color:var(--color-text-muted);">
            核心思路：用一句话描述"什么场景应该触发"，让系统理解意图。
          </div>
        </div>
      </details>

      <div class="form-group" style="margin-bottom:0;">
        <label style="font-size:0.85rem;">语义阈值（0-1）</label>
        <input type="number" id="wb-semantic-threshold" step="0.05" min="0" max="1"
          value="${data.semanticThreshold ?? ''}"
          placeholder="留空使用全局默认"
          style="width:100%;font-size:0.85rem;" />
        <span style="font-size:0.7rem;color:var(--color-text-muted);display:block;margin-top:0.15rem;">
          越接近 1 越严格。留空使用设置面板中的全局默认（推荐 0.55）
        </span>
      </div>
    </div>
  `;

  const conditionalBlockHtml = `
    <div id="wb-conditional-block" style="${currentType === 'constant' ? 'display:none;' : ''}">
      <div id="wb-semantic-extra-wrapper" style="
        ${currentType === 'semantic' ? '' : 'display:none;'}
        margin-bottom:0.8rem;
      ">
        <details>
          <summary style="cursor:pointer;font-size:0.8rem;color:var(--color-text-muted);user-select:none;padding:0.3rem 0;">
            ▸ 高级：添加额外约束条件（可选）
          </summary>
          <div style="padding:0.5rem 0 0 0.8rem;">
            <div style="font-size:0.72rem;color:var(--color-text-muted);margin-bottom:0.4rem;">
              语义匹配命中后，以下条件也满足才会注入。平时不需要填。
            </div>
            <div id="wb-condition-container" class="wb-condition-editor"></div>
          </div>
        </details>
      </div>

      <div id="wb-standard-condition-wrapper" style="${currentType === 'semantic' || currentType === 'constant' ? 'display:none;' : ''}">
        <div class="form-group">
          <label>
            触发条件 <span style="color:var(--color-danger);">*</span>
          </label>
          <div id="wb-condition-container-standard" class="wb-condition-editor"></div>
          <span class="help-text">支持 AND / OR / NOT 嵌套组合，构建复杂触发逻辑</span>
        </div>
      </div>
    </div>
  `;

  const html = `
    <button class="modal-close">&times;</button>
    <div class="worldbook-editor">
      <h3>${isEdit ? '📝 编辑规则' : '📝 创建规则'}</h3>

      ${isEdit ? `
        <div class="form-group">
          <label>规则ID</label>
          <div style="display:flex;gap:0.5rem;align-items:center;">
            <input type="text" value="${escapeHtmlForDisplay(data.id)}" readonly style="flex:1;background:var(--color-bg-secondary);cursor:default;font-family:monospace;font-size:0.8rem;" />
            <button class="btn btn-sm" id="wb-copy-id-btn"><i class="fas fa-copy"></i> 复制</button>
          </div>
        </div>
      ` : ''}

      <div class="form-group">
        <label>名称 <span style="color:var(--color-danger);">*</span></label>
        <input type="text" id="wb-name" value="${escapeHtmlForDisplay(data.name)}" placeholder="请输入规则名称" />
      </div>

      <div class="form-group">
        <label>描述</label>
        <textarea id="wb-desc" placeholder="可选，描述规则用途">${escapeHtmlForDisplay(data.description || '')}</textarea>
      </div>

      <div class="form-group">
        <label>作用域 <span style="color:var(--color-danger);">*</span></label>
        <select id="wb-scope">
          <option value="global" ${scopeType === 'global' ? 'selected' : ''}>全局</option>
          <option value="character" ${scopeType === 'character' ? 'selected' : ''}>角色</option>
          <option value="group" ${scopeType === 'group' ? 'selected' : ''}>群组</option>
        </select>
      </div>

      <div class="form-group" id="wb-character-select-group" style="${scopeType === 'character' ? '' : 'display:none;'}">
        <label>选择角色 <span style="color:var(--color-danger);">*</span></label>
        <select id="wb-character-select">
          <option value="">请选择角色</option>
          ${characters.map(c => `<option value="${escapeHtmlForDisplay(c.id)}" ${c.id === selectedCharacterId ? 'selected' : ''}>${escapeHtmlForDisplay(c.name)}</option>`).join('')}
        </select>
      </div>

      <div class="form-group" id="wb-group-select-group" style="${scopeType === 'group' ? '' : 'display:none;'}">
        <label>选择群组 <span style="color:var(--color-danger);">*</span></label>
        <select id="wb-group-select">
          <option value="">请选择群组</option>
          ${chatGroups.map(g => `<option value="${escapeHtmlForDisplay(g.id)}" ${g.id === selectedGroupId ? 'selected' : ''}>${escapeHtmlForDisplay(g.name)}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label>所属规则组</label>
        <select id="wb-group-id">
          <option value="">无（独立规则）</option>
          ${allRuleGroups.map(g => `
            <option value="${escapeHtmlForDisplay(g.id)}" ${g.id === data.groupId ? 'selected' : ''}>
              ${escapeHtmlForDisplay(g.name)} (${g.ruleIds?.length || 0}条规则)
            </option>
          `).join('')}
        </select>
        <span class="help-text">将规则放入组中，便于统一管理和启用/禁用</span>
      </div>

      <div class="form-group">
        <label>规则类型 <span style="color:var(--color-danger);">*</span></label>
        <select id="wb-type">
          ${ruleTypeOptionsHtml}
        </select>
        <span class="help-text" id="wb-type-help">${RULE_TYPES[currentType].desc}</span>
      </div>

      ${semanticBlockHtml}
      ${conditionalBlockHtml}

      <div class="form-group">
        <label>注入内容 <span style="color:var(--color-danger);">*</span></label>
        <div style="margin-bottom:0.3rem;border:1px solid var(--color-border-light);border-radius:var(--radius-md);padding:0.2rem 0.5rem;background:var(--color-bg-secondary);">
          <span class="help-text" style="display:block;font-size:0.75rem;color:var(--color-text-muted);">📌 点击下方宏模板快速插入到光标位置：</span>
          <div id="wb-macro-tags" style="margin-top:0.2rem;">
            ${macroGroupsHtml}
          </div>
        </div>
        <textarea id="wb-content" rows="4" placeholder="触发时注入的文本，支持宏模板">${escapeHtmlForDisplay(data.content || '')}</textarea>
        <span class="help-text">点击宏模板名称自动插入到当前光标位置</span>
      </div>

      <div class="form-group">
        <label>位置 <span style="color:var(--color-danger);">*</span></label>
        <select id="wb-position">
          <option value="before" ${data.position === 'before' ? 'selected' : ''}>前置（消息前）</option>
          <option value="after" ${data.position === 'after' ? 'selected' : ''}>后置（消息后）</option>
        </select>
      </div>

      <details>
        <summary>⚙️ 高级设置</summary>
        <div class="form-group">
          <label>优先级</label>
          <input type="number" id="wb-priority" value="${data.priority}" min="0" max="999" />
        </div>
        <div class="form-group">
          <label>概率 (0-1)</label>
          <input type="number" id="wb-probability" step="0.05" min="0" max="1" value="${data.probability}" />
        </div>
        <div class="form-group">
          <label>粘性配置</label>
          <input type="text" id="wb-sticky-config" value="${escapeHtmlForDisplay(data.sticky || '')}" placeholder="粘性唯一标识" />
        </div>
        <div class="form-group">
          <label>互斥组</label>
          <div id="wb-exclusive-group-container">
            ${renderGroupSelector(allRuleGroups, data.exclusiveGroup || null, '选择互斥组...')}
          </div>
        </div>
        <div class="form-group">
          <label>激活规则（触发后激活）</label>
          <div id="wb-activate-rules-container">
            ${renderRuleSelector(allRules, data.onTrigger?.activateRules || [])}
          </div>
        </div>
        <div class="form-group">
          <label>停用规则（触发后停用）</label>
          <div id="wb-deactivate-rules-container">
            ${renderRuleSelector(allRules, data.onTrigger?.deactivateRules || [])}
          </div>
        </div>
      </details>

      <div class="worldbook-editor-actions">
        <button class="btn btn-secondary" id="wb-editor-cancel">取消</button>
        <button class="btn btn-primary" id="wb-editor-save">保存</button>
      </div>
    </div>
  `;

  const _selectorCleanups = [];

  acquireEditLock();
  openModal(html, () => {
    releaseEditLock();
    for (const fn of _selectorCleanups) {
      try { fn(); } catch (_) {}
    }
    _selectorCleanups.length = 0;
  });

  const initMacroTags = () => {
    const modalContent = document.getElementById('modalContent');
    if (!modalContent) return;
    const tagsContainer = modalContent.querySelector('#wb-macro-tags');
    const contentTextarea = modalContent.querySelector('#wb-content');
    if (!tagsContainer || !contentTextarea) return;
    if (tagsContainer.dataset.inited === 'true') return;
    tagsContainer.dataset.inited = 'true';

    tagsContainer.querySelectorAll('.wb-macro-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const value = tag.dataset.value;
        const start = contentTextarea.selectionStart;
        const end = contentTextarea.selectionEnd;
        const text = contentTextarea.value;
        contentTextarea.value = text.substring(0, start) + value + text.substring(end);
        const newCursorPos = start + value.length;
        contentTextarea.selectionStart = contentTextarea.selectionEnd = newCursorPos;
        contentTextarea.focus();
        contentTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  };

  requestAnimationFrame(initMacroTags);

  document.getElementById('wb-copy-id-btn')?.addEventListener('click', async () => {
    const idInput = document.querySelector('#modalContent input[readonly]');
    if (idInput) {
      await navigator.clipboard.writeText(idInput.value);
      showToast('已复制ID', 'success');
    }
  });

  const scopeSelect = document.getElementById('wb-scope');
  const charGroup = document.getElementById('wb-character-select-group');
  const groupGroup = document.getElementById('wb-group-select-group');
  scopeSelect.addEventListener('change', () => {
    const val = scopeSelect.value;
    charGroup.style.display = val === 'character' ? 'block' : 'none';
    groupGroup.style.display = val === 'group' ? 'block' : 'none';
  });

  const typeSelect = document.getElementById('wb-type');
  const typeHelp = document.getElementById('wb-type-help');
  const semanticBlock = document.getElementById('wb-semantic-block');
  const conditionalBlock = document.getElementById('wb-conditional-block');
  const semanticExtraWrapper = document.getElementById('wb-semantic-extra-wrapper');
  const standardConditionWrapper = document.getElementById('wb-standard-condition-wrapper');

  typeSelect.addEventListener('change', () => {
    const newType = typeSelect.value;
    typeHelp.textContent = RULE_TYPES[newType]?.desc || '';
    semanticBlock.style.display = newType === 'semantic' ? '' : 'none';

    if (newType === 'constant') {
      conditionalBlock.style.display = 'none';
    } else {
      conditionalBlock.style.display = '';
      if (newType === 'semantic') {
        semanticExtraWrapper.style.display = '';
        standardConditionWrapper.style.display = 'none';
      } else {
        semanticExtraWrapper.style.display = 'none';
        standardConditionWrapper.style.display = '';
      }
    }
  });

  let currentCondition = uiCondition;

  const semanticConditionContainer = document.getElementById('wb-condition-container');
  if (semanticConditionContainer) {
    createConditionEditor(semanticConditionContainer, currentCondition, (newCondition) => {
      currentCondition = newCondition;
    });
  }

  const standardConditionContainer = document.getElementById('wb-condition-container-standard');
  if (standardConditionContainer) {
    createConditionEditor(standardConditionContainer, currentCondition, (newCondition) => {
      currentCondition = newCondition;
    });
  }

  const testToggle = document.getElementById('wb-semantic-test-toggle');
  const testPanel = document.getElementById('wb-semantic-test-panel');
  const testInput = document.getElementById('wb-semantic-test-input');
  const testRunBtn = document.getElementById('wb-semantic-test-run');
  const testResult = document.getElementById('wb-semantic-test-result');
  const semanticQueryEl = document.getElementById('wb-semantic-query');
  const semanticThresholdEl = document.getElementById('wb-semantic-threshold');

  if (testToggle && testPanel) {
    testToggle.addEventListener('click', () => {
      const isVisible = testPanel.style.display !== 'none';
      testPanel.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) testInput.focus();
    });
  }

  if (testRunBtn) {
    testRunBtn.addEventListener('click', async () => {
      const testText = (testInput.value || '').trim();
      if (!testText) {
        testResult.innerHTML = '<span style="color:var(--color-danger);">请输入测试文本</span>';
        return;
      }

      const query = (semanticQueryEl.value || '').trim();
      if (!query) {
        testResult.innerHTML = '<span style="color:var(--color-danger);">请先填写"描述触发场景"</span>';
        return;
      }

      const { isMemoryVectorReady } = await import('../../modules/memory.js');
      if (!isMemoryVectorReady()) {
        testResult.innerHTML = '<span style="color:var(--color-warning);">⚠️ 语义引擎未就绪，无法测试</span>';
        return;
      }

      testRunBtn.disabled = true;
      testResult.innerHTML = '<span style="color:var(--color-text-muted);">测试中...</span>';

      try {
        const { getMemoryEmbedder } = await import('../../modules/memory.js');
        const embedder = getMemoryEmbedder();
        if (!embedder) {
          testResult.innerHTML = '<span style="color:var(--color-danger);">无法获取语义引擎</span>';
          return;
        }

        const queryVec = await embedder(query, { pooling: 'mean', normalize: true });
        const testVec = await embedder(testText, { pooling: 'mean', normalize: true });

        const a = queryVec.data;
        const b = testVec.data;
        let dot = 0, na = 0, nb = 0;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
          dot += a[i] * b[i];
          na += a[i] * a[i];
          nb += b[i] * b[i];
        }
        const sim = (na === 0 || nb === 0) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));

        const inputThreshold = parseFloat(semanticThresholdEl?.value);
        const globalThreshold = settings.worldBookSemantic?.threshold ?? 0.55;
        const threshold = (!isNaN(inputThreshold) && inputThreshold >= 0 && inputThreshold <= 1)
          ? inputThreshold
          : globalThreshold;

        const willTrigger = sim >= threshold;
        const color = willTrigger ? 'var(--color-success)' : 'var(--color-danger)';
        const icon = willTrigger ? '✅' : '❌';
        const label = willTrigger ? '会触发' : '不会触发';

        testResult.innerHTML = `
          <div style="padding:0.4rem 0.6rem;background:var(--color-bg-secondary);border-radius:var(--radius-sm);">
            <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.2rem;">
              语义查询："${escapeHtmlForDisplay(query)}"
            </div>
            <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.4rem;">
              测试文本："${escapeHtmlForDisplay(testText)}"
            </div>
            <div style="font-size:0.95rem;font-weight:600;color:${color};">
              ${icon} 匹配分数：${sim.toFixed(4)} &nbsp;(${label})
            </div>
            <div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.2rem;">
              当前阈值：${threshold.toFixed(2)}
            </div>
          </div>
        `;
      } catch (err) {
        console.error('[SemanticTest] 测试失败:', err);
        testResult.innerHTML = `<span style="color:var(--color-danger);">测试失败: ${escapeHtmlForDisplay(err.message)}</span>`;
      } finally {
        testRunBtn.disabled = false;
      }
    });
  }

  const exclusiveContainer = document.getElementById('wb-exclusive-group-container');
  const exclusiveSelect = exclusiveContainer.querySelector('.wb-selector-select');
  if (exclusiveSelect) {
    exclusiveSelect.addEventListener('change', () => {
      exclusiveSelect.dataset.selectedId = exclusiveSelect.value || '';
    });
  }

  const activateContainer = document.getElementById('wb-activate-rules-container');
  const activateRulesEl = activateContainer.querySelector('.wb-rule-selector');
  if (activateRulesEl) {
    activateRulesEl._selectedIds = [...(data.onTrigger?.activateRules || [])];
    _selectorCleanups.push(
      bindRuleSelector(activateContainer, (ids) => { activateRulesEl._selectedIds = ids; })
    );
  }

  const deactivateContainer = document.getElementById('wb-deactivate-rules-container');
  const deactivateRulesEl = deactivateContainer.querySelector('.wb-rule-selector');
  if (deactivateRulesEl) {
    deactivateRulesEl._selectedIds = [...(data.onTrigger?.deactivateRules || [])];
    _selectorCleanups.push(
      bindRuleSelector(deactivateContainer, (ids) => { deactivateRulesEl._selectedIds = ids; })
    );
  }

  document.getElementById('wb-editor-save').addEventListener('click', async () => {
    const name = document.getElementById('wb-name').value.trim();
    if (!name) { showToast('请输入规则名称', 'warning'); return; }

    const ruleType = typeSelect.value;

    const scope = scopeSelect.value;
    let finalScope = scope;
    if (scope === 'character') {
      const charId = document.getElementById('wb-character-select').value;
      if (!charId) { showToast('请选择角色', 'warning'); return; }
      finalScope = `character:${charId}`;
    } else if (scope === 'group') {
      const groupId = document.getElementById('wb-group-select').value;
      if (!groupId) { showToast('请选择群组', 'warning'); return; }
      finalScope = `group:${groupId}`;
    }

    let activeConditionContainer = null;
    if (ruleType === 'semantic') {
      activeConditionContainer = semanticConditionContainer;
    } else if (ruleType !== 'constant') {
      activeConditionContainer = standardConditionContainer;
    }

    let serializedCondition = { path: 'user.message', op: 'contains', value: '' };
    if (activeConditionContainer) {
      const conditionData = getConditionData(activeConditionContainer);
      serializedCondition = serializeCondition(conditionData);
    }

    let semanticQuery = '';
    let semanticThreshold = null;
    if (ruleType === 'semantic') {
      semanticQuery = (document.getElementById('wb-semantic-query')?.value || '').trim();
      if (!semanticQuery) {
        showToast('语义触发需要填写"描述触发场景"', 'warning');
        return;
      }
      const thresholdInput = document.getElementById('wb-semantic-threshold')?.value.trim();
      if (thresholdInput) {
        const num = parseFloat(thresholdInput);
        if (isNaN(num) || num < 0 || num > 1) {
          showToast('语义阈值必须在 0 到 1 之间', 'warning');
          return;
        }
        semanticThreshold = num;
      }
    }

    const groupId = document.getElementById('wb-group-id').value || null;
    const exclusiveSelectEl = exclusiveContainer.querySelector('.wb-selector-select');
    const exclusiveGroup = exclusiveSelectEl ? (exclusiveSelectEl.value || null) : null;
    const activateIds = activateRulesEl?._selectedIds || [];
    const deactivateIds = deactivateRulesEl?._selectedIds || [];

    const ruleData = {
      name,
      description: document.getElementById('wb-desc').value.trim(),
      scope: finalScope,
      groupId,
      type: ruleType,
      condition: serializedCondition,
      semanticQuery,
      semanticThreshold,
      content: document.getElementById('wb-content').value,
      position: document.getElementById('wb-position').value,
      priority: parseInt(document.getElementById('wb-priority').value) || 50,
      probability: parseFloat(document.getElementById('wb-probability').value) || 1.0,
      sticky: document.getElementById('wb-sticky-config').value.trim() || null,
      exclusiveGroup,
      onTrigger: { activateRules: activateIds, deactivateRules: deactivateIds },
      enabled: true,
    };

    try {
      if (isEdit) {
        await updateRule(data.id, ruleData);
        showToast('规则已更新', 'success');
      } else {
        await addRule(ruleData);
        showToast('规则已创建', 'success');
      }
      closeModal();
      import('./worldBookUI.js')
        .then(m => m.renderWorldBookList())
        .catch(err => console.warn('[WorldBookEditor] 重开列表失败:', err));
    } catch (err) {
      showToast('保存失败: ' + err.message, 'error');
      console.error('[WorldBookEditor] 保存失败:', err);
    }
  });

  document.getElementById('wb-editor-cancel').addEventListener('click', closeModal);
}