// js/ui/screens/characterAdvancedUI.js - 角色表单"进阶设定"区
import { escapeHtml } from '../../core/utils.js';
import {
  getDefaultBodyProfile,
  getDefaultEmotionProfile,
  getSpecialTypeList,
  normalizeBodyProfile,
  normalizeEmotionProfile,
  deriveBodyProfileFromPersonality,
  deriveEmotionProfileFromPersonality,
} from '../../modules/profileDefaults.js';

/**
 * 体质模板定义
 */
const TEMPLATES = [
  {
    id: 'standard', label: '标准型', emoji: '⚖️',
    body: {},
    emotion: {},
  },
  {
    id: 'athletic', label: '健壮型', emoji: '💪',
    body: { constitution: 0.85, illnessResistance: 0.8, injuryResistance: 0.8, recoverySpeed: 1.5, energyDecayFactor: 0.7 },
    emotion: {},
  },
  {
    id: 'frail', label: '体弱型', emoji: '🌡️',
    body: { constitution: 0.2, illnessResistance: 0.25, injuryResistance: 0.3, recoverySpeed: 0.6, energyDecayFactor: 1.3 },
    emotion: { emotionalSensitivity: 0.7 },
  },
  {
    id: 'nightowl', label: '夜猫子', emoji: '🦉',
    body: { chronotype: 'evening', sleepNeedHours: 6 },
    emotion: {},
  },
  {
    id: 'earlybird', label: '早起鸟', emoji: '🐦',
    body: { chronotype: 'morning', sleepNeedHours: 8 },
    emotion: {},
  },
  {
    id: 'napper', label: '午休党', emoji: '😴',
    body: { allowNapping: true, napTendency: 0.8 },
    emotion: {},
  },
  {
    id: 'cultivator', label: '修仙者', emoji: '✨',
    body: { special: 'immortal' },
    emotion: {},
  },
  {
    id: 'cyborg', label: '赛博格', emoji: '🦾',
    body: { special: 'cyborg' },
    emotion: {},
  },
];

/**
 * ★ 解析角色的"原始" profile（不合并 special overrides）
 *
 * 为什么不用 getBodyProfile / getEmotionProfile：
 *   那两个函数会合并 special overrides 后的值，导致编辑表单显示
 *   与 DB 实际存储不一致，一旦保存会覆盖用户原始设置。
 *
 * 优先级：
 *   1. character.bodyProfile 存在 → normalize（补齐字段 + clamp）
 *   2. character 存在但无 profile → 从性格推导
 *   3. character 为 null（新建模式）→ 默认值
 *
 * @param {Object|null} characterData
 * @returns {{ bodyProfile: Object, emotionProfile: Object }}
 * @private
 */
function resolveRawProfiles(characterData) {
  let bodyProfile;
  let emotionProfile;

  if (characterData && characterData.bodyProfile) {
    bodyProfile = normalizeBodyProfile(characterData.bodyProfile);
  } else if (characterData) {
    bodyProfile = deriveBodyProfileFromPersonality(characterData.personalityParameters);
  } else {
    bodyProfile = getDefaultBodyProfile();
  }

  if (characterData && characterData.emotionProfile) {
    emotionProfile = normalizeEmotionProfile(characterData.emotionProfile);
  } else if (characterData) {
    emotionProfile = deriveEmotionProfileFromPersonality(characterData.personalityParameters);
  } else {
    emotionProfile = getDefaultEmotionProfile();
  }

  return { bodyProfile, emotionProfile };
}

/**
 * 渲染进阶设定区 HTML
 *
 * @param {Object} characterData - 角色数据（编辑模式下有值）
 * @returns {string}
 */
