/**
 * @module commandEngine
 * @description 输入框命令引擎 - 解析和执行以 / 开头的特殊命令
 */

import { getAppState } from '../core/state.js';
import { getCurrentCharacter } from './character.js';
import { searchMemories, getMemoriesByCharacter, deleteMemory } from './memory.js';
import { getEmotionLabel } from './emotionEngine.js';
import { showBanner } from '../ui/components/banner.js';
import { appendConsoleMessage } from '../ui/components/console.js';
import * as social from './social.js';
import { getStores } from '../core/db.js';
import {
  getEffectiveParams,
  getTempParams,
  setTempParam,
  resetTempParams,
} from '../core/runtimeParams.js';

// 兼容旧调用方：从 commandEngine 导入 getEffectiveParams / getTempParams 仍可用
// 直接 re-export 本地绑定，避免从同一模块做两次解析
export { getEffectiveParams, getTempParams };

// ============================================================
// 命令注册表
// ============================================================
const commands = new Map();
const aliases = new Map();

/**
 * 注册命令
 */
export function registerCommand(name, handler, options = {}) {
  commands.set(name, { handler, description: options.description || '' });
  if (options.aliases) {
    for (const alias of options.aliases) {
      aliases.set(alias, name);
    }
  }
}

/**
 * 获取所有命令列表（用于 /help）
 */
export function getCommandList() {
  const result = [];
  for (const [name, cmd] of commands) {
    if (aliases.has(name)) continue;
    result.push({ name, description: cmd.description });
  }
  return result;
}

/**
 * 执行命令
 */
export async function executeCommand(input, context) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const rawCmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  let cmdName = aliases.get(rawCmd) || rawCmd;
  const cmd = commands.get(cmdName);

  if (!cmd) {
    const msg = `❌ 未知命令: /${rawCmd}，输入 /help 查看可用命令`;
    appendConsoleMessage(msg, 'error');
    return {
      handled: true,
      banner: msg,
    };
  }

  try {
    const result = await cmd.handler(args, context);
    if (result && typeof result === 'object') {
      if (result.console) {
        appendConsoleMessage(result.console, result.consoleType || 'info');
      }
      if (result.banner) {
        showBanner(result.banner, 4000, result.banner.includes('❌') ? 'error' : 'info');
      }
      return { handled: true, result };
    }
    return { handled: true, banner: '✅ 命令执行成功' };
  } catch (error) {
    console.error('[CommandEngine] 命令执行失败:', error);
    const msg = `❌ 命令执行失败: ${error.message || error}`;
    appendConsoleMessage(msg, 'error');
    return {
      handled: true,
      banner: msg,
    };
  }
}

// ============================================================
// 辅助函数
// ============================================================

function renderScoreBar(score) {
  const total = 10;
  const filled = Math.round(Math.max(0, Math.min(1, score)) * total);
  return '█'.repeat(filled) + '░'.repeat(total - filled);
}

