/**
 * 角色状态雷达图 - UI 入口
 *
 * 【修复记录 v2.1.0】
 *   1. 修复：点击模态框背景关闭时，订阅不会被清理、按钮会失灵的 Bug。
 *      改用轻量轮询监测模态框状态，外部关闭时自动清理。
 *   2. 修复：漏订阅 emotion:interaction 和 body:wakeup 事件，导致用户
 *      互动后雷达图不刷新。现在四个事件都订阅。
 *   3. 优化：不再用 loadCharacters() 全量刷新，改用事件 payload 中的 state，
 *      避免 IndexedDB 全表读取和全局状态重渲染。
 *   4. 优化：setupCanvasDPR 延迟到模态框动画结束后调用，避免测量到
 *      错误的 canvas 尺寸。
 *   5. 优化：复用核心的 getEmotionLabel（通过 api.emotion），与核心算法保持
 *      一致，避免两份实现漂移。
 *   6. 改进：数据缺失时显示 "—" 而非 "0"，并在模态框顶部给出警告。
 *   7. 改进：新增重绘合并（同一帧内多个事件只重绘一次）。
 *
 * 【修复记录 v2.2.0】
 *   1. 修复：群聊模式下错误展示「最后打开过的角色」状态。改为通过
 *      api.state 识别 currentMode / currentGroupId，从群成员中读取角色列表，
 *      群聊下在模态框顶部提供角色切换下拉（多角色可切换），不再沿用全局角色。
 *   2. 权限：新增 storage:indexeddb（读取群成员与角色状态所需）。
 */