export function renderAdvancedSection(characterData) {
  const { bodyProfile, emotionProfile } = resolveRawProfiles(characterData);

  const specialTypes = getSpecialTypeList();

  const templatesHtml = TEMPLATES.map(t => `
    <button type="button" class="adv-template-btn" data-template="${t.id}"
      style="padding:0.3rem 0.6rem;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg-secondary);cursor:pointer;font-size:0.8rem;transition:all 0.15s;"
      title="${escapeHtml(t.label)}">
      ${t.emoji} ${escapeHtml(t.label)}
    </button>
  `).join('');

  const specialOptionsHtml = specialTypes.map(t => `
    <option value="${escapeHtml(t.id)}" ${bodyProfile.special === t.id ? 'selected' : ''}>
      ${t.emoji} ${escapeHtml(t.label)} — ${escapeHtml(t.description)}
    </option>
  `).join('');

  return `
    <details class="advanced-settings" id="characterAdvancedSettings"
      style="margin-top:1rem;border:1px solid var(--color-border);border-radius:var(--radius-md);padding:0.5rem 0.8rem;background:var(--color-bg-secondary);">
      <summary style="cursor:pointer;font-weight:600;font-size:0.9rem;user-select:none;padding:0.2rem 0;">
        ⚙️ 进阶设定（可选，不填则自动推断）
      </summary>

      <div style="padding-top:0.6rem;">

        <!-- 体质模板 -->
        <div class="form-group">
          <label style="font-size:0.85rem;">快捷模板</label>
          <div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.3rem;">
            ${templatesHtml}
          </div>
          <span class="help-text" style="font-size:0.75rem;color:var(--color-text-muted);">
            点击模板快速设置一组参数，之后仍可手动微调
          </span>
        </div>

        <!-- 生理节律 -->
        <div class="form-group" style="margin-top:0.8rem;">
          <label style="font-size:0.85rem;">🕐 生理节律</label>
          <div style="display:flex;flex-direction:column;gap:0.3rem;margin-top:0.3rem;">
            <!-- ★ 修复：改用 class 布局，选项文本缩短，移动端两行显示 -->
            <label class="adv-inline-field">
              <span class="adv-inline-label">作息类型</span>
              <select id="advChronotype" class="adv-inline-select">
                <option value="morning" title="早晨精力旺盛" ${bodyProfile.chronotype === 'morning' ? 'selected' : ''}>早起鸟</option>
                <option value="neutral" title="普通作息" ${bodyProfile.chronotype === 'neutral' ? 'selected' : ''}>中性</option>
                <option value="evening" title="夜晚精力旺盛" ${bodyProfile.chronotype === 'evening' ? 'selected' : ''}>夜猫子</option>
                <option value="none" title="不受昼夜影响" ${bodyProfile.chronotype === 'none' ? 'selected' : ''}>无节律</option>
              </select>
            </label>
            <!-- ★ F4 修复：新增昼夜节律总开关 -->
            <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;">
              <input type="checkbox" id="advCircadianEnabled" ${bodyProfile.circadianEnabled !== false ? 'checked' : ''}>
              启用昼夜节律
            </label>
            <span class="help-text" style="font-size:0.72rem;color:var(--color-text-muted);margin-left:1.6rem;">
              不勾选则角色不受昼夜影响，任何时段的精力与睡意变化速率相同
            </span>
            <label class="adv-inline-field">
              <span class="adv-inline-label">每日睡眠需求</span>
              <input type="number" id="advSleepNeed" min="0" max="14" step="0.5"
                value="${bodyProfile.sleepNeedHours}" class="adv-inline-input-small">
              <span class="adv-inline-unit">小时</span>
            </label>
            <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;">
              <input type="checkbox" id="advAllowNapping" ${bodyProfile.allowNapping ? 'checked' : ''}>
              习惯午休
            </label>
            <!-- ★ 方案 A 修复：新增午休倾向滑块，随 allowNapping 显示/隐藏 -->
            <div id="advNapTendencyWrapper" style="${bodyProfile.allowNapping ? '' : 'display:none;'}">
              ${renderSlider('advNapTendency', '午休倾向', bodyProfile.napTendency, 0, 1, 0.05, '越高越易触发午休（0=从不，1=每次）')}
            </div>
          </div>
        </div>

        <!-- 体质 -->
        <div class="form-group" style="margin-top:0.8rem;">
          <label style="font-size:0.85rem;">🧬 体质</label>
          <div style="display:flex;flex-direction:column;gap:0.4rem;margin-top:0.3rem;">
            ${renderSlider('advConstitution', '体质强弱', bodyProfile.constitution, 0, 1, 0.05, '越高越强壮，越不易生病受伤')}
            ${renderSlider('advIllnessResistance', '疾病抵抗', bodyProfile.illnessResistance, 0, 1, 0.05, '越高越不易生病')}
            ${renderSlider('advInjuryResistance', '受伤抵抗', bodyProfile.injuryResistance, 0, 1, 0.05, '越高越不易受伤')}
            ${renderSlider('advRecoverySpeed', '恢复速度', bodyProfile.recoverySpeed, 0, 3, 0.1, '越高恢复越快')}
            ${renderSlider('advEnergyDecay', '精力消耗', bodyProfile.energyDecayFactor, 0, 3, 0.1, '越低精力越持久', true)}
            ${renderSlider('advEnergyRecovery', '精力恢复', bodyProfile.energyRecoveryFactor, 0, 3, 0.1, '越高精力恢复越快')}
            ${renderSlider('advSleepinessRate', '睡意积攒', bodyProfile.sleepinessRateFactor, 0, 3, 0.1, '越低越不易困倦', true)}
            ${renderSlider('advWakeEase', '唤醒容易度', bodyProfile.wakeEase, 0, 1, 0.05, '越高越容易被叫醒')}
          </div>
        </div>

        <!-- 情绪 -->
        <div class="form-group" style="margin-top:0.8rem;">
          <label style="font-size:0.85rem;">💭 情绪特质</label>
          <div style="display:flex;flex-direction:column;gap:0.4rem;margin-top:0.3rem;">
            ${renderSlider('advEmotionSensitivity', '情绪敏感度', emotionProfile.emotionalSensitivity, 0, 1, 0.05, '越高越易被触动')}
            ${renderSlider('advEmotionVolatility', '情绪波动性', emotionProfile.emotionalVolatility, 0, 1, 0.05, '越高情绪起伏越大')}
            ${renderSlider('advEmotionDecay', '情绪恢复速度', emotionProfile.emotionalDecayFactor, 0, 3, 0.1, '越高平复越快')}
            ${renderSlider('advAttachmentSpeed', '依恋建立速度', emotionProfile.attachmentSpeed, 0, 1, 0.05, '越高越易产生依恋')}
            ${renderSlider('advTrustRecovery', '信任恢复倍率', emotionProfile.trustRecoveryFactor, 0, 3, 0.1, '越高越易恢复信任')}
          </div>
        </div>

        <!-- 特殊类型 -->
        <div class="form-group" style="margin-top:0.8rem;">
          <label style="font-size:0.85rem;">🌟 特殊类型</label>
          <select id="advSpecial" style="width:100%;margin-top:0.3rem;">
            <option value="" ${!bodyProfile.special ? 'selected' : ''}>普通人类</option>
            ${specialOptionsHtml}
          </select>
          <span class="help-text" id="advSpecialHint" style="font-size:0.75rem;color:var(--color-text-muted);display:block;margin-top:0.2rem;">
            选择特殊类型后，运行时部分参数会被自动覆盖（不改变此处设置的值）
          </span>
        </div>

      </div>
    </details>
  `;
}