function safeNum(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ============================================================
// 基础命令
// ============================================================

// /help
registerCommand('help', async (args, context) => {
  const list = getCommandList();
  const lines = list.map(c => `  /${c.name} — ${c.description}`);
  const output = `📖 可用命令：\n${lines.join('\n')}`;
  return {
    console: output,
    consoleType: 'info',
    banner: '📖 命令列表已输出到控制台',
  };
}, { description: '显示所有可用命令' });

// /inject
registerCommand('inject', async (args, context) => {
  if (!args.trim()) {
    return {
      banner: '❌ 用法: /inject <要注入的提示词内容>',
      console: '❌ 用法: /inject <要注入的提示词内容>',
      consoleType: 'error',
    };
  }
  const state = getAppState();
  state.set('pendingInjection', args.trim());
  const preview = args.trim().length > 30 ? args.trim().slice(0, 30) + '...' : args.trim();
  return {
    banner: `✅ 注入内容已保存，将在下一条消息中生效（一次性）\n💡 内容: ${preview}`,
    console: `✅ 注入内容已保存：\n${args.trim()}\n\n⚠️ 此注入为一次性，发送下一条消息后自动清除（无论成功失败）`,
    consoleType: 'success',
  };
}, { description: '一次性注入提示词到下一轮对话', aliases: ['i'] });

// /print
registerCommand('print', async (args, context) => {
  const state = getAppState();
  const mode = state.get('currentMode') || 'chat';
  const lines = [];

  if (mode === 'group' && context.group) {
    const group = context.group;
    lines.push(`👥 群组: ${group.name}`);
    lines.push(`📝 描述: ${group.description || '无'}`);
    lines.push(`👤 成员数: ${group.memberCount || 0}`);
    lines.push(`📊 活跃度: ${group.activeLevel || '正常'}`);
    if (group.members) {
      const memberList = group.members.split('、').slice(0, 5).join('、');
      lines.push(`👥 成员: ${memberList}${group.members.split('、').length > 5 ? ' 等' : ''}`);
    }
    lines.push(`📖 群规则: ${group.rules || '未设置'}`);
    try {
      const { getEnabledRules } = await import('./worldBook.js');
      const rules = await getEnabledRules({ groupId: context.groupId });
      lines.push(`📖 群生效世界书规则: ${rules.length} 条`);
    } catch (e) {
      lines.push(`📖 群生效世界书规则: 获取失败`);
    }
  } else {
    const char = context.character || getCurrentCharacter();
    if (char) {
      lines.push(`📛 角色: ${char.name}`);
      lines.push(`❤️ 关系: ${char.relationship || '未设置'}`);
      if (char.emotionState) {
        lines.push(`😊 情感: ${getEmotionLabel(char.emotionState)}`);
        lines.push(`  愉悦:${Math.round(char.emotionState.valence)} 唤醒:${Math.round(char.emotionState.arousal)} 好感:${Math.round(char.emotionState.affection)}`);
      }
      if (char.bodyState) {
        lines.push(`⚡ 精力:${Math.round(char.bodyState.energy)} 睡意:${Math.round(char.bodyState.sleepiness)} 健康:${Math.round(char.bodyState.health)}`);
        if (char.bodyState.sleepStatus !== '清醒') {
          lines.push(`😴 睡眠: ${char.bodyState.sleepStatus}`);
        }
      }
    } else {
      lines.push(`📛 未选择角色`);
    }

    const pending = state.get('pendingInjection');
    if (pending) {
      lines.push(`📝 待注入: ${pending.length > 30 ? pending.slice(0, 30) + '...' : pending}`);
    }

    try {
      const { getEnabledRules } = await import('./worldBook.js');
      const rules = await getEnabledRules(char ? { characterId: char.id } : null);
      lines.push(`📖 世界书规则: ${rules.length} 条生效`);
    } catch (e) {
      lines.push(`📖 世界书: 加载失败`);
    }

    if (char) {
      try {
        const memories = await searchMemories(char.id, '', 1000);
        lines.push(`🧠 记忆条目: ${memories.length}`);
      } catch (e) {}
    }
  }

  const settings = state.get('settings') || {};
  const provider = settings.apiProvider || 'openai';
  const model = settings.modelName || '未设置';
  lines.push(`🤖 厂商: ${provider} | 模型: ${model}`);
  lines.push(`📌 模式: ${mode === 'group' ? '群聊' : '单聊'}`);

  const output = lines.join('\n');
  return {
    console: output,
    consoleType: 'info',
    banner: '📋 环境信息已输出到控制台',
  };
}, { description: '打印当前环境信息（角色/群组状态、模型、规则等）' });

// /model
registerCommand('model', async (args, context) => {
  const state = getAppState();
  const settings = state.get('settings') || {};
  const provider = settings.apiProvider || 'openai';
  const model = settings.modelName || '未设置';
  const baseUrl = settings.apiBaseUrl || '默认';
  const output = `🤖 厂商: ${provider} | 模型: ${model} | Base URL: ${baseUrl}`;
  return {
    console: output,
    consoleType: 'info',
    banner: '🤖 模型信息已输出到控制台',
  };
}, { description: '显示当前使用的厂商和模型', aliases: ['m'] });

// /clear
registerCommand('clear', async (args, context) => {
  const container = document.getElementById('chatMessages');
  if (container) {
    container.innerHTML = '';
    container.className = '';
  }
  return { banner: '🧹 聊天容器已清空（历史记录未删除）' };
}, { description: '清空聊天容器（不删除历史记录）' });

// /reset
registerCommand('reset', async (args, context) => {
  const { resetInjectorState } = await import('./injector.js');
  resetInjectorState();
  const state = getAppState();
  state.set('pendingInjection', null);
  return {
    banner: '🔄 注入器状态已重置（粘性规则、待注入等已清除）',
    console: '🔄 注入器状态已重置',
    consoleType: 'success',
  };
}, { description: '重置注入器状态（清除粘性规则和待注入）' });

// /time（增强版：查看 + 控制）
registerCommand('time', async (args, context) => {
  const {
    getGameDate, getTimeSpeed, isTimePaused, getGameTime,
    setTimeSpeed, setTimePaused, advanceGameTime, resetGameTime,
  } = await import('./time.js');

  const parts = args.trim().split(/\s+/);
  const subCmd = (parts[0] || '').toLowerCase();
  const value = parts[1] || '';

  // ---- 无参数：查看 ----
  if (!subCmd) {
    const date = getGameDate();
    const speed = getTimeSpeed();
    const paused = isTimePaused();
    const timeStr = date.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const output =
      `⏰ 游戏时间: ${timeStr} | 流速: ${speed}x | ${paused ? '⏸️ 暂停中' : '▶️ 运行中'}\n\n` +
      `子命令:\n` +
      `  /time speed <1-48>   — 设置流速\n` +
      `  /time pause          — 暂停\n` +
      `  /time resume         — 恢复\n` +
      `  /time set HH:MM      — 设置到指定时刻\n` +
      `  /time advance <小时> — 推进 N 小时\n` +
      `  /time reset          — 重置为现实时间`;
    return {
      console: output,
      consoleType: 'info',
      banner: '⏰ 时间信息已输出到控制台',
    };
  }

  // ---- /time speed <n> ----
  if (subCmd === 'speed') {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1 || n > 48) {
      return {
        banner: '❌ 流速必须在 1 ~ 48 之间',
        console: '❌ 用法: /time speed <1-48>',
        consoleType: 'error',
      };
    }
    await setTimeSpeed(n);
    return {
      banner: `⏰ 时间流速已设为 ${n}x`,
      console: `⏰ 时间流速: ${n}x`,
      consoleType: 'success',
    };
  }

  // ---- /time pause ----
  if (subCmd === 'pause') {
    await setTimePaused(true);
    return {
      banner: '⏸️ 时间已暂停',
      console: '⏸️ 游戏时间已暂停，不再流动。',
      consoleType: 'success',
    };
  }

  // ---- /time resume ----
  if (subCmd === 'resume') {
    await setTimePaused(false);
    return {
      banner: '▶️ 时间已恢复',
      console: '▶️ 游戏时间已恢复流动。',
      consoleType: 'success',
    };
  }

  // ---- /time set HH:MM ----
  if (subCmd === 'set') {
    const m = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
      return {
        banner: '❌ 用法: /time set HH:MM（如 22:30）',
        console: '❌ 用法: /time set HH:MM，例如 /time set 22:30',
        consoleType: 'error',
      };
    }
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      return {
        banner: '❌ 时间格式错误（小时 0-23，分钟 0-59）',
        console: '❌ 时间格式错误',
        consoleType: 'error',
      };
    }

    const now = getGameTime();
    const target = new Date(now);
    target.setHours(hh, mm, 0, 0);
    // 若目标时刻早于当前，则视为"明天的 HH:MM"
    if (target.getTime() <= now) {
      target.setDate(target.getDate() + 1);
    }

    const delta = target.getTime() - now;
    advanceGameTime(delta);
    const deltaHours = (delta / 1000 / 60 / 60).toFixed(1);

    return {
      banner: `⏰ 游戏时间已设为 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      console:
        `⏰ 游戏时间已调整到: ${target.toLocaleString('zh-CN')}\n` +
        `推进了 ${deltaHours} 小时`,
      consoleType: 'success',
    };
  }

  // ---- /time advance <小时> ----
  if (subCmd === 'advance') {
    const hours = parseFloat(value);
    if (!Number.isFinite(hours) || hours <= 0) {
      return {
        banner: '❌ 用法: /time advance <小时数>',
        console: '❌ 用法: /time advance <小时数>，例如 /time advance 8',
        consoleType: 'error',
      };
    }
    const ms = hours * 60 * 60 * 1000;
    advanceGameTime(ms);
    return {
      banner: `⏰ 已推进 ${hours} 小时`,
      console: `⏰ 已推进 ${hours} 小时游戏时间`,
      consoleType: 'success',
    };
  }

  // ---- /time reset ----
  if (subCmd === 'reset') {
    await resetGameTime();
    return {
      banner: '⏰ 游戏时间已重置为现实时间',
      console: '⏰ 游戏时间已重置为现实时间，所有角色的冷落状态已清除。',
      consoleType: 'success',
    };
  }

  return {
    banner: `❌ 未知子命令: ${subCmd}`,
    console: `❌ 未知子命令: ${subCmd}\n可用: speed / pause / resume / set / advance / reset`,
    consoleType: 'error',
  };
}, { description: '时间控制: /time [speed|pause|resume|set|advance|reset]' });

// /wake（唤醒睡眠角色）
registerCommand('wake', async (args, context) => {
  const state = getAppState();
  const char = context.character || getCurrentCharacter();
  if (!char) {
    return {
      banner: '❌ 请先选择一个角色',
      console: '❌ 未选择角色',
      consoleType: 'error',
    };
  }

  const sleepStatus = char.bodyState?.sleepStatus;
  if (sleepStatus !== '深睡' && sleepStatus !== '浅睡') {
    return {
      banner: `💤 ${char.name} 已经是清醒状态`,
      console: `💤 ${char.name} 当前状态: ${sleepStatus || '清醒'}`,
      consoleType: 'info',
    };
  }

  const force = args.trim().toLowerCase() === 'force';

  const { getGameTime } = await import('./time.js');
  const { updateCharacter } = await import('./character.js');

  // ---- 强制唤醒：无视概率 ----
  if (force) {
    const newBodyState = {
      ...char.bodyState,
      sleepStatus: '浅睡',
      consciousness: '迷糊',
      lastWakeTime: getGameTime(),
      sleepQuality: (char.bodyState.sleepQuality ?? 1.0) * 0.7,
    };
    await updateCharacter(char.id, { bodyState: newBodyState });
    return {
      banner: `✅ 已强制唤醒 ${char.name}（忽略唤醒概率）`,
      console:
        `✅ 已强制唤醒 ${char.name}\n` +
        `新状态: 浅睡（迷糊）\n` +
        `注: 此操作忽略唤醒概率，用于解决"怎么都唤不醒"的情况。`,
      consoleType: 'success',
    };
  }

  // ---- 正常尝试：走 tryWakeUp 概率逻辑 ----
  const callCount = state.get('callCount') || 0;
  const { tryWakeUp } = await import('./bodyState.js');
  const result = await tryWakeUp(char, callCount);

  if (result.success) {
    state.set('callCount', 0);
    return {
      banner: `✅ ${result.message}`,
      console: `✅ ${result.message}\n新状态: ${result.newState || '清醒'}`,
      consoleType: 'success',
    };
  }

  state.set('callCount', callCount + 1);
  return {
    banner: `💤 ${result.message}`,
    console:
      `💤 唤醒失败: ${result.message}\n` +
      `已尝试次数: ${callCount + 1}\n` +
      `提示: 使用 /wake force 可强制唤醒。`,
    consoleType: 'warning',
  };
}, { description: '尝试唤醒睡眠中的角色（/wake force 强制唤醒）' });

// /undo（撤回上一轮对话）
registerCommand('undo', async (args, context) => {
  const state = getAppState();

  if (state.get('sending')) {
    return {
      banner: '⚠️ 正在生成回复，请稍候',
      console: '⚠️ 当前有消息正在生成中，无法执行撤回。',
      consoleType: 'warning',
    };
  }

  const convId = state.get('currentConversationId');
  if (!convId) {
    return {
      banner: '❌ 未找到当前会话',
      console: '❌ 未找到当前会话（可能未选择角色）',
      consoleType: 'error',
    };
  }

  const { undoLastMessage } = await import('./chatOperations.js');
  const result = await undoLastMessage(convId);

  if (!result.success) {
    return {
      banner: `❌ 撤回失败: ${result.reason}`,
      console: `❌ 撤回失败: ${result.reason}`,
      consoleType: 'error',
    };
  }

  const uContent = (result.removed.user.content || '').slice(0, 60);
  const aContent = (result.removed.assistant.content || '').slice(0, 60);
  return {
    banner: '↩️ 已撤回上一轮对话',
    console:
      `↩️ 已撤回上一轮对话\n\n` +
      `用户: ${uContent}${uContent.length >= 60 ? '...' : ''}\n` +
      `角色: ${aContent}${aContent.length >= 60 ? '...' : ''}\n` +
      `同时删除了 ${result.removed.memories} 条相关记忆`,
    consoleType: 'success',
  };
}, { description: '撤回上一轮对话（用户消息 + 角色回复）' });

// /regen（重新生成上一条角色回复）
registerCommand('regen', async (args, context) => {
  const state = getAppState();

  if (state.get('sending')) {
    return {
      banner: '⚠️ 正在生成回复，请稍候',
      console: '⚠️ 当前有消息正在生成中，无法执行重新生成。',
      consoleType: 'warning',
    };
  }

  const convId = state.get('currentConversationId');
  if (!convId) {
    return {
      banner: '❌ 未找到当前会话',
      console: '❌ 未找到当前会话（可能未选择角色）',
      consoleType: 'error',
    };
  }

  const { regenerateLastReply } = await import('./chatOperations.js');
  const result = await regenerateLastReply(convId);

  if (!result.success) {
    return {
      banner: `❌ 重新生成失败: ${result.reason}`,
      console: `❌ 重新生成失败: ${result.reason}`,
      consoleType: 'error',
    };
  }

  const preview = (result.newContent || '').slice(0, 80);
  return {
    banner: '🔄 已重新生成',
    console:
      `🔄 已重新生成\n\n` +
      `新回复预览: ${preview}${preview.length >= 80 ? '...' : ''}`,
    consoleType: 'success',
  };
}, { description: '重新生成上一条角色回复', aliases: ['regenerate'] });

// ============================================================
// 高阶采样参数控制命令
// ============================================================

// /temp
registerCommand('temp', async (args, context) => {
  const val = parseFloat(args);
  if (isNaN(val) || val < 0 || val > 2) {
    return {
      console: '❌ 温度值必须在 0 ~ 2 之间',
      consoleType: 'error',
      banner: '❌ 温度值必须在 0 ~ 2 之间',
    };
  }
  setTempParam('temperature', val);
  return {
    console: `🌡️ 温度已设为: ${val}`,
    consoleType: 'success',
    banner: `🌡️ 温度 = ${val}（临时生效）`,
  };
}, { description: '设置温度 (0-2)，临时生效（单聊 + 群聊）', aliases: ['t'] });

// /topp
registerCommand('topp', async (args, context) => {
  const val = parseFloat(args);
  if (isNaN(val) || val < 0 || val > 1) {
    return {
      console: '❌ Top-P 必须在 0 ~ 1 之间',
      consoleType: 'error',
      banner: '❌ Top-P 必须在 0 ~ 1 之间',
    };
  }
  setTempParam('topP', val);
  return {
    console: `🎯 Top-P 已设为: ${val}\n💡 提示：部分推理模型（如 o1/o3、Claude 4）会自动忽略此参数`,
    consoleType: 'success',
    banner: `🎯 Top-P = ${val}（临时生效）`,
  };
}, { description: '设置核采样 Top-P (0-1)，临时生效（仅单聊）', aliases: ['p'] });

// /max
registerCommand('max', async (args, context) => {
  const val = parseInt(args);
  if (isNaN(val) || val < 1 || val > 32768) {
    return {
      console: '❌ 最大 Token 数必须在 1 ~ 32768 之间',
      consoleType: 'error',
      banner: '❌ Max Tokens 必须在 1 ~ 32768 之间',
    };
  }
  setTempParam('maxTokens', val);
  return {
    console: `📝 最大输出 Token 已设为: ${val}`,
    consoleType: 'success',
    banner: `📝 Max Tokens = ${val}（临时生效）`,
  };
}, { description: '设置最大输出 Token (1-32768)，临时生效（单聊 + 群聊）' });

// /fp
registerCommand('fp', async (args, context) => {
  const val = parseFloat(args);
  if (isNaN(val) || val < -2 || val > 2) {
    return {
      console: '❌ 频率惩罚必须在 -2 ~ 2 之间',
      consoleType: 'error',
      banner: '❌ 频率惩罚必须在 -2 ~ 2 之间',
    };
  }
  setTempParam('frequencyPenalty', val);
  return {
    console: `📊 频率惩罚已设为: ${val}`,
    consoleType: 'success',
    banner: `📊 Frequency Penalty = ${val}`,
  };
}, { description: '设置频率惩罚 (-2 ~ 2)，临时生效' });

// /pp
registerCommand('pp', async (args, context) => {
  const val = parseFloat(args);
  if (isNaN(val) || val < -2 || val > 2) {
    return {
      console: '❌ 存在惩罚必须在 -2 ~ 2 之间',
      consoleType: 'error',
      banner: '❌ 存在惩罚必须在 -2 ~ 2 之间',
    };
  }
  setTempParam('presencePenalty', val);
  return {
    console: `📊 存在惩罚已设为: ${val}`,
    consoleType: 'success',
    banner: `📊 Presence Penalty = ${val}`,
  };
}, { description: '设置存在惩罚 (-2 ~ 2)，临时生效' });

// /topk
registerCommand('topk', async (args, context) => {
  const val = parseInt(args);
  if (isNaN(val) || val < 0 || val > 200) {
    return {
      console: '❌ Top-K 必须在 0 ~ 200 之间',
      consoleType: 'error',
      banner: '❌ Top-K 必须在 0 ~ 200 之间',
    };
  }
  setTempParam('topK', val);
  return {
    console: `🎯 Top-K 已设为: ${val}`,
    consoleType: 'success',
    banner: `🎯 Top-K = ${val}`,
  };
}, { description: '设置 Top-K (0-200)，临时生效' });

// /rp
registerCommand('rp', async (args, context) => {
  const val = parseFloat(args);
  if (isNaN(val) || val < 1 || val > 2) {
    return {
      console: '❌ 重复惩罚必须在 1.0 ~ 2.0 之间',
      consoleType: 'error',
      banner: '❌ 重复惩罚必须在 1.0 ~ 2.0 之间',
    };
  }
  setTempParam('repetitionPenalty', val);
  return {
    console: `🔄 重复惩罚已设为: ${val}`,
    consoleType: 'success',
    banner: `🔄 Repetition Penalty = ${val}`,
  };
}, { description: '设置重复惩罚 (1.0-2.0)，临时生效' });

// /reset_params
registerCommand('reset_params', async (args, context) => {
  resetTempParams();
  return {
    console: '🔄 所有参数已重置为设置中的默认值',
    consoleType: 'success',
    banner: '🔄 参数已重置为默认值',
  };
}, { description: '重置所有参数为设置中的默认值' });

// ============================================================
// 检查类命令
// ============================================================

// /inspect
registerCommand('inspect', async (args, context) => {
  const state = getAppState();
  const lines = [];
  const { getEnabledRules } = await import('./worldBook.js');
  const char = getCurrentCharacter();
  const groupId = state.get('currentGroupId');

  let worldBookRules = [];
  try {
    if (groupId) {
      worldBookRules = await getEnabledRules({ groupId });
    } else if (char) {
      worldBookRules = await getEnabledRules({ characterId: char.id });
    } else {
      worldBookRules = await getEnabledRules();
    }
  } catch (e) {
    lines.push('⚠️ 获取世界书规则失败');
  }

  const baseRules = [
    '一致性要求', '身份锁定', '名字提醒',
    '时间感知', '时间提醒', '角色信息', '用户信息',
  ];

  lines.push('📋 当前生效的注入规则');
  lines.push(`基础规则 (${baseRules.length} 条): ${baseRules.join(', ')}`);
  lines.push('');

  const semanticRules = worldBookRules.filter(r => r.type === 'semantic');
  const otherRules = worldBookRules.filter(r => r.type !== 'semantic');

  lines.push(`📖 世界书规则 (${worldBookRules.length} 条，其中语义规则 ${semanticRules.length} 条):`);

  if (otherRules.length === 0 && semanticRules.length === 0) {
    lines.push('  (无)');
  } else {
    for (const rule of otherRules) {
      const status = rule.enabled ? '✅' : '❌';
      const scope = rule.scope === 'global' ? '🌍' : rule.scope.startsWith('character:') ? '👤' : '👥';
      lines.push(`  ${status} ${scope} ${rule.name} (优先级: ${rule.priority})`);
      if (rule.description) {
        lines.push(`     ${rule.description.slice(0, 40)}${rule.description.length > 40 ? '...' : ''}`);
      }
    }

    if (semanticRules.length > 0) {
      lines.push('');
      lines.push(`🧠 语义规则:`);
      for (const rule of semanticRules) {
        const status = rule.enabled ? '✅' : '❌';
        const vecStatus = rule.vector ? '🧠' : '⚠️';
        lines.push(`  ${status} ${vecStatus} ${rule.name} (阈值: ${rule.semanticThreshold ?? '默认'})`);
        if (rule.semanticQuery) {
          lines.push(`     查询: ${rule.semanticQuery.slice(0, 50)}${rule.semanticQuery.length > 50 ? '...' : ''}`);
        }
      }
    }
  }

  const settings = state.get('settings') || {};
  const tbCfg = settings.tokenBudget || {};
  const allocation = {
    system: safeNum(tbCfg.allocation?.system, 0.4),
    history: safeNum(tbCfg.allocation?.history, 0.4),
    memory: safeNum(tbCfg.allocation?.memory, 0.1),
    summary: safeNum(tbCfg.allocation?.summary, 0.1),
  };

  lines.push('');
  lines.push('═══════════════════════════════════════');
  lines.push('📊 Token 预算');
  lines.push('─────────────────────────────────────');
  lines.push(`配置:`);
  lines.push(`  启用: ${tbCfg.enabled !== false ? '✅ 是' : '❌ 否'}`);
  lines.push(`  窗口模式: ${tbCfg.contextWindowMode || 'auto'}`);
  lines.push(`  预留生成: ${safeNum(tbCfg.reserveForGeneration, 1024)}`);
  lines.push(`  剪裁策略: ${tbCfg.strategy || 'drop_lowest'}`);
  lines.push(`  分配比例: 系统 ${allocation.system} / 历史 ${allocation.history} / 记忆 ${allocation.memory} / 摘要 ${allocation.summary}`);
  lines.push(`  世界书预算占比: ${safeNum(tbCfg.worldBookBudgetRatio, 0.3)}`);

  if (typeof window !== 'undefined' && window.__lastBudgetStats) {
    const stats = window.__lastBudgetStats;
    lines.push('');
    if (!stats.enabled) {
      lines.push(`上一轮实际使用（预算未启用，仅供参考）:`);
      lines.push(`  上下文窗口: ${stats.contextWindow}`);
      lines.push(`  可用预算: ${stats.available}（预留 ${stats.reserved}）`);
      lines.push(`  ─────────────`);
      lines.push(`  🟡 系统提示: ${stats.systemUsed ?? 0} / ${stats.systemBudget ?? '-'}`);
      lines.push(`  🧠 长期记忆: ${stats.memoryUsed ?? 0} / ${stats.memoryBudget ?? '-'}`);
      lines.push(`  📝 对话摘要: ${stats.summaryUsed ?? 0} / ${stats.summaryBudget ?? '-'}`);
      lines.push(`  💬 历史消息: ${stats.historyUsed ?? 0} / ${stats.historyBudget ?? '-'}`);
      lines.push(`  👤 用户消息: ${stats.userTokens ?? 0}`);
      lines.push(`  ─────────────`);
      lines.push(`  总计: ${stats.totalUsed ?? stats.totalTokens ?? 0} / ${stats.available}`);
      lines.push(`  ℹ️ 预算管理已关闭，以上仅为实际使用的 token 估算`);
    } else {
      lines.push(`上一轮实际使用:`);
      lines.push(`  上下文窗口: ${stats.contextWindow}`);
      lines.push(`  可用预算: ${stats.available}（预留 ${stats.reserved}）`);
      lines.push(`  ─────────────`);
      lines.push(`  🟡 系统提示: ${stats.systemUsed} / ${stats.systemBudget}`);
      lines.push(`  🧠 长期记忆: ${stats.memoryUsed} / ${stats.memoryBudget}`);
      lines.push(`  📝 对话摘要: ${stats.summaryUsed} / ${stats.summaryBudget}`);
      lines.push(`  💬 历史消息: ${stats.historyUsed} / ${stats.historyBudget}`);
      lines.push(`  👤 用户消息: ${stats.userTokens}`);
      lines.push(`  ─────────────`);
      lines.push(`  总计: ${stats.totalUsed} / ${stats.available}`);
      if (stats.droppedCount > 0) {
        const preview = stats.droppedTags.slice(0, 5).join(', ');
        lines.push(`  ⚠ 丢弃 ${stats.droppedCount} 条: ${preview}${stats.droppedTags.length > 5 ? ' ...' : ''}`);
      } else {
        lines.push(`  ✅ 无剪裁`);
      }
    }
  } else {
    lines.push('');
    lines.push(`上一轮实际使用: (暂无数据，发送一条消息后再试)`);
  }

  const effective = getEffectiveParams(settings);
  const tempUsed = getTempParams();
  const hasTemp = Object.values(tempUsed).some(v => v !== null);
  lines.push('');
  lines.push(`采样参数:`);
  lines.push(`  temperature: ${safeNum(effective.temperature, 0.7)}${tempUsed.temperature !== null ? ' 🌡️ 临时覆盖' : ''}`);
  lines.push(`  top_p: ${safeNum(effective.topP, 1.0)}${tempUsed.topP !== null ? ' 🎯 临时覆盖' : ''}`);
  lines.push(`  max_tokens: ${safeNum(effective.maxTokens, 4096)}${tempUsed.maxTokens !== null ? ' 📝 临时覆盖' : ''}`);
  lines.push(`  frequency_penalty: ${safeNum(effective.frequencyPenalty, 0)}`);
  lines.push(`  presence_penalty: ${safeNum(effective.presencePenalty, 0)}`);
  if (hasTemp) {
    lines.push(`  💡 使用 /reset_params 可清除所有临时覆盖`);
  }

  if (typeof window !== 'undefined' && window.__lastSemanticTrace) {
    const trace = window.__lastSemanticTrace;
    lines.push('');
    lines.push('═══════════════════════════════════════');
    lines.push(`🔍 上一轮语义匹配轨迹`);
    lines.push(`用户消息: "${trace.message.slice(0, 60)}${trace.message.length > 60 ? '...' : ''}"`);
    lines.push('');

    if (!trace.scores || trace.scores.length === 0) {
      lines.push('  (无语义规则参与匹配)');
    } else {
      const globalThreshold = safeNum(settings.worldBookSemantic?.threshold, 0.55);
      for (const s of trace.scores) {
        const threshold = safeNum(s.threshold, globalThreshold);
        const score = safeNum(s.score, 0);
        const willTrigger = score >= threshold;
        const icon = willTrigger ? '✅' : '❌';
        const bar = renderScoreBar(score);
        const name = (s.name || '(未命名)').padEnd(20);
        lines.push(`  ${icon} ${name} ${score.toFixed(4)} ${bar} (阈值 ${threshold.toFixed(2)})`);
      }
    }
  }

  try {
    const { debugConversation } = await import('./conversationState.js');
    const { describeCrossDayAndCold } = await import('./crossDayAwareness.js');

    const convId = state.get('currentConversationId');
    if (convId) {
      const stores = await getStores();
      const conv = await stores.conversations.get(convId);

      if (!conv) {
        lines.push('');
        lines.push('═══════════════════════════════════════');
        lines.push('🗓️ 会话状态');
        lines.push('─────────────────────────────────────');
        lines.push('（会话不存在）');
      } else if (!conv.messages || conv.messages.length === 0) {
        lines.push('');
        lines.push('═══════════════════════════════════════');
        lines.push('🗓️ 会话状态');
        lines.push('─────────────────────────────────────');
        lines.push('（会话为空，请先发送一条消息以初始化状态机）');
      } else {
        const dbg = debugConversation(conv);

        lines.push('');
        lines.push('═══════════════════════════════════════');
        lines.push('🗓️ 会话状态');
        lines.push('─────────────────────────────────────');
        lines.push(`状态: ${dbg.state}`);
        lines.push(`时间阶段: ${dbg.phase}`);
        lines.push(`距上次活动: ${dbg.hoursSince} 小时 (${dbg.daysSince} 天)`);
        lines.push('');
        lines.push(`内容完整性: ${dbg.completeness.level} (score: ${dbg.completeness.score})`);
        if (dbg.completeness.reasons.length > 0) {
          lines.push(`  判定依据: ${dbg.completeness.reasons.join(', ')}`);
        }
        lines.push('');
        lines.push(`最后消息: [${dbg.lastMessage.role}] "${dbg.lastMessage.preview}"`);

        if (dbg.currentScene) {
          const s = dbg.currentScene;
          lines.push('');
          lines.push(`当前场景: ${s.label} (${s.type})`);
          lines.push(`  置信度: ${s.confidence.toFixed(2)} (${s.method})`);
          lines.push(`  距场景最后相关消息: ${s.elapsedHours} 小时`);
          lines.push(`  合理时效: ${s.maxDuration}h / 过期阈值: ${s.staleThreshold}h`);
          lines.push(`  敏感度: ${s.sensitivity}${s.reframable ? ' · 可重构' : ' · 不可重构'}`);
        } else {
          lines.push('');
          lines.push(`当前场景: 未识别（消息中未命中任何场景关键词）`);
        }

        let coldWouldTrigger = false;
        let coldDesc = '';
        if (char) {
          const { getGameTime } = await import('./time.js');
          const now = getGameTime();
          const lastInt = char.lastInteraction?.gameTime || now;
          const hoursSinceInt = (now - lastInt) / (1000 * 60 * 60);
          if (hoursSinceInt > 2) {
            coldWouldTrigger = true;
            if (hoursSinceInt < 6) coldDesc = '刚刚离开';
            else if (hoursSinceInt < 24) coldDesc = `${Math.round(hoursSinceInt)} 小时未互动`;
            else coldDesc = `${Math.round(hoursSinceInt / 24)} 天未互动`;
          }
        }

        const crossDayInfo = describeCrossDayAndCold(conv, coldWouldTrigger ? coldDesc : null);

        lines.push('');
        lines.push('─────────────────────────────────────');
        lines.push('🌐 跨天 / 冷落 分工');
        lines.push(`  跨天感知: ${crossDayInfo.crossDay.willInject ? '✅ 触发' : '❌ 不触发'}`);
        if (crossDayInfo.crossDay.willInject) {
          lines.push(`    阶段: ${crossDayInfo.crossDay.phase} · 距上次: ${crossDayInfo.crossDay.days} 天`);
        }
        lines.push(`  冷落感知: ${coldWouldTrigger ? '✅ 触发' : '❌ 不触发'}`);
        if (coldWouldTrigger) {
          lines.push(`    ${coldDesc}`);
        }
        lines.push('（提示：冷落提示词的具体文案由 chat.js 运行时生成）');
      }
    }
  } catch (e) {
    console.error('[CommandEngine] 会话状态调试失败:', e);
    lines.push('');
    lines.push(`⚠️ 会话状态调试失败: ${e.message}`);
  }

  const pending = state.get('pendingInjection');
  if (pending) {
    lines.push('');
    lines.push(`📌 待注入内容: ${pending.length > 30 ? pending.slice(0, 30) + '...' : pending}`);
  }

  return {
    console: lines.join('\n'),
    consoleType: 'info',
    banner: `📋 共 ${worldBookRules.length} 条世界书规则生效`,
  };
}, { description: '查看当前生效的注入规则（基础+世界书+语义轨迹+Token预算+会话状态）', aliases: ['ins'] });

// /worldbook（世界书工具）
registerCommand('worldbook', async (args, context) => {
  const parts = args.trim().split(/\s+/);
  const subCmd = (parts[0] || '').toLowerCase();
  const query = parts.slice(1).join(' ').trim();

  // ---- /worldbook test <文本> ----
  if (subCmd === 'test') {
    if (!query) {
      return {
        banner: '❌ 用法: /worldbook test <文本>',
        console: '❌ 用法: /worldbook test <文本>\n例如: /worldbook test 我今天有点难过',
        consoleType: 'error',
      };
    }

    const state = getAppState();
    const settings = state.get('settings') || {};

    // 检查语义引擎是否就绪
    let isReady = false;
    try {
      const { isMemoryVectorReady } = await import('./memory.js');
      isReady = isMemoryVectorReady();
    } catch (_) {
      isReady = false;
    }

    if (!isReady) {
      return {
        banner: '❌ 语义引擎未就绪',
        console:
          '❌ 语义引擎未就绪。\n' +
          '请到 设置 → 长期记忆 中：\n' +
          '  1. 配置语义模型\n' +
          '  2. 下载模型\n' +
          '  3. 启用世界书语义触发\n' +
          '  4. 在世界书界面点击"🧠 同步向量"生成规则向量',
        consoleType: 'error',
      };
    }

    // 构造上下文：优先群组 > 角色 > 全局
    const char = context.character || getCurrentCharacter();
    const groupId = state.get('currentGroupId');
    const ctxArg = (() => {
      if (groupId) return { groupId };
      if (char) return { characterId: char.id };
      return null;
    })();

    const { testSemanticMatch } = await import('./worldBook.js');

    let scores;
    try {
      scores = await testSemanticMatch(query, ctxArg);
    } catch (e) {
      return {
        banner: `❌ 测试失败: ${e.message}`,
        console: `❌ 测试失败: ${e.message}`,
        consoleType: 'error',
      };
    }

    if (!scores || scores.length === 0) {
      return {
        banner: '📖 无语义规则可测试',
        console:
          '📖 当前上下文下没有可测试的语义规则。\n\n' +
          '请检查:\n' +
          '  1. 是否已创建 semantic 类型的规则\n' +
          '  2. 规则的向量是否已生成（可在世界书界面点击"🧠 同步向量"）\n' +
          '  3. 规则的作用域是否匹配当前上下文',
        consoleType: 'info',
      };
    }

    // 全局默认阈值兜底
    const globalThreshold = (() => {
      const t = settings.worldBookSemantic?.threshold;
      const n = typeof t === 'number' ? t : parseFloat(t);
      return Number.isFinite(n) ? n : 0.55;
    })();

    const lines = [`🔍 语义匹配轨迹`, `用户消息: "${query}"`, ''];
    let hitCount = 0;

    for (const s of scores) {
      const threshold = Number.isFinite(s.threshold) ? s.threshold : globalThreshold;
      const score = Number.isFinite(s.score) ? s.score : 0;
      const willTrigger = score >= threshold;
      if (willTrigger) hitCount++;
      const icon = willTrigger ? '✅' : '❌';
      const bar = renderScoreBar(score);
      const name = (s.name || '(未命名)').padEnd(20);
      lines.push(`  ${icon} ${name} ${score.toFixed(4)} ${bar} (阈值 ${threshold.toFixed(2)})`);
    }

    return {
      banner: `🔍 共 ${scores.length} 条语义规则，命中 ${hitCount} 条`,
      console: lines.join('\n'),
      consoleType: 'info',
    };
  }

  // ---- help（无子命令或未知子命令）----
  return {
    banner: '📖 世界书命令',
    console:
      `📖 世界书命令\n\n` +
      `  /worldbook test <文本>  — 测试语义规则匹配\n\n` +
      `示例:\n` +
      `  /worldbook test 我今天有点难过`,
    consoleType: 'info',
  };
}, { description: '世界书工具: /worldbook test <文本> 测试语义匹配', aliases: ['wb'] });

// /status
registerCommand('status', async (args, context) => {
  const state = getAppState();
  const mode = state.get('currentMode');
  const lines = [];

  if (mode === 'group') {
    const groupId = state.get('currentGroupId');
    if (!groupId) {
      return {
        console: '❌ 当前未在群聊中',
        consoleType: 'error',
        banner: '❌ 未在群聊中',
      };
    }
    const { getGroup, getGroupMembers } = await import('./groupChat.js');
    const group = await getGroup(groupId);
    const members = await getGroupMembers(groupId);

    if (args && args.trim().startsWith('@')) {
      const targetName = args.trim().substring(1);
      const targetMember = members.find(m =>
        m.memberType === 'character' && m.character?.name === targetName
      );
      if (!targetMember) {
        return {
          console: `❌ 未找到成员: ${targetName}`,
          consoleType: 'error',
          banner: `❌ 未找到成员: ${targetName}`,
        };
      }
      const char = targetMember.character;
      lines.push(`📛 成员: ${char.name}`);
      lines.push(`❤️ 关系: ${char.relationship || '未设置'}`);
      if (char.emotionState) {
        lines.push(`😊 情感: ${getEmotionLabel(char.emotionState)}`);
        lines.push(`  愉悦:${Math.round(char.emotionState.valence)} 唤醒:${Math.round(char.emotionState.arousal)} 好感:${Math.round(char.emotionState.affection)}`);
      }
      if (char.bodyState) {
        lines.push(`⚡ 精力:${Math.round(char.bodyState.energy)} 睡意:${Math.round(char.bodyState.sleepiness)} 健康:${Math.round(char.bodyState.health)}`);
        if (char.bodyState.sleepStatus !== '清醒') {
          lines.push(`😴 睡眠: ${char.bodyState.sleepStatus}`);
        }
        if (char.bodyState.specialStates && char.bodyState.specialStates.length > 0) {
          lines.push(`🌀 特殊状态: ${char.bodyState.specialStates.join('、')}`);
        }
      }
      return {
        console: lines.join('\n'),
        consoleType: 'info',
        banner: `📊 ${char.name} 的状态已输出到控制台`,
      };
    }

    lines.push(`👥 群组: ${group.name}`);
    lines.push(`📝 描述: ${group.description || '无'}`);
    lines.push(`👤 成员数: ${members.length}`);
    const charMembers = members.filter(m => m.memberType === 'character');
    if (charMembers.length > 0) {
      lines.push(`🎭 角色成员 (${charMembers.length}人): ${charMembers.map(m => m.character?.name || '未知').join('、')}`);
    }
    const userMember = members.find(m => m.memberType === 'user');
    if (userMember) {
      lines.push(`👑 群主: ${userMember.role === 'owner' ? '你' : '用户'}`);
    }
    // ★ 修复：与 Bug-10 同源，改用 getGameTime() 与写入端保持一致
    const now = getGameTime();
    const activeThreshold = 5 * 60 * 1000;
    const activeCount = charMembers.filter(m => (m.lastActiveAt || 0) > now - activeThreshold).length;
    const levelLabel = charMembers.length > 0
      ? (activeCount / charMembers.length > 0.7 ? '🔥 活跃' :
         activeCount / charMembers.length > 0.4 ? '📈 正常' :
         activeCount / charMembers.length > 0.2 ? '😴 低活跃' : '❄️ 冷清')
      : '📊 无角色成员';
    lines.push(`📊 活跃度: ${levelLabel}`);

    if (group.summary) {
      lines.push(`📝 群聊摘要: ${group.summary.slice(0, 40)}${group.summary.length > 40 ? '...' : ''}`);
    } else {
      lines.push(`📝 群聊摘要: (暂无，累计消息 ${group.lastSummaryIndex || 0} 条已摘要)`);
    }

    return {
      console: lines.join('\n'),
      consoleType: 'info',
      banner: `📊 群组 "${group.name}" 信息已输出`,
    };
  } else {
    const char = getCurrentCharacter();
    if (!char) {
      return {
        console: '❌ 未选择任何角色',
        consoleType: 'error',
        banner: '❌ 未选择角色',
      };
    }
    lines.push(`📛 角色: ${char.name}`);
    lines.push(`❤️ 关系: ${char.relationship || '未设置'}`);
    lines.push(`📝 简介: ${char.description || '无'}`);
    if (char.emotionState) {
      lines.push(`😊 情感: ${getEmotionLabel(char.emotionState)}`);
      lines.push(`  愉悦:${Math.round(char.emotionState.valence)} 唤醒:${Math.round(char.emotionState.arousal)} 支配:${Math.round(char.emotionState.dominance)}`);
      lines.push(`  好感:${Math.round(char.emotionState.affection)} 信任:${Math.round(char.emotionState.trust)} 亲密:${Math.round(char.emotionState.intimacy)}`);
    }
    if (char.bodyState) {
      lines.push(`⚡ 精力:${Math.round(char.bodyState.energy)} 睡意:${Math.round(char.bodyState.sleepiness)} 健康:${Math.round(char.bodyState.health)}`);
      if (char.bodyState.sleepStatus !== '清醒') {
        lines.push(`😴 睡眠: ${char.bodyState.sleepStatus} (${char.bodyState.consciousness || ''})`);
      }
      if (char.bodyState.specialStates && char.bodyState.specialStates.length > 0) {
        lines.push(`🌀 特殊状态: ${char.bodyState.specialStates.join('、')}`);
      }
      if (char.bodyState.illness?.type) {
        lines.push(`🤒 疾病: ${char.bodyState.illness.type} (严重度: ${Math.round(char.bodyState.illness.severity)})`);
      }
    }
    try {
      const memories = await getMemoriesByCharacter(char.id);
      lines.push(`🧠 记忆条目: ${memories.length}`);
      if (memories.length > 0) {
        const latest = memories.sort((a, b) => b.timestamp - a.timestamp)[0];
        lines.push(`  最近: ${formatTimestamp(latest.timestamp)} 您: ${latest.userMessage.slice(0, 20)}...`);
      }
    } catch (e) {}
    const convId = state.get('currentConversationId');
    if (convId) {
      const stores = await getStores();
      const conv = await stores.conversations.get(convId);
      if (conv) {
        lines.push(`💬 会话消息: ${conv.messages.length} 条`);
        if (conv.summary) {
          lines.push(`📝 摘要: ${conv.summary.slice(0, 40)}${conv.summary.length > 40 ? '...' : ''}`);
        }
      }
    }
    return {
      console: lines.join('\n'),
      consoleType: 'info',
      banner: `📊 ${char.name} 的状态已输出到控制台`,
    };
  }
}, { description: '查看当前角色/群组状态，群聊支持 @成员', aliases: ['s'] });

// /memory
registerCommand('memory', async (args, context) => {
  const char = getCurrentCharacter();
  if (!char) {
    return {
      console: '❌ 未选择角色',
      consoleType: 'error',
      banner: '❌ 未选择角色',
    };
  }
  const parts = args.trim().split(/\s+/);
  const subCmd = parts[0] || 'list';
  const query = parts.slice(1).join(' ');

  if (subCmd === 'list') {
    const memories = await getMemoriesByCharacter(char.id);
    const sorted = memories.sort((a, b) => b.timestamp - a.timestamp);
    const recent = sorted.slice(0, 10);
    if (recent.length === 0) {
      return {
        console: `🧠 角色 "${char.name}" 暂无记忆`,
        consoleType: 'info',
        banner: '🧠 暂无记忆',
      };
    }
    const lines = [];
    lines.push(`🧠 角色 "${char.name}" 的记忆 (最近 ${recent.length} 条，共 ${sorted.length} 条):`);
    for (const mem of recent) {
      const time = formatTimestamp(mem.timestamp);
      const preview = mem.userMessage.length > 25 ? mem.userMessage.slice(0, 25) + '...' : mem.userMessage;
      lines.push(`  ${time} 您: ${preview}`);
      lines.push(`          → ${mem.assistantMessage.slice(0, 30)}${mem.assistantMessage.length > 30 ? '...' : ''}`);
    }
    return {
      console: lines.join('\n'),
      consoleType: 'info',
      banner: `🧠 已显示 ${recent.length} 条记忆`,
    };
  } else if (subCmd === 'search') {
    if (!query) {
      return {
        console: '❌ 请指定搜索关键词: /memory search <关键词>',
        consoleType: 'error',
        banner: '❌ 请指定搜索关键词',
      };
    }
    const results = await searchMemories(char.id, query, 5);
    if (results.length === 0) {
      return {
        console: `🔍 未找到包含 "${query}" 的记忆`,
        consoleType: 'info',
        banner: '🔍 未找到相关记忆',
      };
    }
    const lines = [];
    lines.push(`🔍 找到 ${results.length} 条包含 "${query}" 的记忆:`);
    for (const mem of results) {
      lines.push(`  您: ${mem.userMessage}`);
      lines.push(`  → ${mem.assistantMessage}`);
      lines.push('');
    }
    return {
      console: lines.join('\n'),
      consoleType: 'info',
      banner: `🔍 找到 ${results.length} 条记忆`,
    };
  } else if (subCmd === 'clear') {
    const memories = await getMemoriesByCharacter(char.id);
    if (memories.length === 0) {
      return {
        console: '🧠 暂无记忆可清空',
        consoleType: 'info',
        banner: '🧠 暂无记忆',
      };
    }
    return {
      console: `⚠️ 此操作将清空 ${memories.length} 条记忆，请使用 \`/memory confirm_clear\` 确认`,
      consoleType: 'warning',
      banner: `⚠️ 将清空 ${memories.length} 条记忆，请确认`,
    };
  } else if (subCmd === 'confirm_clear') {
    const memories = await getMemoriesByCharacter(char.id);
    const count = memories.length;
    for (const mem of memories) {
      await deleteMemory(mem.id);
    }
    return {
      console: `🗑️ 已清空角色 "${char.name}" 的所有记忆 (${count} 条)`,
      consoleType: 'success',
      banner: `🗑️ 已清空 ${count} 条记忆`,
    };
  } else {
    return {
      console: `❌ 未知子命令: ${subCmd}。支持: list, search <关键词>, clear`,
      consoleType: 'error',
      banner: '❌ 未知子命令',
    };
  }
}, { description: '记忆管理: /memory list, /memory search <词>, /memory clear', aliases: ['mem'] });

