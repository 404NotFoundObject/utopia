// js/ui/screens/settingsUI.js - 设置界面主入口（编排器）
//
// 职责：
//   - renderSettingsModal()：编排所有 section 的 HTML，返回完整字符串
//   - bindSettingsSave()：编排所有 section 的事件绑定 + 保存按钮
//
// 设计说明：
//   本文件是"编排层"，不包含任何业务逻辑。所有 section 的 render/bind
//   分散在 ./settingsUI/sections/*.js，公共工具在 ./settingsUI/shared.js，
//   保存逻辑在 ./settingsUI/save.js。
//
// 对外接口保持不变：
//   - import { renderSettingsModal, bindSettingsSave } from './settingsUI.js'
//   外部调用方（sidebar.js / app.js）无需任何改动。
//

import { getAppState } from '../../core/state.js';
import { rescan } from '../../plugins/uiRuntime.js';
import { createSettingsCtx } from './settingsUI/shared.js';

// ---- Sections: render + bind ----
import { renderUserSection, bindUserSection } from './settingsUI/sections/userSection.js';
import { renderThemeSection, bindThemeSection } from './settingsUI/sections/themeSection.js';
import { renderApiSection, bindApiSection } from './settingsUI/sections/apiSection.js';
import { renderModelParamsSection, bindModelParamsSection } from './settingsUI/sections/modelParamsSection.js';
import { renderTokenBudgetSection, bindTokenBudgetSection } from './settingsUI/sections/tokenBudgetSection.js';
import { renderConversationStateSection, bindConversationStateSection } from './settingsUI/sections/conversationStateSection.js';
import { renderTimeSection, bindTimeSection } from './settingsUI/sections/timeSection.js';
import { renderEnginesSection, bindEnginesSection } from './settingsUI/sections/enginesSection.js';
import { renderMemorySection, bindMemorySection } from './settingsUI/sections/memorySection.js';
import { renderWorldBookSemanticSection, bindWorldBookSemanticSection } from './settingsUI/sections/worldBookSemanticSection.js';
import { renderContextSection, bindContextSection } from './settingsUI/sections/contextSection.js';
import { renderTtsSection, bindTtsSection } from './settingsUI/sections/ttsSection.js';
import { renderSttSection, bindSttSection } from './settingsUI/sections/sttSection.js';
import { renderProactiveSection, bindProactiveSection } from './settingsUI/sections/proactiveSection.js';
import { renderDangerSection, bindDangerSection } from './settingsUI/sections/dangerSection.js';

// ---- 保存逻辑 ----
import { bindSaveButton } from './settingsUI/save.js';

// ============================================================
// 渲染设置面板
// ============================================================

/**
 * 渲染设置面板的完整 HTML
 *
 * 顺序即视觉顺序。新增 section 时：
 *   1. 上方 import 该 section 的 render / bind
 *   2. 在下方 HTML 里插入 ${renderXxxSection(settings, ctx)}
 *   3. 在 bindSettingsSave 里插入 bindXxxSection(modalContent, ctx)
 *
 * @returns {string} HTML
 */
export function renderSettingsModal() {
  const settings = getAppState().get('settings') || {};
  const ctx = createSettingsCtx();

  return `
    <button class="modal-close">&times;</button>
    <h2 class="modal-title"><i class="fas fa-cog"></i> 设置</h2>

    <div data-plugin-slot="settings-top" style="display:contents;"></div>

    ${renderUserSection(settings, ctx)}

    ${renderThemeSection(settings, ctx)}

    ${renderApiSection(settings, ctx)}

    ${renderModelParamsSection(settings, ctx)}

    ${renderTokenBudgetSection(settings, ctx)}

    ${renderConversationStateSection(settings, ctx)}

    ${renderTimeSection(settings, ctx)}

    ${renderEnginesSection(settings, ctx)}

    ${renderMemorySection(settings, ctx)}

    ${renderWorldBookSemanticSection(settings, ctx)}

    ${renderContextSection(settings, ctx)}

    ${renderTtsSection(settings, ctx)}

    ${renderSttSection(settings, ctx)}

    ${renderProactiveSection(settings, ctx)}

    ${renderDangerSection(settings, ctx)}

    <div data-plugin-slot="settings-sections" style="display:contents;"></div>
    <div data-plugin-slot="settings-bottom" style="display:contents;"></div>

    <button class="btn btn-primary btn-block" id="saveSettingsBtn">保存设置</button>
  `;
}

// ============================================================
// 绑定设置面板事件
// ============================================================

/**
 * 为设置面板绑定所有事件
 *
 * 顺序：
 *   1. 各 section 的 bind（顺序不影响功能，因为 id 唯一）
 *   2. 保存按钮 bind
 *   3. 延迟触发 uiRuntime.rescan()（用于插件槽位填充）
 *
 * ★ 返回值：
 *   返回 Promise，在所有 section 的异步初始化完成后 resolve。
 *   - 同步 section 返回 undefined → 立即视为 settled
 *   - 异步 section（memory / tts）返回内部初始化 Promise → 会被等待
 *
 *   调用方可以：
 *     - 忽略返回值（普通打开设置面板路径，不阻塞）
 *     - await 返回值（主题制作器返回路径，确保 restore 前 DOM 完整）
 *
 * @param {HTMLElement} modalContent - 设置面板的模态框内容节点
 * @returns {Promise<void>}
 */
export function bindSettingsSave(modalContent) {
  const ctx = createSettingsCtx();

  // ---- Sections ----
  // 收集所有 section 的返回值（可能是 Promise，也可能是 undefined）
  const sectionResults = [
    bindUserSection(modalContent, ctx),
    bindThemeSection(modalContent, ctx),
    bindApiSection(modalContent, ctx),
    bindModelParamsSection(modalContent, ctx),
    bindTokenBudgetSection(modalContent, ctx),
    bindConversationStateSection(modalContent, ctx),
    bindTimeSection(modalContent, ctx),
    bindEnginesSection(modalContent, ctx),
    bindMemorySection(modalContent, ctx),
    bindWorldBookSemanticSection(modalContent, ctx),
    bindContextSection(modalContent, ctx),
    bindTtsSection(modalContent, ctx),
    bindSttSection(modalContent, ctx),
    bindProactiveSection(modalContent, ctx),
    bindDangerSection(modalContent, ctx),
  ];

  // ---- 保存按钮 ----
  bindSaveButton(modalContent, ctx);

  // ---- 插件槽位扫描 ----
  setTimeout(() => {
    try { rescan(); } catch (_) {}
  }, 100);

  // ---- 返回聚合 Promise ----
  // allSettled 保证即使某个 section 初始化失败也不会 reject，
  // 从而调用方可以无条件 await，不影响后续 restore。
  return Promise.allSettled(sectionResults).then(() => undefined);
}