/**
 * 渲染单个滑块
 */
function renderSlider(id, label, value, min, max, step, hint, inverted = false) {
  const display = typeof value === 'number' ? value.toFixed(2) : '0.50';
  return `
    <div class="adv-slider-item">
      <div class="adv-slider-row">
        <span class="adv-slider-label">${escapeHtml(label)}</span>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}"
          value="${value}"
          class="adv-slider-input${inverted ? ' inverted' : ''}">
        <span id="${id}Value" class="adv-slider-value">${display}</span>
      </div>
      ${hint ? `<div class="adv-slider-hint">${escapeHtml(hint)}</div>` : ''}
    </div>
  `;
}

/**
 * 绑定进阶设定区的事件
 *
 * @param {HTMLElement} modalContent - 模态框内容节点
 * @returns {{ collect: () => { bodyProfile, emotionProfile } }} 收集函数
 */
export function bindAdvancedSection(modalContent) {
  const section = modalContent.querySelector('#characterAdvancedSettings');
  if (!section) {
    // 未渲染进阶设定区（不应发生），返回空收集
    return {
      collect: () => ({ bodyProfile: null, emotionProfile: null }),
    };
  }

  // ---- 滑块值实时显示 ----
  const sliderIds = [
    'advConstitution', 'advIllnessResistance', 'advInjuryResistance',
    'advRecoverySpeed', 'advEnergyDecay', 'advEnergyRecovery', 'advSleepinessRate', 'advWakeEase',
    'advEmotionSensitivity', 'advEmotionVolatility', 'advEmotionDecay',
    'advAttachmentSpeed', 'advTrustRecovery',
    'advNapTendency',
  ];
  for (const id of sliderIds) {
    const slider = section.querySelector(`#${id}`);
    const label = section.querySelector(`#${id}Value`);
    if (slider && label) {
      slider.addEventListener('input', () => {
        label.textContent = parseFloat(slider.value).toFixed(2);
      });
    }
  }

  // ---- 模板按钮 ----
  section.querySelectorAll('.adv-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tplId = btn.dataset.template;
      const tpl = TEMPLATES.find(t => t.id === tplId);
      if (!tpl) return;
      applyTemplate(section, tpl);
    });
  });

  // ---- 特殊类型选择 ----
  const specialSelect = section.querySelector('#advSpecial');
  if (specialSelect) {
    specialSelect.addEventListener('change', () => {
      updateSpecialHint(section, specialSelect.value);
    });
  }

  const allowNappingCheckbox = section.querySelector('#advAllowNapping');
  const napTendencyWrapper = section.querySelector('#advNapTendencyWrapper');
  if (allowNappingCheckbox && napTendencyWrapper) {
    allowNappingCheckbox.addEventListener('change', () => {
      napTendencyWrapper.style.display = allowNappingCheckbox.checked ? '' : 'none';
    });
  }

  return {
    collect: () => collectProfile(section),
  };
}