// /stats
registerCommand('stats', async (args, context) => {
  const stores = await getStores();
  const [characters, conversations, memories, posts, rules, groups] = await Promise.all([
    stores.characters.getAll(),
    stores.conversations.getAll(),
    stores.memories.getAll(),
    stores.posts.getAll(),
    stores.world_book.getAll(),
    stores.groups.getAll(),
  ]);
  let totalMessages = 0;
  for (const conv of conversations) {
    totalMessages += conv.messages.length;
  }
  const lines = [];
  lines.push('📊 Utopia 系统统计');
  lines.push(`👤 角色数: ${characters.length}`);
  lines.push(`💬 会话数: ${conversations.length}`);
  lines.push(`📝 消息总数: ${totalMessages}`);
  lines.push(`🧠 记忆条目: ${memories.length}`);
  lines.push(`📖 世界书规则: ${rules.length}`);
  lines.push(`👥 群组数: ${groups.length}`);
  lines.push(`📱 朋友圈动态: ${posts.length}`);

  const groupsWithSummary = groups.filter(g => g.summary && g.summary.length > 0).length;
  if (groups.length > 0) {
    lines.push(`📝 已生成群聊摘要: ${groupsWithSummary}/${groups.length}`);
  }

  const state = getAppState();
  const settings = state.get('settings') || {};
  const engineFlags = settings.engineFlags || {};
  lines.push('');
  lines.push(`⚙️ 引擎状态:`);
  lines.push(`  ${engineFlags.emotion !== false ? '✅' : '❌'} 情感引擎`);
  lines.push(`  ${engineFlags.bodyState !== false ? '✅' : '❌'} 身体状态引擎`);
  lines.push(`  ${engineFlags.time !== false ? '✅' : '❌'} 时间系统`);

  const semanticRules = rules.filter(r => r.type === 'semantic');
  if (semanticRules.length > 0) {
    const withVector = semanticRules.filter(r => r.vector).length;
    lines.push('');
    lines.push(`🧠 世界书语义规则: ${semanticRules.length} 条（${withVector} 条已生成向量）`);
  }

  const effective = getEffectiveParams(settings);
  const tempUsed = getTempParams();
  lines.push('');
  lines.push(`🎛️ 采样参数:`);
  lines.push(`  temperature: ${safeNum(effective.temperature, 0.7)}${tempUsed.temperature !== null ? ' 🌡️' : ''}`);
  lines.push(`  top_p: ${safeNum(effective.topP, 1.0)}${tempUsed.topP !== null ? ' 🎯' : ''}`);
  lines.push(`  max_tokens: ${safeNum(effective.maxTokens, 4096)}${tempUsed.maxTokens !== null ? ' 📝' : ''}`);

  try {
    const { getGameDate, getTimeSpeed, isTimePaused } = await import('./time.js');
    const date = getGameDate();
    const speed = getTimeSpeed();
    const paused = isTimePaused();
    lines.push(`⏰ 游戏时间: ${date.toLocaleString('zh-CN')} | 流速: ${speed}x ${paused ? '⏸️' : '▶️'}`);
  } catch (e) {}

  return {
    console: lines.join('\n'),
    consoleType: 'info',
    banner: '📊 系统统计已输出到控制台',
  };
}, { description: '显示系统统计信息（角色、会话、消息、记忆等）' });

