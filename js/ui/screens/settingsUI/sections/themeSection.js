/**
 * @module ui/screens/settingsUI/sections/themeSection
 * @description 主题 section（主题下拉 + 主题制作器按钮）
 *
 * 主题制作器入口：
 *   点击按钮后，先快照当前设置面板的表单值，再打开主题制作器。
 *   主题制作器关闭时通过 onClose 回调重新渲染设置面板并恢复快照。
 *
 * 循环依赖规避：
 *   onClose 回调需要主入口的 renderSettingsModal / bindSettingsSave，
 *   通过动态 import('../../settingsUI.js') 获取，避免静态循环。
 *
 */

import { applyTheme, getCurrentTheme, getAvailableThemes } from '../../../../ui/layout/theme.js';
import { openModal } from '../../../../ui/components/modal.js';
import { snapshotSettingsForm, restoreSettingsForm } from '../snapshot.js';

/**
 * 渲染主题 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderThemeSection(settings, ctx) {
  const currentTheme = getCurrentTheme();
  const themes = getAvailableThemes();
  const builtinThemes = themes.filter(t => !t.isCustom);
  const customThemes = themes.filter(t => t.isCustom);

  return `
    <!-- 主题 -->
    <div class="settings-section">
      <h3>🎨 主题</h3>
      <div class="setting-row">
        <label>主题</label>
        <select id="settingsThemeSelect">
          <optgroup label="内置主题">
            ${builtinThemes.map(t => `
              <option value="${ctx.escapeHtml(t.id)}" ${currentTheme === t.id ? 'selected' : ''}>${ctx.escapeHtml(t.name)}</option>
            `).join('')}
          </optgroup>
          ${customThemes.length > 0 ? `
            <optgroup label="自定义主题">
              ${customThemes.map(t => `
                <option value="${ctx.escapeHtml(t.id)}" ${currentTheme === t.id ? 'selected' : ''}>${ctx.escapeHtml(t.name)}</option>
              `).join('')}
            </optgroup>
          ` : ''}
        </select>
      </div>
      <div class="setting-row">
        <button class="btn btn-sm" id="settingsThemeMakerBtn">🎨 主题制作器</button>
        <span class="help-text">自定义颜色、圆角、阴影等，实时预览</span>
      </div>
    </div>
  `;
}

/**
 * 绑定主题 section 的事件
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 */
export function bindThemeSection(modalContent, ctx) {
  const themeSelect = modalContent.querySelector('#settingsThemeSelect');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      applyTheme(themeSelect.value);
    });
  }

  const themeMakerBtn = modalContent.querySelector('#settingsThemeMakerBtn');
  if (themeMakerBtn) {
    themeMakerBtn.addEventListener('click', () => {
      // ① 打开主题制作器前，快照当前设置面板的所有可编辑值
      const snapshot = snapshotSettingsForm(modalContent);

      // ② 打开主题制作器，关闭后重新渲染设置面板并恢复
      import('../../../../ui/themes/themeMaker.js').then((m) => {
        m.openThemeMaker({
          onClose: async () => {
            try {
              // 动态 import 主入口，规避循环依赖
              const main = await import('../../settingsUI.js');
              const html = main.renderSettingsModal();
              openModal(html);
              const newContent = document.getElementById('modalContent');
              if (!newContent) return;

              //   在 bindSettingsSave 之前挂载 snapshot，
              //   供 memorySection / ttsSection 的异步任务读取。
              //   注意：#modalContent 是同一个 DOM 元素（openModal 只换 innerHTML），
              //   所以需要每次都用全新对象覆盖，避免上次的残留污染。
              newContent.__restoreSnapshot = JSON.parse(JSON.stringify(snapshot.fields));

              // ★ 等待所有 section 的异步初始化完成
              //    （如 memory 的模型列表、tts 的音色列表）
              await main.bindSettingsSave(newContent);

              // ★ 现在 DOM 已完全就绪，恢复用户之前的输入
              restoreSettingsForm(newContent, snapshot);

              // ★ 清理：异步任务已读完，避免属性残留
              //    （保留对象引用但清空内容，不强求异步任务全部删除）
              //    注意：memorySection / ttsSection 内部会 delete 各自的键，
              //    这里不做全清，防止异步任务尚未完成时误删。
            } catch (err) {
              console.error('[Settings/Theme] 恢复设置面板失败:', err);
            }
          },
        });
      }).catch((err) => {
        console.error('[Settings/Theme] 加载主题制作器失败:', err);
        ctx.showToast('主题制作器加载失败: ' + err.message, 'error');
      });
    });
  }
}