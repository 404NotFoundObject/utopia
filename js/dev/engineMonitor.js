// js/dev/engineMonitor.js - 开发者监控模块
// 用途：订阅引擎事件、拦截 API 调用、记录副作用变化，辅助验证引擎执行路径
// 加载：默认关闭。通过设置里的「开发者工具 → 引擎监控」开关启用（写入 localStorage
//       'utopia:dev-monitor' = 'on'，app.js 启动时据此自动挂载），也可用控制台开启。
// 控制：window.__engineMonitor.{start,stop,report,clear,snapshot,diff,setVerbose}

// ★ 订阅清单。改动引擎事件时请同步这里，否则开发者工具会出现盲区。
//   维护约定：以 `globalEventBus.emit('…')` 为准，新增事件必须登记；
//   注入器侧三个事件由底层库 lib/context-injector-core.js 直接发出。
const ENGINE_EVENTS = [
  // ---------- 引擎 ----------
  'emotion:interaction', 'emotion:updated',
  'body:updated', 'body:wakeup', 'body:injury',
  'time:updated', 'time:advanced', 'time:reset',
  'memory:vector-init-done',
  // ---------- 世界书（含组级增删改与导入导出）----------
  'worldbook:rule-added', 'worldbook:rule-updated', 'worldbook:rule-deleted', 'worldbook:rule-toggled',
  'worldbook:group-added', 'worldbook:group-updated', 'worldbook:group-deleted', 'worldbook:group-toggled',
  'worldbook:rules-imported', 'worldbook:groups-imported',
  'worldbook:vectors-synced',
  // ---------- 注入器（底层库直接发出）----------
  'injector:rule-triggered', 'injector:worldbook-updated', 'injector:error', 'injector:delayed-ready',
  // ---------- 消息 / 角色 ----------
  'message:before-send', 'message:received',
  'character:switched',
  // ---------- 群聊（含解散）----------
  'group:created', 'group:disbanded', 'group:message',
  'group:member-added', 'group:member-removed',
  'group:member-muted', 'group:member-unmuted',
  // ---------- 主动对话 / 语音 ----------
  'proactive:new', 'voice:call-ended',
  // ---------- 插件（含配置变更）----------
  'plugin:enabled', 'plugin:disabled', 'plugin:config-changed',
  // ---------- 主题 / 应用 ----------
  'theme:changed',
  'app:started', 'settings:updated',
];

const API_URL_PATTERN = /chat\/completions|\/v1\/messages|generateContent|api\/chat/;

const _state = {
  active: false,
  unsubscribers: [],
  originalFetch: null,
  eventLog: [],
  apiLog: [],
  stats: {},
  verbose: true,
  maxLog: 500,
  snapshot: null,
};

// ---------- 事件订阅 ----------
function _brief(v, n = 8) {
  if (v === null || v === undefined) return v;
  return String(v).slice(0, n);
}

function _summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = {};
  if (payload.characterId) out.角色 = _brief(payload.characterId);
  if (payload.ruleId) out.规则 = _brief(payload.ruleId);
  if (payload.groupId) out.群组 = _brief(payload.groupId);
  if (payload.pluginId) out.插件 = _brief(payload.pluginId, 16);
  if (payload.key) out.配置项 = payload.key;
  if (payload.themeId) out.主题 = _brief(payload.themeId, 16);
  if (payload.eventType) out.事件 = payload.eventType;
  if (payload.intensity !== undefined) out.强度 = Number(payload.intensity).toFixed(2);
  if (payload.type) out.类型 = payload.type;
  if (payload.content) out.内容 = _brief(payload.content, 40);
  if (payload.ready !== undefined) out.就绪 = payload.ready;
  if (payload.model) out.模型 = payload.model;
  if (payload.updated !== undefined) out.更新 = payload.updated;
  if (payload.skipped !== undefined) out.跳过 = payload.skipped;
  if (payload.editedDuringSync !== undefined) out.编辑跳过 = payload.editedDuringSync;
  // worldbook:rule-*/group-* 携带完整对象，取名称便于人读
  if (payload.rule?.name) out.规则名 = _brief(payload.rule.name, 16);
  if (payload.group?.name) out.组名 = _brief(payload.group.name, 16);
  if (payload.id) out.Id = _brief(payload.id);
  // body:injury 携带受伤对象
  if (payload.injury?.type) out.伤势 = payload.injury.type;
  if (payload.injury?.location) out.部位 = payload.injury.location;
  // worldbook:*-imported 返回条数
  if (payload.count !== undefined) out.数量 = payload.count;
  // time:advanced 记录推进量（游戏毫秒）
  if (payload.delta !== undefined) out.推进 = `${Math.round(payload.delta / 60000)}分`;
  // voice:call-ended
  if (payload.reason) out.原因 = payload.reason;
  if (payload.duration !== undefined) out.时长秒 = payload.duration;
  return out;
}