// /whoami
registerCommand('whoami', async (args, context) => {
  const state = getAppState();
  const mode = state.get('currentMode');
  const lines = [];

  if (mode === 'group') {
    const groupId = state.get('currentGroupId');
    if (groupId) {
      const { getGroup, getGroupMembers } = await import('./groupChat.js');
      const group = await getGroup(groupId);
      if (group) {
        const members = await getGroupMembers(groupId);
        lines.push(`👥 当前在群聊: ${group.name}`);
        lines.push(`📝 描述: ${group.description || '无'}`);
        lines.push(`👤 成员: ${members.length} 人`);
        const charMembers = members.filter(m => m.memberType === 'character');
        if (charMembers.length > 0) {
          lines.push(`🎭 角色成员: ${charMembers.map(m => m.character?.name || '未知').join('、')}`);
        }
        return {
          console: lines.join('\n'),
          consoleType: 'info',
          banner: `👥 当前在群聊: ${group.name}`,
        };
      }
    }
    lines.push('❌ 未在群聊中');
  } else {
    const char = getCurrentCharacter();
    if (char) {
      lines.push(`📛 当前角色: ${char.name}`);
      lines.push(`❤️ 关系: ${char.relationship || '未设置'}`);
      lines.push(`📝 简介: ${char.description || '无'}`);
      const convId = state.get('currentConversationId');
      if (convId) {
        lines.push(`💬 会话ID: ${convId.slice(0, 8)}...`);
      }
    } else {
      lines.push('❌ 未选择任何角色');
    }
  }
  lines.push(`📌 模式: ${mode === 'group' ? '群聊' : '单聊'}`);
  return {
    console: lines.join('\n'),
    consoleType: 'info',
    banner: '👤 身份信息已输出到控制台',
  };
}, { description: '显示当前身份（角色/群组）和模式' });