export default {
  async setup(uiApi, manifest) {
    const log = uiApi.logger;
    const dom = uiApi.dom;
    log.info('UI 已加载 v' + manifest.version);

    // ============================================================
    // 状态
    // ============================================================
    let activeModalOpen = false;
    let currentCharacter = null;
    let unsubscribeFns = [];
    let modalGuardTimer = null;
    let redrawScheduled = false;

    // ============================================================
    // 注入头部按钮
    // ============================================================
    const removeSlot = uiApi.registerSlot('chat-header-actions', () => {
      const btn = dom.h('button.icon-btn.radar-plugin-btn', {
        title: '查看角色状态雷达图',
        onclick: (e) => {
          e.stopPropagation();
          openRadarModal();
        },
      });
      btn.appendChild(dom.createIcon('fa-chart-pie'));
      return btn;
    });

    log.info('已注册 chat-header-actions 槽位');

    // ============================================================
    // 打开雷达图模态框
    // ============================================================
    async function openRadarModal() {
      // 如果已经打开，先强制清理（应对上一次异常残留）
      if (activeModalOpen) {
        closeRadarModal();
        return;
      }

      const api = uiApi.api;
      if (!api) {
        uiApi.utils.showToast('插件 API 不可用', 'error');
        return;
      }

      // ---- 获取角色：单聊用当前角色；群聊从群成员中选择 ----
      const mode = api.state.get('currentMode');
      let character = null;
      let groupChars = null;
      if (mode === 'group') {
        const res = await resolveGroupCharacter(api);
        if (!res) return;            // resolveGroupCharacter 内部已提示
        groupChars = res.chars;
        character = res.selected;
      } else {
        try {
          character = await api.character.getCurrentCharacter();
        } catch (err) {
          log.error('获取角色失败:', err);
        }
        if (!character) {
          uiApi.utils.showToast('请先选择一个角色', 'warning');
          return;
        }
      }

      currentCharacter = character;

      // ---- 构建模态框 ----
      const html = buildModalHtml(character.name, groupChars, character.id);

      try {
        await uiApi.modal.open(html);
        activeModalOpen = true;
      } catch (err) {
        log.error('打开模态框失败:', err);
        uiApi.utils.showToast('打开失败: ' + err.message, 'error');
        activeModalOpen = false;
        currentCharacter = null;
        return;
      }

      // ---- 等待布局和动画完成后再测量 canvas ----
      // 模态框有 modalContentIn 0.3s 动画，动画期间 clientWidth 可能不准确。
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // 再等 100ms 确保 CSS transition 大部分已完成
            setTimeout(resolve, 100);
          });
        });
      });

      // 二次检查：等待期间用户可能已经关闭了模态框
      if (!activeModalOpen) return;

      // ---- 获取 DOM 引用 ----
      const emotionCanvas = document.getElementById('radar-emotion-canvas');
      const bodyCanvas = document.getElementById('radar-body-canvas');
      const emotionLabelEl = document.getElementById('radar-emotion-label');
      const bodyLabelEl = document.getElementById('radar-body-label');
      const detailsEl = document.getElementById('radar-details');
      const warningEl = document.getElementById('radar-warning');

      if (!emotionCanvas || !bodyCanvas) {
        log.error('模态框 DOM 未找到');
        closeRadarModal();
        return;
      }

      // ---- 群聊：绑定角色切换下拉 ----
      if (groupChars && groupChars.length > 1) {
        const sel = document.getElementById('radar-char-select');
        if (sel) {
          sel.addEventListener('change', async () => {
            const c = groupChars.find(x => x.id === sel.value);
            if (!c) return;
            currentCharacter = c;
            clearSubscriptions();
            subscribeRealtime(c.id);
            const nameEl = document.getElementById('radar-char-name');
            if (nameEl) nameEl.textContent = c.name;
            drawRadar(c, emotionCanvas, bodyCanvas, emotionLabelEl, bodyLabelEl, detailsEl, warningEl)
              .catch(err => log.warn('切换重绘失败:', err));
          });
        }
      }

      setupCanvasDPR(emotionCanvas);
      setupCanvasDPR(bodyCanvas);

      // 首次绘制（异步，因为 getEmotionLabel 走 RPC）
      await drawRadar(
        currentCharacter,
        emotionCanvas, bodyCanvas,
        emotionLabelEl, bodyLabelEl, detailsEl, warningEl
      );

      // ---- 订阅实时事件 ----
      subscribeRealtime(character.id);

      // ---- 绑定关闭按钮 ----
      const modalContent = document.getElementById('modalContent');
      const closeBtn = modalContent ? modalContent.querySelector('.modal-close') : null;
      if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.addEventListener('click', closeRadarModal);
      }

      // ---- 启动模态框守卫（应对背景点击关闭） ----
      startModalGuard();
    }

    // ============================================================
    // 模态框守卫：检测外部关闭
    // 背景点击会走 modal.js 的 closeModal()，不触发我们的回调，
    // 所以需要用轻量轮询检测模态框是否已被外部关闭。
    // ============================================================
    function startModalGuard() {
      stopModalGuard();
      modalGuardTimer = setInterval(() => {
        const overlay = document.getElementById('modalOverlay');
        const stillOpen = overlay && !overlay.classList.contains('hidden');
        if (!stillOpen && activeModalOpen) {
          log.debug('检测到模态框被外部关闭，清理资源');
          closeRadarModal();
        }
      }, 300);
    }

    function stopModalGuard() {
      if (modalGuardTimer) {
        clearInterval(modalGuardTimer);
        modalGuardTimer = null;
      }
    }

    // ============================================================
    // 构建模态框 HTML
    // ============================================================
    function buildModalHtml(characterName, groupChars, selectedId) {
      const charSelect = (groupChars && groupChars.length > 1)
        ? `
        <div style="margin: 0.2rem 0 0.7rem; text-align:center;">
          <select id="radar-char-select" style="width:100%;max-width:280px;padding:0.35rem 0.5rem;font-size:0.9rem;border-radius:var(--radius-md);border:1px solid var(--color-border);background:var(--color-bg-primary);color:var(--color-text-primary);">
            ${groupChars.map(c => `<option value="${dom.escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${dom.escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>`
        : '';
      return `
        <button class="modal-close">&times;</button>
        <h2 class="modal-title">
          <i class="fas fa-chart-pie"></i> <span id="radar-char-name">${dom.escapeHtml(characterName)}</span> - 状态雷达
        </h2>
        ${charSelect}
        <div style="padding: 0.5rem 0;">
          <div id="radar-warning" style="display:none; padding:0.4rem 0.8rem; margin-bottom:0.6rem; background:rgba(253,203,110,0.15); border-left:3px solid var(--color-warning); border-radius:4px; font-size:0.85rem; color:var(--color-text-secondary);"></div>

          <div style="text-align: center; margin-bottom: 0.8rem;">
            <div id="radar-emotion-label" style="font-size: 1.1rem; font-weight: 600; color: var(--color-primary);"></div>
            <div id="radar-body-label" style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.2rem;"></div>
          </div>

          <div style="display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center;">
            <div style="flex: 0 0 auto;">
              <div style="text-align: center; font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 0.3rem;">情感六维</div>
              <canvas id="radar-emotion-canvas" width="320" height="320" style="max-width: 100%; height: auto;"></canvas>
            </div>
            <div style="flex: 0 0 auto;">
              <div style="text-align: center; font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 0.3rem;">身体状态</div>
              <canvas id="radar-body-canvas" width="320" height="320" style="max-width: 100%; height: auto;"></canvas>
            </div>
          </div>

          <div id="radar-details" style="margin-top: 1rem; padding: 0.6rem 1rem; background: var(--color-bg-secondary); border-radius: var(--radius-md); font-size: 0.8rem; font-family: monospace; line-height: 1.7; color: var(--color-text-secondary);"></div>

          <div style="text-align: center; margin-top: 0.8rem; font-size: 0.75rem; color: var(--color-text-muted);">
            <i class="fas fa-sync-alt"></i> 实时更新中
          </div>
        </div>
      `;
    }

    // ============================================================
    // 关闭
    // ============================================================
    function closeRadarModal() {
      stopModalGuard();
      clearSubscriptions();
      activeModalOpen = false;
      currentCharacter = null;
      redrawScheduled = false;
      try { uiApi.modal.close(); } catch (_) {}
    }

    // ============================================================
    // 清理订阅
    // ============================================================
    function clearSubscriptions() {
      for (const fn of unsubscribeFns) {
        try { fn(); } catch (_) {}
      }
      unsubscribeFns = [];
    }

    // ============================================================
    // 订阅实时事件
    //
    // 关键修复：
    //   1. 补订 emotion:interaction（用户互动触发的情感变化）
    //   2. 补订 body:wakeup（被唤醒时的身体状态变化）
    //   3. 不再调用 loadCharacters()，直接用 payload.state 更新本地副本
    // ============================================================
    function subscribeRealtime(characterId) {
      const api = uiApi.api;
      if (!api || !api.events) return;

      // 统一的 handler：只关心当前角色的事件，且直接消费 payload.state
      const makeHandler = (stateField) => (payload) => {
        if (!payload) return;
        if (payload.characterId !== characterId) return;
        if (!currentCharacter) return;

        // payload.state 是完整的 emotionState 或 bodyState 对象
        // 直接更新本地副本，避免全量读取 IndexedDB
        if (payload.state) {
          currentCharacter = { ...currentCharacter, [stateField]: payload.state };
        }
        scheduleRedraw();
      };

      const emotionHandler = makeHandler('emotionState');
      const bodyHandler = makeHandler('bodyState');

      // 情感：时间驱动 + 用户互动驱动
      try {
        const unsub = api.events.on('emotion:updated', emotionHandler);
        if (typeof unsub === 'function') unsubscribeFns.push(unsub);
      } catch (err) {
        log.warn('emotion:updated 订阅失败:', err);
      }
      try {
        const unsub = api.events.on('emotion:interaction', emotionHandler);
        if (typeof unsub === 'function') unsubscribeFns.push(unsub);
      } catch (err) {
        log.warn('emotion:interaction 订阅失败:', err);
      }

      // 身体：时间驱动 + 唤醒事件
      try {
        const unsub = api.events.on('body:updated', bodyHandler);
        if (typeof unsub === 'function') unsubscribeFns.push(unsub);
      } catch (err) {
        log.warn('body:updated 订阅失败:', err);
      }
      try {
        const unsub = api.events.on('body:wakeup', bodyHandler);
        if (typeof unsub === 'function') unsubscribeFns.push(unsub);
      } catch (err) {
        log.warn('body:wakeup 订阅失败:', err);
      }
    }

    // ============================================================
    // 重绘调度：合并同一帧内的多个事件
    // ============================================================
    function scheduleRedraw() {
      if (redrawScheduled) return;
      redrawScheduled = true;
      requestAnimationFrame(() => {
        redrawScheduled = false;
        if (!activeModalOpen || !currentCharacter) return;

        const emotionCanvas = document.getElementById('radar-emotion-canvas');
        const bodyCanvas = document.getElementById('radar-body-canvas');
        const emotionLabelEl = document.getElementById('radar-emotion-label');
        const bodyLabelEl = document.getElementById('radar-body-label');
        const detailsEl = document.getElementById('radar-details');
        const warningEl = document.getElementById('radar-warning');

        if (!emotionCanvas || !bodyCanvas) return;

        drawRadar(
          currentCharacter,
          emotionCanvas, bodyCanvas,
          emotionLabelEl, bodyLabelEl, detailsEl, warningEl
        ).catch((err) => log.warn('重绘失败:', err));
      });
    }

    // ============================================================
    // 绘制雷达图（异步，因为需要 RPC 调用 getEmotionLabel）
    // ============================================================
    async function drawRadar(character, emotionCanvas, bodyCanvas, emotionLabelEl, bodyLabelEl, detailsEl, warningEl) {
      const emotion = character.emotionState || {};
      const body = character.bodyState || {};

      // ---- 数据完整性检查 ----
      const hasEmotion = character.emotionState && typeof character.emotionState.valence === 'number';
      const hasBody = character.bodyState && typeof character.bodyState.energy === 'number';

      if (warningEl) {
        if (!hasEmotion || !hasBody) {
          warningEl.style.display = 'block';
          warningEl.innerHTML =
            '<i class="fas fa-exclamation-triangle"></i> ' +
            '角色状态数据缺失。请与角色互动一次，或切换到该角色后再打开此面板。';
        } else {
          warningEl.style.display = 'none';
        }
      }

      const emotionDims = [
        { label: '愉悦', value: emotion.valence,    min: -100, max: 100 },
        { label: '唤醒', value: emotion.arousal,    min: -100, max: 100 },
        { label: '支配', value: emotion.dominance,  min: -100, max: 100 },
        { label: '关注', value: emotion.attention,  min: -100, max: 100 },
        { label: '意外', value: emotion.surprise,   min: -100, max: 100 },
        { label: '精力', value: emotion.energy,     min: -100, max: 100 },
      ];

      const bodyDims = [
        { label: '精力', value: body.energy,        min: 0, max: 100 },
        { label: '睡意', value: body.sleepiness,    min: 0, max: 100 },
        { label: '健康', value: body.health,        min: 0, max: 100 },
        { label: '好感', value: emotion.affection,  min: -100, max: 100 },
        { label: '信任', value: emotion.trust,      min: 0, max: 100 },
        { label: '亲密', value: emotion.intimacy,   min: 0, max: 100 },
      ];

      drawRadarOnCanvas(emotionCanvas, emotionDims, 'rgba(108, 92, 231, 0.25)', '#6c5ce7');
      drawRadarOnCanvas(bodyCanvas, bodyDims, 'rgba(0, 184, 148, 0.25)', '#00b894');

      // ---- 情感标签：优先复用核心算法，失败时回退到简化版 ----
      if (emotionLabelEl) {
        let label = '—';
        try {
          const coreLabel = await uiApi.api.emotion.getEmotionLabel(emotion);
          if (coreLabel) label = coreLabel;
        } catch (err) {
          log.debug('调用核心 getEmotionLabel 失败，使用简化版:', err.message);
          label = getEmotionLabelFallback(emotion);
        }
        emotionLabelEl.textContent = label;
      }

      if (bodyLabelEl) {
        const sleep = body.sleepStatus || '—';
        const consciousness = body.consciousness || '—';
        bodyLabelEl.textContent = sleep + ' · ' + consciousness;
      }

      // ---- 详细文本面板 ----
      if (detailsEl) {
        const lines = [];
        lines.push('情感: 愉悦 ' + fmt(emotion.valence) + ' | 唤醒 ' + fmt(emotion.arousal) + ' | 支配 ' + fmt(emotion.dominance));
        lines.push('     关注 ' + fmt(emotion.attention) + ' | 意外 ' + fmt(emotion.surprise) + ' | 精力 ' + fmt(emotion.energy));
        lines.push('关系: 好感 ' + fmt(emotion.affection) + ' | 信任 ' + fmt(emotion.trust) + ' | 亲密 ' + fmt(emotion.intimacy));
        lines.push('身体: 精力 ' + fmt(body.energy) + ' | 睡意 ' + fmt(body.sleepiness) + ' | 健康 ' + fmt(body.health));
        if (body.specialStates && body.specialStates.length > 0) {
          lines.push('状态: ' + body.specialStates.join(', '));
        }
        if (body.illness && body.illness.type) {
          lines.push('疾病: ' + body.illness.type + ' (严重度 ' + Math.round(body.illness.severity) + ')');
        }
        if (body.injury && body.injury.type) {
          lines.push('受伤: ' + body.injury.type + ' (严重度 ' + Math.round(body.injury.severity) + ')');
        }
        detailsEl.innerHTML = lines.map(l => dom.escapeHtml(l)).join('<br>');
      }
    }

    // ============================================================
    // Canvas 绘制
    // ============================================================
    function drawRadarOnCanvas(canvas, dimensions, fillColor, strokeColor) {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.clientWidth || 320;
      const height = canvas.clientHeight || 320;

      // 注意：canvas 的 CSS 尺寸和画布尺寸由 setupCanvasDPR 处理，
      // 这里用 ctx 的坐标系（已经是 CSS 像素，因为有 ctx.scale(dpr, dpr)）
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) / 2 - 45;
      const n = dimensions.length;
      const angleStep = (Math.PI * 2) / n;
      const startAngle = -Math.PI / 2;

      const borderColor = dom.cssVar('--color-border', '#e0e0e6');
      const textColor = dom.cssVar('--color-text-secondary', '#4a4a6a');

      // 网格圈
      for (let level = 1; level <= 5; level++) {
        const r = (radius * level) / 5;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const angle = startAngle + angleStep * i;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 轴线
      for (let i = 0; i < n; i++) {
        const angle = startAngle + angleStep * i;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 标签
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const angle = startAngle + angleStep * i;
        const lx = cx + Math.cos(angle) * (radius + 22);
        const ly = cy + Math.sin(angle) * (radius + 22);
        ctx.fillText(dimensions[i].label, lx, ly);
      }

      // 数据点（缺失值不参与绘制，按 0 处理仅用于显示多边形形状）
      const points = dimensions.map((dim, i) => {
        const raw = dim.value;
        const value = (typeof raw === 'number' && !isNaN(raw)) ? raw : 0;
        const ratio = (value - dim.min) / (dim.max - dim.min);
        const normalized = Math.max(0, Math.min(1, ratio));
        const r = radius * normalized;
        const angle = startAngle + angleStep * i;
        return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, missing: typeof raw !== 'number' || isNaN(raw) };
      });

      // 数据多边形
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const p = points[i];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 数据点：缺失值用空心圈表示
      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        if (p.missing) {
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#aaaaaa';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = strokeColor;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // ============================================================
    // 工具函数
    // ============================================================
    function setupCanvasDPR(canvas) {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth || parseInt(canvas.getAttribute('width')) || 320;
      const cssHeight = canvas.clientHeight || parseInt(canvas.getAttribute('height')) || 320;
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = cssHeight + 'px';
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // 重置变换，避免多次调用时 scale 累积
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
    }

    function fmt(value) {
      if (value === undefined || value === null) return '—';
      const n = Number(value);
      return isNaN(n) ? '—' : Math.round(n).toString();
    }

    /**
     * getEmotionLabel 的简化回退版。
     *
     * 正常情况下会通过 api.emotion.getEmotionLabel() 调用核心实现，
     * 只有在 RPC 失败时才使用这个本地版本。
     *
     * ⚠️ 这里刻意保持简单，不要把它当作完整算法。核心算法见 emotionEngine.js。
     */
    function getEmotionLabelFallback(state) {
      if (!state) return '—';
      const v = state.valence || 0;
      const a = state.arousal || 0;
      const aff = state.affection || 0;
      if (v > 50 && a > 30) return '兴奋';
      if (v < -50 && a > 50) return '愤怒';
      if (v < -30 && a < -20) return '悲伤';
      if (v > 30 && aff > 50) return '爱慕';
      if (v > 30 && a < -20) return '平静愉悦';
      if (v < -20) return '低落';
      if (v > 20) return '愉快';
      return '中性';
    }

    // ============================================================
    // 群聊角色解析
    //   进群聊后全局 currentCharacter 被置空，不能再用它；
    //   改为从群成员中读取角色列表，让用户明确选择要查看的状态。
    // ============================================================
    async function resolveGroupCharacter(api) {
      const groupId = api.state.get('currentGroupId');
      if (!groupId) {
        uiApi.utils.showToast('群聊上下文缺失', 'warning');
        return null;
      }

      let stores;
      try {
        stores = await api.db.getStores();
      } catch (err) {
        log.error('读取群组存储失败:', err);
        uiApi.utils.showToast('无法读取群组数据', 'error');
        return null;
      }

      let members = [];
      try {
        members = await stores.group_members.getByIndex('groupId', groupId);
      } catch (err) {
        log.error('读取群成员失败:', err);
        uiApi.utils.showToast('无法读取群成员', 'error');
        return null;
      }

      const charIds = [];
      for (const m of members) {
        if (m.memberType === 'character') {
          const id = (m.character && m.character.id) || m.memberId;
          if (id) charIds.push(id);
        }
      }

      const chars = [];
      for (const id of charIds) {
        try {
          const c = await stores.characters.get(id);
          if (c) chars.push(c);
        } catch (_) { /* 忽略单个读取失败 */ }
      }

      if (chars.length === 0) {
        uiApi.utils.showToast('群聊中暂无可查看的角色', 'warning');
        return null;
      }

      return { chars, selected: chars[0] };
    }

    // ============================================================
    // teardown
    // ============================================================
    return async function teardown() {
      if (removeSlot) removeSlot();
      closeRadarModal();
      log.info('UI 已卸载');
    };
  },
};