function _subscribeEvents() {
  const bus = window.__eventBus;
  if (!bus) {
    console.warn('[Monitor] 事件总线未就绪');
    return;
  }
  for (const name of ENGINE_EVENTS) {
    const unsub = bus.on(name, (payload) => {
      _state.stats[name] = (_state.stats[name] || 0) + 1;
      const entry = {
        time: new Date().toLocaleTimeString(),
        event: name,
        payload: _summarizePayload(payload),
      };
      _state.eventLog.push(entry);
      if (_state.eventLog.length > _state.maxLog) _state.eventLog.shift();

      if (_state.verbose) {
        console.log(
          `%c⚡ ${name}`,
          'color:#fff;background:#6c5ce7;padding:1px 4px;border-radius:3px;',
          entry.payload
        );
      }
    });
    _state.unsubscribers.push(unsub);
  }
}

// ---------- Fetch 拦截 ----------
function _installFetchHook() {
  if (_state.originalFetch) return;
  _state.originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const [url, opts] = args;
    if (typeof url === 'string' && API_URL_PATTERN.test(url) && opts && opts.body) {
      try {
        const body = JSON.parse(opts.body);
        const messages = body.messages || body.contents || [];
        const entry = {
          time: new Date().toLocaleTimeString(),
          url,
          model: body.model,
          messageCount: messages.length,
          system: body.system || null,
          temperature: body.temperature,
          max_tokens: body.max_tokens,
          messages: messages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          })),
        };
        _state.apiLog.push(entry);
        if (_state.apiLog.length > _state.maxLog) _state.apiLog.shift();

        if (_state.verbose) {
          console.log(
            `%c📤 API ${entry.messageCount} 条 [${entry.model || '未知'}]`,
            'color:#fff;background:#e17055;padding:1px 4px;border-radius:3px;'
          );
          console.table(entry.messages.map(m => ({
            role: m.role,
            preview: m.content.slice(0, 80),
          })));
        }
      } catch (_) {}
    }
    return _state.originalFetch.apply(this, args);
  };
}

function _uninstallFetchHook() {
  if (_state.originalFetch) {
    window.fetch = _state.originalFetch;
    _state.originalFetch = null;
  }
}

// ---------- 快照对比 ----------
async function snapshot() {
  const char = await import('/js/modules/character.js');
  const c = char.getCurrentCharacter();
  if (!c) {
    console.warn('[Monitor] 未选择角色');
    return null;
  }
  _state.snapshot = {
    time: new Date().toLocaleTimeString(),
    角色: c.name,
    valence: c.emotionState?.valence,
    arousal: c.emotionState?.arousal,
    affection: c.emotionState?.affection,
    trust: c.emotionState?.trust,
    intimacy: c.emotionState?.intimacy,
    energy: c.bodyState?.energy,
    sleepiness: c.bodyState?.sleepiness,
    health: c.bodyState?.health,
    sleepStatus: c.bodyState?.sleepStatus,
    consciousness: c.bodyState?.consciousness,
    lastInteraction: c.lastInteraction?.gameTime,
  };
  console.log('[Monitor] 已快照:', _state.snapshot);
  return _state.snapshot;
}

