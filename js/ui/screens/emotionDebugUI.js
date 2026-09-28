/**
 * @module ui/screens/emotionDebugUI
 * @description 情绪识别调试面板
 *
 * 识别逻辑高度依赖调参：否定窗口多长、子句权重怎么给、弱词门槛设在哪，
 * 这些都无法凭直觉判断。本面板把一次识别的完整链路摊开：
 *   子句切分 → 每处命中的否定/施事/受体判定 → 三层各自得分 → 最终结论。
 *
 * 支持临时覆盖语义层与 LLM 仲裁开关做对照实验，不写入设置。
 */

import { openModal, closeModal } from '../components/modal.js';
import { escapeHtml } from '../../core/utils.js';
import { classifyUserMessage } from '../../modules/emotionEngine.js';
import { EVENT_TYPES } from '../../modules/emotionLexicon.js';

const SAMPLE_TEXTS = [
  '我不喜欢你',
  '他喜欢你',
  '不爱你',
  '我喜欢你',
  '我喜欢他',
  '你很笨',
  '特别喜欢你',
  '我没有不喜欢你',
  '我喜欢你，但是我不爱你了',
  '谢谢你，不过你真的好烦',
];

/** 面板状态在会话内保留，便于反复试跑对照 */
let lastInput = '';
let lastResult = null;

/**
 * 类别显示名。
 * @param {string} type
 * @returns {string}
 */
function labelOf(type) {
  if (!type) return '—';
  if (type === 'neutral') return '中性';
  return EVENT_TYPES[type]?.label ? `${type}（${EVENT_TYPES[type].label}）` : type;
}

/**
 * 数值格式化，避免面板里出现超长小数。
 * @param {number} value
 * @param {number} [digits]
 * @returns {string}
 */
