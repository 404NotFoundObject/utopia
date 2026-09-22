/**
 * @module ui/screens/settingsUI/snapshot
 * @description 设置面板快照 / 恢复
 *
 * 用途：
 *   用户从设置面板进入主题制作器，返回时设置面板会被重新渲染。
 *   renderSettingsModal() 使用 getAppState().get('settings') 的"已保存值"，
 *   若用户在进入主题制作器前修改了输入框但未保存，这些修改会丢失。
 *   本模块通过"抓取所有表单控件当前值 → 重渲染 → 写回"来保留这些修改。
 *
 * 排除项：
 *   - file 输入：浏览器安全限制，无法编程恢复
 *   - settingsThemeSelect：值必须由 getCurrentTheme() 决定，
 *     否则用户在主题制作器里"保存并应用"到新主题后，返回设置面板会显示旧主题。
 *
 *   现在分四阶段：
 *     阶段 1：写回所有 select 的值
 *     阶段 2：派发 select 的 change（触发联动 UI 更新）
 *     阶段 3：写回所有非 select 的值（覆盖阶段 2 的副作用）
 *     阶段 4：派发非 select 的 input（让依赖 input 的 UI 同步）
 */

/**
 * 排除在快照之外的元素 id
 * 说明：这些字段的值必须由实际运行时状态决定（如当前主题），
 *       不能简单快照-恢复，否则会与真实状态脱节。
 */
const SNAPSHOT_EXCLUDED_IDS = new Set([
  'settingsThemeSelect',
]);

/**
 * 快照设置面板中所有可编辑表单控件的当前值
 * @param {HTMLElement} modalContent - 设置面板的模态框内容节点
 * @returns {{fields: Object, savedAt: number}}
 */
export function snapshotSettingsForm(modalContent) {
  const snapshot = {
    fields: {},
    savedAt: Date.now(),
  };

  if (!modalContent) return snapshot;

  const elements = modalContent.querySelectorAll('input, textarea, select');
  for (const el of elements) {
    const id = el.id;
    if (!id) continue;
    if (SNAPSHOT_EXCLUDED_IDS.has(id)) continue;
    if (el.type === 'file') continue;   // file 输入无法恢复

    if (el.type === 'checkbox' || el.type === 'radio') {
      // radio 只在 checked 时记录，避免多选写回时覆盖 checked
      if (el.type === 'radio') {
        if (el.checked) {
          snapshot.fields[id] = { kind: 'radio', checked: true, value: el.value };
        }
      } else {
        snapshot.fields[id] = { kind: 'checkbox', checked: el.checked };
      }
    } else {
      snapshot.fields[id] = { kind: 'value', value: el.value };
    }
  }

  return snapshot;
}

/**
 * 将快照写回重新渲染后的设置面板
 * @param {HTMLElement} modalContent - 新的模态框内容节点
 * @param {{fields: Object}} snapshot - snapshotSettingsForm 的返回值
 */
export function restoreSettingsForm(modalContent, snapshot) {
  if (!modalContent || !snapshot || !snapshot.fields) return;

  // ============================================================
  // 预处理：按元素类型分组
  // ============================================================
  const selectEntries = [];
  const otherEntries = [];

  for (const [id, info] of Object.entries(snapshot.fields)) {
    const el = modalContent.querySelector(`#${CSS.escape(id)}`);
    if (!el) continue;
    if (el.tagName === 'SELECT') {
      selectEntries.push({ id, el, info });
    } else {
      otherEntries.push({ id, el, info });
    }
  }

  // ============================================================
  // 阶段 1：写回所有 select 的值
  // ============================================================
  for (const { el, info } of selectEntries) {
    el.value = info.value;
  }

  // ============================================================
  // 阶段 2：派发 select 的 change 事件
  // ------------------------------------------------------------
  // 为什么先派发 change：
  //   select 的 change 监听器通常联动其他 DOM（如切换显示/隐藏区域），
  //   或触发异步副作用。先派发让这些联动发生，阶段 3 再覆盖被误改的值。
  // ============================================================
  for (const { el } of selectEntries) {
    try {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
  }

  // ============================================================
  // 阶段 3：写回所有非 select 的值
  // ------------------------------------------------------------
  // 覆盖阶段 2 中 select change 监听器对其他字段的副作用。
  // 例如：settingsModelSelect 的 change 会清空 settingsModelInput，
  //       这里把用户快照的 modelInput 值重新写入。
  // ============================================================
  for (const { el, info } of otherEntries) {
    if (info.kind === 'checkbox') {
      el.checked = !!info.checked;
    } else if (info.kind === 'radio') {
      // 通过 name 定位同组，然后按 value 匹配
      if (info.checked && el.type === 'radio' && el.value === info.value) {
        el.checked = true;
      }
    } else {
      el.value = info.value;
    }
  }

  // ============================================================
  // 阶段 4：派发非 select 元素的 input 事件
  // ------------------------------------------------------------
  // 让依赖 input 事件更新其他 UI 的字段（如滑块旁的数值标签）同步。
  // 此时所有字段的值已经写回，input 监听器不会误改其他字段。
  // ============================================================
  for (const { el } of otherEntries) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) {}
  }
}