/**
 * 应用模板：设置对应滑块和下拉框
 */
function applyTemplate(section, tpl) {
  const b = tpl.body || {};
  const e = tpl.emotion || {};

  // 生理节律
  if (b.chronotype !== undefined) {
    const el = section.querySelector('#advChronotype');
    if (el) el.value = b.chronotype;
  }
  if (b.circadianEnabled !== undefined) {
    const el = section.querySelector('#advCircadianEnabled');
    if (el) el.checked = b.circadianEnabled;
  }
  if (b.sleepNeedHours !== undefined) {
    const el = section.querySelector('#advSleepNeed');
    if (el) el.value = b.sleepNeedHours;
  }
  if (b.allowNapping !== undefined) {
    const el = section.querySelector('#advAllowNapping');
    if (el) {
      el.checked = b.allowNapping;
      const wrapper = section.querySelector('#advNapTendencyWrapper');
      if (wrapper) wrapper.style.display = b.allowNapping ? '' : 'none';
    }
  }
  if (b.special !== undefined) {
    const el = section.querySelector('#advSpecial');
    if (el) {
      el.value = b.special || '';
      updateSpecialHint(section, b.special);
    }
  }

  // 体质滑块
  const bodySliders = {
    advConstitution: b.constitution,
    advIllnessResistance: b.illnessResistance,
    advInjuryResistance: b.injuryResistance,
    advRecoverySpeed: b.recoverySpeed,
    advEnergyDecay: b.energyDecayFactor,
    advEnergyRecovery: b.energyRecoveryFactor,
    advSleepinessRate: b.sleepinessRateFactor,
    advWakeEase: b.wakeEase,
    advNapTendency: b.napTendency,
  };
  for (const [id, value] of Object.entries(bodySliders)) {
    if (value !== undefined) setSlider(section, id, value);
  }

  // 情绪滑块
  const emotionSliders = {
    advEmotionSensitivity: e.emotionalSensitivity,
    advEmotionVolatility: e.emotionalVolatility,
    advEmotionDecay: e.emotionalDecayFactor,
    advAttachmentSpeed: e.attachmentSpeed,
    advTrustRecovery: e.trustRecoveryFactor,
  };
  for (const [id, value] of Object.entries(emotionSliders)) {
    if (value !== undefined) setSlider(section, id, value);
  }
}

function setSlider(section, id, value) {
  const slider = section.querySelector(`#${id}`);
  const label = section.querySelector(`#${id}Value`);
  if (slider) {
    slider.value = value;
    if (label) label.textContent = parseFloat(value).toFixed(2);
  }
}

function updateSpecialHint(section, specialId) {
  const hint = section.querySelector('#advSpecialHint');
  if (!hint) return;
  if (!specialId) {
    hint.textContent = '普通人类：所有参数按当前设置生效';
    return;
  }
  const types = getSpecialTypeList();
  const t = types.find(x => x.id === specialId);
  if (t) {
    hint.textContent = `${t.emoji} ${t.label}：${t.description}。运行时部分参数会被自动覆盖（不改变此处设置的值）。`;
  }
}

/**
 * 从 DOM 收集当前设置
 */
function collectProfile(section) {
  const q = (id) => section.querySelector(`#${id}`);
  const num = (id, fallback) => {
    const el = q(id);
    if (!el) return fallback;
    const n = parseFloat(el.value);
    return Number.isFinite(n) ? n : fallback;
  };

  const bodyProfile = {
    chronotype: q('advChronotype')?.value || 'neutral',
    circadianEnabled: q('advCircadianEnabled')?.checked ?? true,
    sleepNeedHours: num('advSleepNeed', 7),
    allowNapping: q('advAllowNapping')?.checked || false,
    napTendency: num('advNapTendency', 0.3),
    energyDecayFactor: num('advEnergyDecay', 1.0),
    energyRecoveryFactor: num('advEnergyRecovery', 1.0),
    sleepinessRateFactor: num('advSleepinessRate', 1.0),
    wakeEase: num('advWakeEase', 0.5),
    constitution: num('advConstitution', 0.5),
    illnessResistance: num('advIllnessResistance', 0.5),
    injuryResistance: num('advInjuryResistance', 0.5),
    recoverySpeed: num('advRecoverySpeed', 1.0),
    special: q('advSpecial')?.value || null,
  };

  const emotionProfile = {
    emotionalSensitivity: num('advEmotionSensitivity', 0.5),
    emotionalVolatility: num('advEmotionVolatility', 0.5),
    emotionalDecayFactor: num('advEmotionDecay', 1.0),
    attachmentSpeed: num('advAttachmentSpeed', 0.5),
    trustRecoveryFactor: num('advTrustRecovery', 1.0),
  };

  return { bodyProfile, emotionProfile };
}