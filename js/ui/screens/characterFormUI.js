// js/ui/screens/characterFormUI.js - 角色表单渲染与逻辑
import { getAppState } from '../../core/state.js';
import { createCharacter, updateCharacter, getCurrentCharacter } from '../../modules/character.js';
import { quantifyCharacter } from '../../modules/personality.js';
import { renderConversation } from '../../modules/chat.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { renderCharacterList } from './characterListUI.js';
import { rescan } from '../../plugins/uiRuntime.js';
import { escapeHtml } from '../../core/utils.js';
import { renderAdvancedSection, bindAdvancedSection } from './characterAdvancedUI.js';

export function renderCharacterForm(characterData = null) {
  const isEdit = !!characterData;
  const title = isEdit ? '编辑角色' : '创建角色';
  const submitText = isEdit ? '更新' : '创建';
  const charId = isEdit ? characterData.id : '';

  const safeName = escapeHtml(isEdit ? characterData.name : '');
  const safeDesc = escapeHtml(isEdit ? (characterData.description || '') : '');
  const safeFirst = escapeHtml(isEdit ? (characterData.firstMessage || '') : '');
  const safePersonality = escapeHtml(isEdit ? (characterData.personality || '') : '');
  const safeRelation = escapeHtml(isEdit ? (characterData.relationship || '') : '');
  const safeSystem = escapeHtml(isEdit ? (characterData.systemPrompt || '') : '');
  const safeCallUser = escapeHtml(isEdit ? (characterData.callUser || '') : '');
  const safeScene = escapeHtml(isEdit ? (characterData.scene || '') : '');
  const safeExamples = escapeHtml(isEdit ? (characterData.dialogueExamples || '') : '');

  const safeCharId = escapeHtml(charId);
  const safeAvatar = escapeHtml(
    isEdit && characterData.avatar
      ? characterData.avatar
      : 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'80\' height=\'80\' viewBox=\'0 0 80 80\'%3E%3Ccircle cx=\'40\' cy=\'40\' r=\'40\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'40\' y=\'48\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'24\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E'
  );
  const safeChatBg = escapeHtml(
    isEdit && characterData.chatBg
      ? characterData.chatBg
      : 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'100\' viewBox=\'0 0 200 100\'%3E%3Crect width=\'200\' height=\'100\' fill=\'%23f0f0f2\'/%3E%3Ctext x=\'100\' y=\'55\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'14\' font-family=\'sans-serif\'%3E点击上传背景图%3C/text%3E%3C/svg%3E'
  );

  const formHtml = `
    <button class="modal-close">&times;</button>
    <h2 class="modal-title"><i class="fas ${isEdit ? 'fa-edit' : 'fa-user-plus'}"></i> ${title}</h2>
    <div class="character-form"
         ${isEdit ? `data-character-id="${safeCharId}"` : ''}
         data-mode="${isEdit ? 'edit' : 'create'}"
         data-plugin-slot="character-form">

      <div data-plugin-slot="character-form-top" style="display:contents;"></div>

      <div class="form-group">
        <label>角色名</label>
        <input type="text" id="charNameInput" value="${safeName}" placeholder="如：猫猫">
      </div>
      <div class="form-group">
        <label>性别</label>
        <select id="charGenderInput">
          <option value="unknown" ${isEdit && characterData.gender === 'unknown' ? 'selected' : ''}>未指定</option>
          <option value="male" ${isEdit && characterData.gender === 'male' ? 'selected' : ''}>男性</option>
          <option value="female" ${isEdit && characterData.gender === 'female' ? 'selected' : ''}>女性</option>
          <option value="non-binary" ${isEdit && characterData.gender === 'non-binary' ? 'selected' : ''}>非二元</option>
        </select>
      </div>
      <div class="form-group">
        <label>简介</label>
        <textarea id="charDescInput" rows="2" placeholder="角色背景">${safeDesc}</textarea>
      </div>
      <div class="form-group">
        <label>开场白</label>
        <textarea id="charFirstInput" rows="2" placeholder="首次对话内容（若启用自动生成，此字段为备用）">${safeFirst}</textarea>
      </div>
      <div class="form-group">
        <label>性格</label>
        <textarea id="charPersonalityInput" rows="2" placeholder="描述性格">${safePersonality}</textarea>
      </div>
      <div class="form-group">
        <label>与用户关系</label>
        <input type="text" id="charRelationInput" value="${safeRelation}" placeholder="如：宠物">
      </div>
      <div class="form-group">
        <label>系统提示词</label>
        <textarea id="charSystemInput" rows="4" placeholder="系统级指令" class="system-prompt">${safeSystem}</textarea>
      </div>
      <div class="form-group">
        <label>称呼用户</label>
        <input type="text" id="charCallUserInput" value="${safeCallUser}" placeholder="如：主人">
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" id="charGenerateFirst" ${isEdit ? (characterData.generateFirstMessage !== false ? 'checked' : '') : 'checked'}>
          自动生成开场白（使用 AI 根据场景和时间动态生成）
        </label>
      </div>
      <div class="form-group">
        <label>初次相遇场景</label>
        <input type="text" id="charSceneInput" value="${safeScene}" placeholder="如：傍晚的咖啡馆">
        <span class="help-text">描述角色与用户初次相遇的场景，用于生成动态开场白</span>
      </div>

      <div data-plugin-slot="character-form-middle" style="display:contents;"></div>

      <div class="form-group">
        <label>对话示例</label>
        <textarea id="charDialogueExamples" rows="4" placeholder="示例对话格式：&#10;用户：你好&#10;角色：你好，我是猫猫&#10;用户：你叫什么？&#10;角色：我叫猫猫呀">${safeExamples}</textarea>
        <span class="help-text">每行以"用户："或"角色："开头，用于 few-shot 示例注入，帮助 AI 学习对话风格</span>
      </div>

      ${renderAdvancedSection(isEdit ? characterData : null)}

      <div class="form-group" style="border-top: 1px solid var(--color-border); padding-top: 0.8rem; margin-top: 0.5rem;">
        <label style="font-size: 1rem; font-weight: 600; color: var(--color-text-primary);">🔊 语音配置</label>
        <span class="help-text">为角色设置专属语音，用于通话时朗读</span>
      </div>
      <div class="form-group">
        <label>音色</label>
        <select id="charTtsVoice" class="tts-voice-select" style="width:100%;">
          <option value="">使用全局默认音色</option>
        </select>
        <span class="help-text">选择该角色专属语音音色</span>
      </div>
      <div class="form-group">
        <label>语速</label>
        <input type="number" id="charTtsSpeed" step="0.1" min="0.1" max="10" value="${isEdit ? (characterData.ttsSpeed ?? 1.0) : 1.0}">
        <span class="help-text">0.1 ~ 10，1.0 为正常语速</span>
      </div>
      <div class="form-group">
        <label>音调</label>
        <input type="number" id="charTtsPitch" step="0.05" min="0" max="2" value="${isEdit ? (characterData.ttsPitch ?? 1.0) : 1.0}">
        <span class="help-text">0 ~ 2，1.0 为正常音调</span>
      </div>

      <div class="form-group">
        <button class="btn btn-sm" id="reQuantifyBtn" type="button" style="margin-bottom:0;">
          <i class="fas fa-brain"></i> 重新量化性格
        </button>
        <span class="help-text">使用 AI 重新分析角色描述，更新性格参数与体质/情绪 profile</span>
      </div>

      <div data-plugin-slot="character-form-before-avatar" style="display:contents;"></div>

      <div class="form-group">
        <label>头像</label>
        <div class="file-upload-wrapper">
          <input type="file" id="avatarFileInput" accept="image/*">
          <label class="file-upload-label" for="avatarFileInput">
            <i class="fas fa-cloud-upload-alt"></i>
            <span>选择图片</span>
            <span class="file-name" id="avatarFileName">未选择文件</span>
          </label>
        </div>
        <img id="avatarPreview" class="avatar-preview" src="${safeAvatar}" alt="头像预览">
        <span class="help-text">选择图片上传，将自动转换为Base64存储</span>
      </div>

      <div class="form-group">
        <label>聊天背景</label>
        <div class="file-upload-wrapper">
          <input type="file" id="chatBgFileInput" accept="image/*">
          <label class="file-upload-label" for="chatBgFileInput">
            <i class="fas fa-cloud-upload-alt"></i>
            <span>选择背景图</span>
            <span class="file-name" id="chatBgFileName">未选择文件</span>
          </label>
        </div>
        <img id="chatBgPreview" class="bg-preview" src="${safeChatBg}" alt="聊天背景预览" style="max-width:100%;max-height:150px;border-radius:8px;border:1px solid var(--color-border);">
        <span class="help-text">选择图片作为聊天背景，将自动转换为Base64存储</span>
      </div>

      <div data-plugin-slot="character-form-bottom" style="display:contents;"></div>

      <button class="btn btn-primary btn-block" id="submitCharBtn">${submitText}</button>
    </div>
  `;

  openModal(formHtml);

  setTimeout(() => {
    try { rescan(); } catch (_) {}
  }, 50);

  // ============================================================
  // ★ 进阶设定区绑定
  // ============================================================
  const advancedBinding = bindAdvancedSection(document.getElementById('modalContent'));

  // ---- 加载 TTS 音色列表 ----
  async function populateTtsVoices() {
    const select = document.getElementById('charTtsVoice');
    if (!select) return;
    try {
      const { getVoicesGroupedByLanguage } = await import('../../services/ttsService.js');
      const groups = await getVoicesGroupedByLanguage();
      const currentVoice = characterData?.ttsVoice || '';

      select.innerHTML = '<option value="">使用全局默认音色</option>';

      for (const [lang, voices] of Object.entries(groups)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = lang.toUpperCase();

        for (const v of voices) {
          const option = document.createElement('option');
          option.value = v.name;
          const langShort = v.lang.split('-')[0].slice(0, 2);
          const genderEmoji = v.gender === 'female' ? '♀' : v.gender === 'male' ? '♂' : '⚥';
          let displayName = v.name;
          if (displayName.length > 20) {
            displayName = displayName.slice(0, 18) + '…';
          }
          option.textContent = `${displayName} (${langShort}) ${genderEmoji}`;
          if (v.name === currentVoice) option.selected = true;
          optgroup.appendChild(option);
        }
        select.appendChild(optgroup);
      }
    } catch (e) {
      console.warn('[CharacterForm] 加载音色分组失败:', e);
    }
  }

  setTimeout(() => {
    populateTtsVoices();
  }, 300);

  // ---- 头像预览 ----
  const avatarInput = document.getElementById('avatarFileInput');
  const avatarPreview = document.getElementById('avatarPreview');
  const avatarFileName = document.getElementById('avatarFileName');
  if (avatarInput && avatarPreview) {
    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        avatarFileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => { avatarPreview.src = ev.target.result; };
        reader.readAsDataURL(file);
      } else {
        avatarFileName.textContent = '未选择文件';
      }
    });
  }

  // ---- 背景预览 ----
  const bgInput = document.getElementById('chatBgFileInput');
  const bgPreview = document.getElementById('chatBgPreview');
  const bgFileName = document.getElementById('chatBgFileName');
  if (bgInput && bgPreview) {
    bgInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        bgFileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => { bgPreview.src = ev.target.result; };
        reader.readAsDataURL(file);
      } else {
        bgFileName.textContent = '未选择文件';
      }
    });
  }

  // ============================================================
  // ---- 量化按钮
  // ============================================================
  const reQuantifyBtn = document.getElementById('reQuantifyBtn');
  if (reQuantifyBtn && isEdit) {
    reQuantifyBtn.addEventListener('click', async () => {
      try {
        reQuantifyBtn.disabled = true;
        reQuantifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 量化中...';

        // ★ 使用当前表单中的描述而非角色对象中的旧值
        const currentName = document.getElementById('charNameInput').value.trim() || characterData.name;
        const currentDesc = document.getElementById('charDescInput').value.trim();
        const currentPersonality = document.getElementById('charPersonalityInput').value.trim();
        const currentSystem = document.getElementById('charSystemInput').value.trim();
        const currentRelation = document.getElementById('charRelationInput').value.trim();

        const tempCharacter = {
          ...characterData,
          name: currentName,
          description: currentDesc,
          personality: currentPersonality,
          systemPrompt: currentSystem,
          relationship: currentRelation,
        };

        // ★ quantifyCharacter 返回三组参数
        const result = await quantifyCharacter(tempCharacter);

        // 更新按钮显示
        let paramsDisplay = reQuantifyBtn.parentNode.querySelector('#quantifyResultDisplay');
        if (!paramsDisplay) {
          paramsDisplay = document.createElement('div');
          paramsDisplay.id = 'quantifyResultDisplay';
          paramsDisplay.style.fontSize = '12px';
          paramsDisplay.style.marginTop = '4px';
          paramsDisplay.style.color = 'var(--color-text-muted)';
          reQuantifyBtn.parentNode.appendChild(paramsDisplay);
        }

        const p = result.personalityParameters;
        const b = result.bodyProfile;
        const e = result.emotionProfile;
        const specialLabel = b.special ? ` · 特殊:${b.special}` : '';
        paramsDisplay.innerHTML =
          `神经质:${p.neuroticism}, 外向:${p.extraversion}, 宜人:${p.agreeableness}, ` +
          `开放:${p.openness}, 尽责:${p.conscientiousness}, 表达:${p.expressiveness}<br>` +
          `体质:${b.constitution.toFixed(2)}, 抗病:${b.illnessResistance.toFixed(2)}, ` +
          `节律:${b.chronotype}${specialLabel}<br>` +
          `敏感:${e.emotionalSensitivity.toFixed(2)}, 波动:${e.emotionalVolatility.toFixed(2)}`;

        // ★ 同步到进阶设定区（如果用户之后点"保存"，会以进阶设定区的值为准）
        applyQuantifyResultToAdvancedUI(result);

        showToast('量化完成（点击保存以生效）', 'success');
      } catch (err) {
        showToast('量化失败: ' + err.message, 'error');
      } finally {
        reQuantifyBtn.disabled = false;
        reQuantifyBtn.innerHTML = '<i class="fas fa-brain"></i> 重新量化性格';
      }
    });
  } else if (reQuantifyBtn) {
    reQuantifyBtn.style.display = 'none';
  }

  /**
   * ★ 将量化结果同步到进阶设定区的 UI 控件
   *   注意：仅更新 DOM 显示，不写数据库。用户点击"更新"后才会保存。
   */
  function applyQuantifyResultToAdvancedUI(result) {
    const modalContent = document.getElementById('modalContent');
    if (!modalContent) return;
    const section = modalContent.querySelector('#characterAdvancedSettings');
    if (!section) return;

    const b = result.bodyProfile || {};
    const e = result.emotionProfile || {};

    // 生理节律
    if (b.chronotype !== undefined) {
      const el = section.querySelector('#advChronotype');
      if (el) el.value = b.chronotype;
    }
    if (typeof b.circadianEnabled === 'boolean') {
      const el = section.querySelector('#advCircadianEnabled');
      if (el) el.checked = b.circadianEnabled;
    }
    if (typeof b.sleepNeedHours === 'number') {
      const el = section.querySelector('#advSleepNeed');
      if (el) el.value = b.sleepNeedHours;
    }
    if (typeof b.allowNapping === 'boolean') {
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
        // 触发 hint 更新
        el.dispatchEvent(new Event('change'));
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
      if (typeof value === 'number') {
        const slider = section.querySelector(`#${id}`);
        const label = section.querySelector(`#${id}Value`);
        if (slider) {
          slider.value = value;
          if (label) label.textContent = value.toFixed(2);
        }
      }
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
      if (typeof value === 'number') {
        const slider = section.querySelector(`#${id}`);
        const label = section.querySelector(`#${id}Value`);
        if (slider) {
          slider.value = value;
          if (label) label.textContent = value.toFixed(2);
        }
      }
    }
  }

  // ============================================================
  // ---- 提交表单 ----
  // ============================================================
  const submitBtn = document.getElementById('submitCharBtn');
  submitBtn.addEventListener('click', async () => {
    const name = document.getElementById('charNameInput').value.trim();
    if (!name) {
      showToast('请填写角色名', 'warning');
      return;
    }

    const ttsVoice = document.getElementById('charTtsVoice').value || null;
    const ttsSpeed = parseFloat(document.getElementById('charTtsSpeed').value) || 1.0;
    const ttsPitch = parseFloat(document.getElementById('charTtsPitch').value) || 1.0;

    const { bodyProfile, emotionProfile } = advancedBinding.collect();

    const data = {
      name,
      gender: document.getElementById('charGenderInput').value,
      description: document.getElementById('charDescInput').value.trim(),
      firstMessage: document.getElementById('charFirstInput').value.trim(),
      personality: document.getElementById('charPersonalityInput').value.trim(),
      relationship: document.getElementById('charRelationInput').value.trim(),
      systemPrompt: document.getElementById('charSystemInput').value.trim(),
      callUser: document.getElementById('charCallUserInput').value.trim(),
      avatar: (avatarPreview && avatarPreview.src && !avatarPreview.src.startsWith('data:image/svg+xml'))
        ? avatarPreview.src
        : '',
      chatBg: (bgPreview && bgPreview.src && !bgPreview.src.startsWith('data:image/svg+xml'))
        ? bgPreview.src
        : '',
      generateFirstMessage: document.getElementById('charGenerateFirst').checked,
      scene: document.getElementById('charSceneInput').value.trim(),
      dialogueExamples: document.getElementById('charDialogueExamples').value.trim(),
      ttsVoice: ttsVoice,
      ttsSpeed: ttsSpeed,
      ttsPitch: ttsPitch,
      bodyProfile,
      emotionProfile,
    };

    try {
      let savedChar;
      if (isEdit) {
        await updateCharacter(characterData.id, data);
        savedChar = { ...characterData, ...data };
      } else {
        savedChar = await createCharacter(data);
      }
      closeModal();
      renderCharacterList();
      const state = getAppState();
      if (!state.get('currentCharacterId')) {
        const chars = state.get('characters');
        const target = chars.find(c => c.id === savedChar.id);
        if (target) {
          state.set('currentCharacterId', target.id);
          localStorage.setItem('lastCharacterId', target.id);
        }
      }
      showToast(isEdit ? '角色更新成功' : '角色创建成功', 'success');
    } catch (err) {
      showToast((isEdit ? '更新' : '创建') + '失败: ' + err.message, 'error');
    }
  });
}