// /switch（切换角色，支持模糊匹配）
registerCommand('switch', async (args, context) => {
  const query = args.trim();
  if (!query) {
    return {
      banner: '❌ 用法: /switch <角色名>',
      console: '❌ 用法: /switch <角色名>\n例如: /switch 猫猫',
      consoleType: 'error',
    };
  }

  const state = getAppState();
  const chars = state.get('characters') || [];
  if (chars.length === 0) {
    return {
      banner: '❌ 没有可用角色',
      console: '❌ 没有可用角色，请先创建或导入角色。',
      consoleType: 'error',
    };
  }

  // 匹配策略：精确 > 前缀 > 包含
  let candidates = chars.filter(c => c.name === query);
  if (candidates.length === 0) {
    candidates = chars.filter(c => c.name.startsWith(query));
  }
  if (candidates.length === 0) {
    candidates = chars.filter(c => c.name.includes(query));
  }

  if (candidates.length === 0) {
    const names = chars.map(c => c.name).join('、');
    return {
      banner: `❌ 未找到角色: ${query}`,
      console: `❌ 未找到角色: "${query}"\n\n可用角色 (${chars.length}): ${names}`,
      consoleType: 'error',
    };
  }

  if (candidates.length > 1) {
    const lines = [`🔍 "${query}" 匹配到 ${candidates.length} 个角色，请更精确:`];
    for (const c of candidates) {
      lines.push(`  · ${c.name}`);
    }
    return {
      banner: `⚠️ 匹配到 ${candidates.length} 个角色`,
      console: lines.join('\n'),
      consoleType: 'warning',
    };
  }

  const target = candidates[0];
  const currentId = state.get('currentCharacterId');
  if (currentId === target.id) {
    return {
      banner: `ℹ️ 已处于 ${target.name} 的会话中`,
      console: `ℹ️ 当前已经是 ${target.name}`,
      consoleType: 'info',
    };
  }

  const { selectCharacter } = await import('./character.js');
  await selectCharacter(target.id);
  localStorage.setItem('lastCharacterId', target.id);

  return {
    banner: `✅ 已切换到 ${target.name}`,
    console:
      `✅ 已切换到角色: ${target.name}\n` +
      `关系: ${target.relationship || '未设置'}`,
    consoleType: 'success',
  };
}, { description: '切换到指定角色（支持模糊匹配）', aliases: ['sw'] });

