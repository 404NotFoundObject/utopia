// js/dev/engineMonitor.js - 开发者监控模块
// 用途：订阅引擎事件、拦截 API 调用、记录副作用变化，辅助验证引擎执行路径
// 加载：默认关闭，通过 localStorage 'utopia:dev-monitor' = 'on' 开启自动启动
// 控制：window.__engineMonitor.{start,stop,report,clear,snapshot,diff,setVerbose}

const ENGINE_EVENTS = [
  'emotion:interaction', 'emotion:updated',
  'body:updated', 'body:wakeup',
  'time:updated', 'time:advanced', 'time:reset',
  'memory:vector-init-done',
  'worldbook:rule-triggered',
  'worldbook:rule-added', 'worldbook:rule-updated', 'worldbook:rule-deleted',
  'worldbook:vectors-synced',
  'injector:rule-triggered', 'injector:worldbook-updated', 'injector:error',
  'injector:delayed-ready',
  'message:before-send', 'message:received',
  'character:switched',
  'group:created', 'group:message',
  'group:member-added', 'group:member-removed',
  'group:member-muted', 'group:member-unmuted',
  'proactive:new', 'voice:call-ended',
  'plugin:enabled', 'plugin:disabled',
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
function _summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = {};
  if (payload.characterId) out.角色 = payload.characterId.slice(0, 8);
  if (payload.ruleId) out.规则 = payload.ruleId.slice(0, 8);
  if (payload.groupId) out.群组 = payload.groupId.slice(0, 8);
  if (payload.eventType) out.事件 = payload.eventType;
  if (payload.intensity !== undefined) out.强度 = Number(payload.intensity).toFixed(2);
  if (payload.type) out.类型 = payload.type;
  if (payload.content) out.内容 = String(payload.content).slice(0, 40);
  if (payload.ready !== undefined) out.就绪 = payload.ready;
  if (payload.model) out.模型 = payload.model;
  if (payload.updated !== undefined) out.更新 = payload.updated;
  if (payload.skipped !== undefined) out.跳过 = payload.skipped;
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

const monitor = {
  start,
  stop,
  report,
  clear,
  snapshot,
  diff,
  setVerbose,
  get state() { return _state; },
};

if (typeof window !== 'undefined') {
  window.__engineMonitor = monitor;
}

export default monitor;