async function diff() {
  if (!_state.snapshot) {
    console.warn('[Monitor] 先执行 snapshot()');
    return null;
  }
  const char = await import('/js/modules/character.js');
  const c = char.getCurrentCharacter();
  if (!c) {
    console.warn('[Monitor] 未选择角色');
    return null;
  }
  const after = {
    valence: c.emotionState?.valence,
    arousal: c.emotionState?.arousal,
    affection: c.emotionState?.affection,
    trust: c.emotionState?.trust,
    intimacy: c.emotionState?.intimacy,
    energy: c.bodyState?.energy,
    sleepiness: c.bodyState?.sleepiness,
    health: c.bodyState?.health,
    sleepStatus: c.bodyState?.sleepStatus,
    consciousness: c.bodyState?.consciousness,
    lastInteraction: c.lastInteraction?.gameTime,
  };
  const before = _state.snapshot;
  const result = {};
  for (const k of Object.keys(after)) {
    const b = before[k];
    const a = after[k];
    if (b !== a) {
      result[k] = {
        前: b,
        后: a,
        Δ: typeof a === 'number' && typeof b === 'number' ? (a - b).toFixed(2) : '—',
      };
    }
  }
  console.log(`[Monitor] ${before.time} → ${new Date().toLocaleTimeString()} 差异:`);
  if (Object.keys(result).length === 0) {
    console.warn('⚠️ 所有字段未变化');
  } else {
    console.table(result);
  }
  return result;
}

// ---------- 报告与清理 ----------
function report() {
  console.group('[Monitor] 报告');
  console.log('事件统计:');
  console.table(Object.entries(_state.stats).map(([k, v]) => ({ 事件: k, 次数: v })));
  console.log(`事件日志: ${_state.eventLog.length} 条（window.__engineMonitor.state.eventLog）`);
  console.log(`API 日志: ${_state.apiLog.length} 条（window.__engineMonitor.state.apiLog）`);
  console.groupEnd();
}

function clear() {
  _state.eventLog = [];
  _state.apiLog = [];
  _state.stats = {};
  _state.snapshot = null;
  console.log('[Monitor] 已清空');
}

function setVerbose(on) {
  _state.verbose = !!on;
  console.log(`[Monitor] 详细日志 = ${_state.verbose}`);
}

// ---------- 生命周期 ----------
function start() {
  if (_state.active) {
    console.log('[Monitor] 已激活');
    return;
  }
  _state.active = true;
  _subscribeEvents();
  _installFetchHook();
  console.log(
    '%c🛠️ Engine Monitor 已启动',
    'color:#00b894;font-weight:bold;font-size:14px;'
  );
  console.log('命令：');
  console.log('  __engineMonitor.report()          统计报告');
  console.log('  __engineMonitor.snapshot()        记录当前角色状态');
  console.log('  __engineMonitor.diff()            与快照对比');
  console.log('  __engineMonitor.clear()           清空日志');
  console.log('  __engineMonitor.setVerbose(false) 静默模式');
  console.log('  __engineMonitor.stop()            关闭');
}

function stop() {
  if (!_state.active) return;
  _state.active = false;
  for (const unsub of _state.unsubscribers) {
    try { unsub(); } catch (_) {}
  }
  _state.unsubscribers = [];
  _uninstallFetchHook();
  console.log('[Monitor] 已停止');
}

// ---------- 设置开关联动 ----------
const STORAGE_KEY = 'utopia:dev-monitor';

/**
 * 按设置里的开关同步监控状态（供设置页保存时调用）。
 * 开启 → 写入 localStorage 并立即 start（下次启动也会自动挂载）；
 * 关闭 → 写入 localStorage 并 stop（恢复原生 fetch、取消全部订阅）。
 * @param {boolean} enabled
 * @returns {boolean} 生效后的状态
 */
function applyEnabled(enabled) {
  const on = !!enabled;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch (_) { /* 隐私模式下 localStorage 可能不可用，忽略即可 */ }
  if (on) {
    start();
  } else {
    stop();
  }
  return on;
}

const monitor = {
  start,
  stop,
  report,
  clear,
  snapshot,
  diff,
  setVerbose,
  applyEnabled,
  get state() { return _state; },
};

if (typeof window !== 'undefined') {
  window.__engineMonitor = monitor;
}

export default monitor;
export { applyEnabled };