function num(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

/**
 * 渲染命中项的一行。
 * @param {Object} hit
 * @returns {string}
 */
function renderHit(hit) {
  const flags = [];
  if (hit.negated) flags.push(`<span style="color:var(--color-danger);">否定</span>`);
  if (hit.agent === 'third' || hit.target === 'third') {
    flags.push(`<span style="color:var(--color-warning);">第三方</span>`);
  }
  const changed = hit.type !== hit.resolvedType;

  return `
    <div style="padding:0.35rem 0.5rem;border-left:2px solid ${changed ? 'var(--color-warning)' : 'var(--color-border)'};margin-bottom:0.3rem;background:var(--color-bg-secondary);border-radius:0 4px 4px 0;">
      <code>${escapeHtml(hit.word)}</code>
      <span style="color:var(--color-text-muted);font-size:0.78rem;">
        ${escapeHtml(hit.type)}${changed ? ` → <b>${escapeHtml(hit.resolvedType)}</b>` : ''}
        · 权重 ${hit.weight}
        · 施事 ${escapeHtml(hit.agent)}
        · 受体 ${escapeHtml(hit.target)}
      </span>
      ${flags.length ? `<div style="font-size:0.75rem;margin-top:0.15rem;">${flags.join(' ')}</div>` : ''}
      <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml(hit.reason || '')}</div>
    </div>
  `;
}

/**
 * 渲染得分表。
 * @param {string} title
 * @param {Object} scores
 * @returns {string}
 */
function renderScores(title, scores) {
  const entries = Object.entries(scores || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (entries.length === 0) {
    return `<div style="margin-bottom:0.6rem;"><b style="font-size:0.82rem;">${escapeHtml(title)}</b>
      <div style="font-size:0.78rem;color:var(--color-text-muted);">（无）</div></div>`;
  }
  const rows = entries.map(([type, value]) =>
    `<div style="font-size:0.78rem;display:flex;justify-content:space-between;">
      <span>${escapeHtml(labelOf(type))}</span><span>${num(value)}</span>
    </div>`).join('');
  return `<div style="margin-bottom:0.6rem;"><b style="font-size:0.82rem;">${escapeHtml(title)}</b>${rows}</div>`;
}

/**
 * 渲染完整结果。
 * @param {Object} r classifyUserMessage 的返回值
 * @returns {string}
 */
function renderResult(r) {
  if (!r) return '';

  const semStatus = r.trace?.semanticStatus;
  const semanticActive = Array.isArray(r.trace?.semantic) && r.trace.semantic.length > 0;

  const clausesHtml = (r.clauses || []).map((c, i) => `
    <div style="margin-bottom:0.5rem;">
      <div style="font-size:0.82rem;">
        <b>${i + 1}.</b> 「${escapeHtml(c.text)}」
        <span style="color:var(--color-text-muted);">权重 ${num(c.weight, 2)}</span>
      </div>
      ${c.hits.length ? c.hits.map(renderHit).join('') : '<div style="font-size:0.78rem;color:var(--color-text-muted);padding-left:0.5rem;">无命中</div>'}
    </div>
  `).join('');

  const semanticScores = {};
  for (const item of r.trace?.semantic || []) semanticScores[item.type] = item.score;

  return `
    <div style="margin-top:1rem;">
      <div style="padding:0.7rem;border-radius:6px;background:var(--color-bg-secondary);margin-bottom:0.8rem;">
        <div style="font-size:1rem;"><b>${escapeHtml(labelOf(r.type))}</b></div>
        <div style="font-size:0.8rem;color:var(--color-text-secondary);margin-top:0.3rem;">
          强度 ${num(r.intensity)} · 置信度 ${num(r.confidence)} · margin ${num(r.margin)}
          ${r.ambivalent ? ' · <b style="color:var(--color-warning);">情绪矛盾</b>' : ''}
        </div>
        <div style="font-size:0.78rem;color:var(--color-text-muted);margin-top:0.3rem;">
          生效层：<b>${escapeHtml(r.layer || '—')}</b> · 裁定方式：<b>${escapeHtml(r.arbitration || '—')}</b>
        </div>
      </div>

      <div style="display:flex;gap:1.5rem;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          ${renderScores('规则层得分', r.rule ? r.scores : null)}
          ${renderScores('语义层相似度', semanticScores)}
        </div>
        <div style="flex:1;min-width:200px;">
          <div style="font-size:0.8rem;margin-bottom:0.6rem;">
            <b>判定链路</b>
            <div style="font-size:0.78rem;color:var(--color-text-secondary);margin-top:0.2rem;">
              ${escapeHtml(r.trace?.decision || '—')}
            </div>
            ${r.trace?.arbitrationRequested ? '<div style="font-size:0.78rem;color:var(--color-warning);margin-top:0.2rem;">已发起 LLM 仲裁</div>' : ''}
            ${r.trace?.llmError ? `<div style="font-size:0.78rem;color:var(--color-danger);margin-top:0.2rem;">LLM 出错：${escapeHtml(r.trace.llmError)}</div>` : ''}
          </div>
          <div style="font-size:0.8rem;">
            <b>语义层状态</b>
            <div style="font-size:0.78rem;color:var(--color-text-secondary);margin-top:0.2rem;">
              ${semStatus
    ? `可用 ${semStatus.available ? '是' : '否'} · 原型句 ${semStatus.prototypeCount} 条 · 类别 ${semStatus.categoryCount} 个`
    : '未启用（本次识别未走语义层）'}
            </div>
            ${semStatus?.error ? `<div style="font-size:0.78rem;color:var(--color-danger);">${escapeHtml(semStatus.error)}</div>` : ''}
          </div>
        </div>
      </div>

      <div style="margin-top:0.8rem;">
        <b style="font-size:0.82rem;">子句切分与命中明细</b>
        <div style="margin-top:0.3rem;">${clausesHtml || '<div style="font-size:0.78rem;color:var(--color-text-muted);">（无子句）</div>'}</div>
      </div>
    </div>
  `;
}

/**
 * 打开情绪识别调试面板。
 * @returns {void}
 */
export function openEmotionDebug() {
  const html = `
    <button class="modal-close">&times;</button>
    <h2 class="modal-title">情绪识别调试</h2>
    <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
      输入一句话，查看它如何被拆分、匹配、判定否定与施受关系，以及最终落在哪个类别。
      这里的开关只影响本次试跑，不会修改设置。
    </p>

    <textarea id="emotionDebugInput" rows="2" style="width:100%;box-sizing:border-box;"
      placeholder="输入要测试的句子，例如：我不喜欢你">${escapeHtml(lastInput)}</textarea>

    <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin:0.6rem 0;font-size:0.82rem;align-items:center;">
      <label>语义层
        <select id="emotionDebugSemantic">
          <option value="off">关闭</option>
          <option value="auto" selected>自动</option>
          <option value="always">总是</option>
        </select>
      </label>
      <label style="display:flex;align-items:center;gap:0.3rem;">
        <input type="checkbox" id="emotionDebugLLM"> LLM 仲裁
      </label>
      <button class="btn btn-primary btn-sm" id="emotionDebugRun">识别</button>
    </div>

    <div style="font-size:0.78rem;color:var(--color-text-muted);margin-bottom:0.4rem;">
      快捷样例：${SAMPLE_TEXTS.map(t => `<a href="#" class="emotion-debug-sample" data-text="${escapeHtml(t)}" style="margin-right:0.5rem;">${escapeHtml(t)}</a>`).join('')}
    </div>

    <div id="emotionDebugOutput">${renderResult(lastResult)}</div>
  `;

  openModal(html);

  const input = document.getElementById('emotionDebugInput');
  const output = document.getElementById('emotionDebugOutput');
  const semanticSelect = document.getElementById('emotionDebugSemantic');
  const llmCheck = document.getElementById('emotionDebugLLM');

  const run = async () => {
    const text = input.value.trim();
    if (!text) {
      output.innerHTML = '<div style="font-size:0.82rem;color:var(--color-text-muted);">请先输入内容</div>';
      return;
    }

    lastInput = text;
    output.innerHTML = '<div style="font-size:0.82rem;color:var(--color-text-muted);">识别中…</div>';

    try {
      const result = await classifyUserMessage(text, false, {
        debug: true,
        perception: {
          semanticMode: semanticSelect.value,
          useLLMArbiter: llmCheck.checked,
        },
      });
      lastResult = result;
      output.innerHTML = renderResult(result);
    } catch (err) {
      output.innerHTML = `<div style="font-size:0.82rem;color:var(--color-danger);">识别失败：${escapeHtml(err?.message || String(err))}</div>`;
    }
  };

  document.getElementById('emotionDebugRun')?.addEventListener('click', run);

  for (const link of document.querySelectorAll('.emotion-debug-sample')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      input.value = link.dataset.text || '';
      run();
    });
  }

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
  });

  input?.focus();
}

export { closeModal };