// /call
registerCommand('call', async (args, context) => {
  const state = getAppState();
  const mode = state.get('currentMode');
  if (mode === 'group') {
    return {
      banner: '❌ 群聊暂不支持语音通话',
      console: '❌ 群聊暂不支持语音通话',
      consoleType: 'error',
    };
  }
  const char = getCurrentCharacter();
  if (!char) {
    return {
      banner: '❌ 请先选择一个角色',
      console: '❌ 请先选择一个角色',
      consoleType: 'error',
    };
  }
  const sleepStatus = char.bodyState?.sleepStatus;
  if (sleepStatus === '深睡' || sleepStatus === '浅睡' || sleepStatus === '昏厥') {
    return {
      banner: `😴 ${char.name} 正在睡觉，无法通话`,
      console: `😴 ${char.name} 正在睡觉，无法通话`,
      consoleType: 'warning',
    };
  }
  try {
    const { startVoiceCall } = await import('../ui/screens/voiceCallUI.js');
    await startVoiceCall(char, { proactive: true });
    return {
      banner: `📞 正在呼叫 ${char.name}...`,
      console: `📞 正在呼叫 ${char.name}...`,
      consoleType: 'success',
    };
  } catch (err) {
    return {
      banner: `❌ 通话发起失败: ${err.message}`,
      console: `❌ 通话发起失败: ${err.message}`,
      consoleType: 'error',
    };
  }
}, { description: '发起与当前角色的语音通话（仅单聊）' });

// /social
registerCommand('social', async (args, context) => {
  const subCmd = args.trim().split(/\s+/)[0] || 'list';
  const rest = args.trim().split(/\s+/).slice(1).join(' ');

  const stores = await getStores();
  const allPosts = await social.getAllPosts();
  const characters = await stores.characters.getAll();

  const getAuthorName = (post) => {
    if (post.authorType === 'user') return '用户';
    const char = characters.find(c => c.id === post.authorId);
    return char ? char.name : '未知角色';
  };

  const getPostDetail = async (postId) => {
    const post = await stores.posts.get(postId);
    if (!post) return null;
    const lines = [];
    const author = getAuthorName(post);
    const time = new Date(post.timestamp).toLocaleString();
    lines.push(`📝 帖子 ID: ${post.id}`);
    lines.push(`👤 作者: ${author}`);
    lines.push(`🕐 时间: ${time}`);
    lines.push(`📄 内容: ${post.content}`);
    if (post.comments && post.comments.length > 0) {
      lines.push(`💬 评论 (${post.comments.length}条):`);
      for (const comment of post.comments) {
        const cAuthor = comment.authorType === 'user' ? '用户' :
          (characters.find(c => c.id === comment.authorId)?.name || '未知');
        const cTime = new Date(comment.timestamp).toLocaleString();
        lines.push(`  ${cAuthor} (${cTime}): ${comment.content}`);
        if (comment.replies && comment.replies.length > 0) {
          for (const reply of comment.replies) {
            const rAuthor = reply.authorType === 'user' ? '用户' :
              (characters.find(c => c.id === reply.authorId)?.name || '未知');
            const rTime = new Date(reply.timestamp).toLocaleString();
            lines.push(`    ↳ ${rAuthor} (${rTime}): ${reply.content}`);
          }
        }
      }
    }
    return lines.join('\n');
  };

  switch (subCmd) {
    case 'list': {
      if (allPosts.length === 0) {
        return {
          console: '📭 朋友圈暂无帖子',
          consoleType: 'info',
          banner: '📭 暂无帖子',
        };
      }
      const lines = [];
      lines.push(`📋 朋友圈共有 ${allPosts.length} 条帖子：`);
      for (const post of allPosts) {
        const author = getAuthorName(post);
        const time = new Date(post.timestamp).toLocaleString();
        const contentPreview = post.content.length > 30 ? post.content.slice(0, 30) + '...' : post.content;
        const commentCount = post.comments?.length || 0;
        lines.push(`  🆔 ${post.id.slice(0, 8)} | ${author} | ${time}`);
        lines.push(`     ${contentPreview} (💬 ${commentCount}条评论)`);
      }
      return {
        console: lines.join('\n'),
        consoleType: 'info',
        banner: `📋 共 ${allPosts.length} 条帖子`,
      };
    }

    case 'detail': {
      if (!rest) {
        return {
          console: '❌ 用法: /social detail <帖子ID>',
          consoleType: 'error',
          banner: '❌ 请指定帖子ID',
        };
      }
      const postId = rest.trim();
      const detail = await getPostDetail(postId);
      if (!detail) {
        return {
          console: `❌ 未找到帖子 ID: ${postId}`,
          consoleType: 'error',
          banner: '❌ 帖子不存在',
        };
      }
      return {
        console: detail,
        consoleType: 'info',
        banner: `📝 帖子详情已输出`,
      };
    }

    case 'clear': {
      if (allPosts.length === 0) {
        return {
          console: '📭 暂无帖子可清空',
          consoleType: 'info',
          banner: '📭 暂无帖子',
        };
      }
      return {
        console: `⚠️ 此操作将删除全部 ${allPosts.length} 条帖子及其所有评论和回复，不可恢复！\n请使用 \`/social confirm_clear\` 确认执行。`,
        consoleType: 'warning',
        banner: `⚠️ 将删除 ${allPosts.length} 条帖子，请确认`,
      };
    }

    case 'confirm_clear': {
      const count = allPosts.length;
      if (count === 0) {
        return {
          console: '📭 暂无帖子可清空',
          consoleType: 'info',
          banner: '📭 暂无帖子',
        };
      }
      for (const post of allPosts) {
        await social.deletePost(post.id);
      }
      return {
        console: `🗑️ 已清空全部 ${count} 条朋友圈帖子`,
        consoleType: 'success',
        banner: `🗑️ 已清空 ${count} 条帖子`,
      };
    }

    case 'generate': {
      let targetChars = characters;
      if (rest) {
        targetChars = characters.filter(c => c.name === rest);
        if (targetChars.length === 0) {
          return {
            console: `❌ 未找到名为 "${rest}" 的角色`,
            consoleType: 'error',
            banner: `❌ 未找到角色 "${rest}"`,
          };
        }
      }
      let generated = 0;
      for (const char of targetChars) {
        try {
          await social.publishPostByCharacter(char);
          generated++;
        } catch (e) {
          console.warn(`[Social] 角色 ${char.name} 发帖失败:`, e);
        }
      }
      return {
        console: `✅ 已为 ${generated} 个角色生成朋友圈帖子`,
        consoleType: 'success',
        banner: `✅ 生成了 ${generated} 条帖子`,
      };
    }

    case 'comment': {
      if (!rest) {
        return {
          console: '❌ 用法: /social comment <帖子ID>',
          consoleType: 'error',
          banner: '❌ 请指定帖子ID',
        };
      }
      const postId = rest.trim();
      const post = await stores.posts.get(postId);
      if (!post) {
        return {
          console: `❌ 未找到帖子 ID: ${postId}`,
          consoleType: 'error',
          banner: '❌ 帖子不存在',
        };
      }
      await social.generateCommentsForPost(postId);
      const updatedPost = await stores.posts.get(postId);
      const commentCount = updatedPost?.comments?.length || 0;
      return {
        console: `✅ 已为帖子 ${postId.slice(0, 8)} 生成评论，当前共 ${commentCount} 条评论`,
        consoleType: 'success',
        banner: `✅ 生成了 ${commentCount} 条评论`,
      };
    }

    case 'reply': {
      const parts = rest.split(/\s+/);
      if (parts.length < 2) {
        return {
          console: '❌ 用法: /social reply <帖子ID> <评论ID>',
          consoleType: 'error',
          banner: '❌ 请指定帖子ID和评论ID',
        };
      }
      const [postId, commentId] = parts;
      const post = await stores.posts.get(postId);
      if (!post) {
        return {
          console: `❌ 未找到帖子 ID: ${postId}`,
          consoleType: 'error',
          banner: '❌ 帖子不存在',
        };
      }
      const comment = post.comments?.find(c => c.id === commentId);
      if (!comment) {
        return {
          console: `❌ 未找到评论 ID: ${commentId}`,
          consoleType: 'error',
          banner: '❌ 评论不存在',
        };
      }
      await social.generateReplyForComment(postId, commentId);
      const updatedPost = await stores.posts.get(postId);
      const updatedComment = updatedPost.comments?.find(c => c.id === commentId);
      const replyCount = updatedComment?.replies?.length || 0;
      return {
        console: `✅ 已为评论 ${commentId.slice(0, 8)} 生成回复，当前共 ${replyCount} 条回复`,
        consoleType: 'success',
        banner: `✅ 生成了 ${replyCount} 条回复`,
      };
    }

    case 'delete': {
      if (!rest) {
        return {
          console: '❌ 用法: /social delete <帖子ID>',
          consoleType: 'error',
          banner: '❌ 请指定帖子ID',
        };
      }
      const postId = rest.trim();
      const post = await stores.posts.get(postId);
      if (!post) {
        return {
          console: `❌ 未找到帖子 ID: ${postId}`,
          consoleType: 'error',
          banner: '❌ 帖子不存在',
        };
      }
      await social.deletePost(postId);
      return {
        console: `🗑️ 已删除帖子 ${postId.slice(0, 8)}`,
        consoleType: 'success',
        banner: `🗑️ 已删除帖子`,
      };
    }

    case 'help':
    default: {
      return {
        console: `📖 朋友圈管理命令 (alias: /soc)\n\n` +
          `  /social list                   - 列出所有帖子\n` +
          `  /social detail <帖子ID>        - 查看帖子详情（含评论和回复）\n` +
          `  /social clear                  - 显示清空确认提示\n` +
          `  /social confirm_clear          - 确认清空所有帖子\n` +
          `  /social generate [角色名]       - 为所有/指定角色生成帖子\n` +
          `  /social comment <帖子ID>       - 为帖子生成AI评论\n` +
          `  /social reply <帖子ID> <评论ID> - 为评论生成AI回复\n` +
          `  /social delete <帖子ID>        - 删除指定帖子\n` +
          `  /social help                   - 显示此帮助`,
        consoleType: 'info',
        banner: '📖 朋友圈管理命令已输出',
      };
    }
  }
}, {
  description: '朋友圈管理: list, detail, clear, generate, comment, reply, delete',
  aliases: ['soc'],
});

// ============================================================
// 个性化引擎命令
// ============================================================
// /profile（查看/设置当前角色的体质与情绪特征）
registerCommand('profile', async (args, context) => {
  const { getCurrentCharacter, updateCharacter } = await import('./character.js');
  const {
    getBodyProfile,
    getEmotionProfile,
    getSpecialTypeList,
    normalizeBodyProfile,
    normalizeEmotionProfile,
    deriveBodyProfileFromPersonality,
  } = await import('./profileDefaults.js');

  const char = context.character || getCurrentCharacter();
  if (!char) {
    return {
      banner: '❌ 请先选择一个角色',
      console: '❌ 未选择角色',
      consoleType: 'error',
    };
  }

  const parts = args.trim().split(/\s+/);
  const subCmd = (parts[0] || '').toLowerCase();
  const value = parts.slice(1).join(' ').trim();

  // ---------- /profile（无子命令：展示） ----------
  if (!subCmd) {
    const runtimeBody = getBodyProfile(char);
    const emotion = getEmotionProfile(char);

    let rawBody;
    if (char.bodyProfile) {
      rawBody = normalizeBodyProfile(char.bodyProfile);
    } else {
      rawBody = normalizeBodyProfile(
        deriveBodyProfileFromPersonality(char.personalityParameters)
      );
    }

    const lines = [];

    lines.push(`📛 角色: ${char.name}`);
    lines.push('');
    lines.push('═══ 身体特征 ═══');

    const fmtRaw = (key, val) => {
      if (typeof val === 'boolean') return val ? '启用' : '禁用';
      if (typeof val === 'number') {
        if (key === 'sleepNeedHours') return String(val);
        return val.toFixed(2);
      }
      if (val === null || val === undefined) return '无';
      return String(val);
    };

    const fieldLine = (label, key, displayStr, runtimeVal) => {
      const rawVal = rawBody[key];
      if (rawVal !== undefined && rawVal !== runtimeVal) {
        return `  ${label}: ${displayStr}（原始：${fmtRaw(key, rawVal)}）`;
      }
      return `  ${label}: ${displayStr}`;
    };

    const chronotypeDisplay = `${runtimeBody.chronotype}${runtimeBody.circadianEnabled === false ? '（不生效）' : ''}`;
    lines.push(fieldLine('作息类型', 'chronotype', chronotypeDisplay, runtimeBody.chronotype));
    lines.push(fieldLine(
      '昼夜节律',
      'circadianEnabled',
      runtimeBody.circadianEnabled !== false ? '启用' : '禁用',
      runtimeBody.circadianEnabled
    ));
    lines.push(fieldLine(
      '每日睡眠',
      'sleepNeedHours',
      `${runtimeBody.sleepNeedHours} 小时`,
      runtimeBody.sleepNeedHours
    ));
    lines.push(fieldLine(
      '午休习惯',
      'allowNapping',
      runtimeBody.allowNapping ? '是' : '否',
      runtimeBody.allowNapping
    ));
    lines.push(fieldLine(
      '精力消耗倍率',
      'energyDecayFactor',
      runtimeBody.energyDecayFactor.toFixed(2),
      runtimeBody.energyDecayFactor
    ));
    lines.push(fieldLine(
      '精力恢复倍率',
      'energyRecoveryFactor',
      runtimeBody.energyRecoveryFactor.toFixed(2),
      runtimeBody.energyRecoveryFactor
    ));
    lines.push(fieldLine(
      '睡意积攒倍率',
      'sleepinessRateFactor',
      runtimeBody.sleepinessRateFactor.toFixed(2),
      runtimeBody.sleepinessRateFactor
    ));
    lines.push(fieldLine(
      '唤醒容易度',
      'wakeEase',
      runtimeBody.wakeEase.toFixed(2),
      runtimeBody.wakeEase
    ));
    lines.push(fieldLine(
      '体质',
      'constitution',
      runtimeBody.constitution.toFixed(2),
      runtimeBody.constitution
    ));
    lines.push(fieldLine(
      '疾病抵抗',
      'illnessResistance',
      runtimeBody.illnessResistance.toFixed(2),
      runtimeBody.illnessResistance
    ));
    lines.push(fieldLine(
      '受伤抵抗',
      'injuryResistance',
      runtimeBody.injuryResistance.toFixed(2),
      runtimeBody.injuryResistance
    ));
    lines.push(fieldLine(
      '恢复速度',
      'recoverySpeed',
      runtimeBody.recoverySpeed.toFixed(2),
      runtimeBody.recoverySpeed
    ));

    if (runtimeBody.special) {
      const specialList = getSpecialTypeList();
      const t = specialList.find(x => x.id === runtimeBody.special);
      lines.push(`  🌟 特殊类型: ${t ? `${t.emoji} ${t.label}` : runtimeBody.special}`);
      if (t) lines.push(`     ${t.description}`);
    } else {
      lines.push(`  特殊类型: 普通人类`);
    }

    const overriddenKeys = [
      'chronotype', 'circadianEnabled', 'sleepNeedHours', 'allowNapping',
      'energyDecayFactor', 'energyRecoveryFactor', 'sleepinessRateFactor',
      'wakeEase', 'constitution', 'illnessResistance', 'injuryResistance',
      'recoverySpeed',
    ];
    const hasOverrides = overriddenKeys.some(key =>
      rawBody[key] !== undefined && rawBody[key] !== runtimeBody[key]
    );
    if (hasOverrides) {
      lines.push('');
      lines.push('  💡 括号中"原始"是您在编辑表单中设置的值；不带括号的是当前运行时生效值');
    }

    lines.push('');
    lines.push('═══ 情绪特征 ═══');
    lines.push(`  情绪敏感度: ${emotion.emotionalSensitivity.toFixed(2)}`);
    lines.push(`  情绪波动性: ${emotion.emotionalVolatility.toFixed(2)}`);
    lines.push(`  情绪恢复倍率: ${emotion.emotionalDecayFactor.toFixed(2)}`);
    lines.push(`  依恋建立速度: ${emotion.attachmentSpeed.toFixed(2)}`);
    lines.push(`  信任恢复倍率: ${emotion.trustRecoveryFactor.toFixed(2)}`);
    lines.push('');
    lines.push('💡 子命令:');
    lines.push('  /profile special <type>    — 设置特殊类型');
    lines.push('  /profile special           — 列出可用特殊类型');
    lines.push('  /profile reset             — 重置为性格推导值');
    lines.push('  /profile set <key> <value> — 设置单个字段');

    return {
      console: lines.join('\n'),
      consoleType: 'info',
      banner: `📋 ${char.name} 的个性化配置已输出到控制台`,
    };
  }

  // ---------- /profile special（列出可用类型） ----------
  if (subCmd === 'special' && !value) {
    const list = getSpecialTypeList();
    const lines = ['🌟 可用特殊类型:', ''];
    for (const t of list) {
      lines.push(`  ${t.emoji} ${t.id}`);
      lines.push(`     ${t.label} — ${t.description}`);
    }
    lines.push('');
    lines.push('当前: ' + (char.bodyProfile?.special ? char.bodyProfile.special : '普通人类'));
    return {
      console: lines.join('\n'),
      consoleType: 'info',
      banner: '🌟 特殊类型列表已输出',
    };
  }

  // ---------- /profile special <type>（设置特殊类型） ----------
  if (subCmd === 'special' && value) {
    const list = getSpecialTypeList();
    const target = value === 'none' || value === 'null' || value === ''
      ? null
      : value;

    if (target !== null && !list.find(t => t.id === target)) {
      return {
        banner: `❌ 未知特殊类型: ${target}`,
        console: `❌ 未知特殊类型: ${target}\n可用: ${list.map(t => t.id).join(', ')}, none`,
        consoleType: 'error',
      };
    }

    const current = char.bodyProfile
      ? normalizeBodyProfile(char.bodyProfile)
      : normalizeBodyProfile(getBodyProfile(char));

    current.special = target;
    const updated = normalizeBodyProfile(current);

    await updateCharacter(char.id, { bodyProfile: updated }, { skipReload: true });

    const label = target
      ? (() => {
          const t = list.find(x => x.id === target);
          return t ? `${t.emoji} ${t.label}` : target;
        })()
      : '普通人类';

    return {
      banner: `✅ 特殊类型已设为: ${label}`,
      console: `✅ ${char.name} 的特殊类型已更新为: ${label}\n⚠️ 特殊类型的 overrides 会在运行时生效，但不会覆盖此处保存的原始值。`,
      consoleType: 'success',
    };
  }

  // ---------- /profile reset ----------
  if (subCmd === 'reset') {
    const { deriveEmotionProfileFromPersonality } = await import('./profileDefaults.js');
    const body = deriveBodyProfileFromPersonality(char.personalityParameters);
    const emotion = deriveEmotionProfileFromPersonality(char.personalityParameters);

    await updateCharacter(char.id, {
      bodyProfile: body,
      emotionProfile: emotion,
    }, { skipReload: true });

    return {
      banner: `🔄 ${char.name} 的个性化配置已重置`,
      console: `🔄 已根据性格参数重新推导 ${char.name} 的体质与情绪特征。`,
      consoleType: 'success',
    };
  }

  // ---------- /profile set <key> <value> ----------
  if (subCmd === 'set') {
    const setParts = value.split(/\s+/);
    const key = setParts[0];
    const rawValue = setParts.slice(1).join(' ');

    if (!key || !rawValue) {
      return {
        banner: '❌ 用法: /profile set <key> <value>',
        console: '❌ 用法: /profile set <key> <value>\n例如: /profile set constitution 0.8',
        consoleType: 'error',
      };
    }

    const BODY_KEYS = [
      'chronotype', 'circadianEnabled', 'sleepNeedHours', 'allowNapping', 'napTendency',
      'energyDecayFactor', 'energyRecoveryFactor', 'sleepinessRateFactor',
      'wakeEase', 'constitution', 'illnessResistance', 'injuryResistance',
      'recoverySpeed',
    ];
    const EMOTION_KEYS = [
      'emotionalSensitivity', 'emotionalVolatility', 'emotionalDecayFactor',
      'attachmentSpeed', 'trustRecoveryFactor',
    ];
    const BOOLEAN_KEYS = ['allowNapping', 'circadianEnabled'];

    const body = char.bodyProfile
      ? normalizeBodyProfile(char.bodyProfile)
      : normalizeBodyProfile(getBodyProfile(char));
    const emotion = char.emotionProfile
      ? normalizeEmotionProfile(char.emotionProfile)
      : normalizeEmotionProfile(getEmotionProfile(char));

    let updatedBody = { ...body };
    let updatedEmotion = { ...emotion };
    let target = null;

    if (BODY_KEYS.includes(key)) {
      target = 'body';

      if (key === 'chronotype') {
        if (!['morning', 'neutral', 'evening', 'none'].includes(rawValue)) {
          return {
            banner: `❌ chronotype 必须是 morning/neutral/evening/none`,
            console: `❌ chronotype 取值非法: ${rawValue}`,
            consoleType: 'error',
          };
        }
        updatedBody[key] = rawValue;
      } else if (BOOLEAN_KEYS.includes(key)) {
        const lower = rawValue.toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(lower)) {
          updatedBody[key] = true;
        } else if (['false', '0', 'no', 'off'].includes(lower)) {
          updatedBody[key] = false;
        } else {
          return {
            banner: `❌ ${key} 需要 true 或 false`,
            console: `❌ ${key} 取值非法: ${rawValue}\n支持: true/false、1/0、yes/no、on/off`,
            consoleType: 'error',
          };
        }
      } else {
        const num = parseFloat(rawValue);
        if (!Number.isFinite(num)) {
          return {
            banner: `❌ ${key} 需要数字值`,
            console: `❌ ${key} 取值非法: ${rawValue}`,
            consoleType: 'error',
          };
        }
        updatedBody[key] = num;
      }
    } else if (EMOTION_KEYS.includes(key)) {
      target = 'emotion';
      const num = parseFloat(rawValue);
      if (!Number.isFinite(num)) {
        return {
          banner: `❌ ${key} 需要数字值`,
          console: `❌ ${key} 取值非法: ${rawValue}`,
          consoleType: 'error',
        };
      }
      updatedEmotion[key] = num;
    } else {
      return {
        banner: `❌ 未知字段: ${key}`,
        console: `❌ 未知字段: ${key}\n\n可用字段:\n  body: ${BODY_KEYS.join(', ')}\n  emotion: ${EMOTION_KEYS.join(', ')}`,
        consoleType: 'error',
      };
    }

    const updates = {};
    if (target === 'body') {
      updates.bodyProfile = normalizeBodyProfile(updatedBody);
    } else {
      updates.emotionProfile = normalizeEmotionProfile(updatedEmotion);
    }

    await updateCharacter(char.id, updates, { skipReload: true });

    return {
      banner: `✅ ${key} 已更新`,
      console: `✅ ${char.name}.${target}Profile.${key} = ${rawValue}`,
      consoleType: 'success',
    };
  }

  // ---------- 未知子命令 ----------
  return {
    banner: `❌ 未知子命令: ${subCmd}`,
    console: `❌ 未知子命令: ${subCmd}\n可用: (无), special, set, reset`,
    consoleType: 'error',
  };
}, {
  description: '查看/设置当前角色的体质与情绪特征（/profile [special|set|reset]）',
  aliases: ['pf'],
});