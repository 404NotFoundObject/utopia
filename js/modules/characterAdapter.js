// js/modules/characterAdapter.js - 角色卡格式适配器
import { getGameTime } from './time.js';
import { getDefaultEmotionState, getInitialEmotionState } from './emotionEngine.js';
import { getDefaultBodyState, getInitialBodyState } from './bodyState.js';

// ---------- 格式检测 ----------
export function detectFormat(data, fileName = '') {
  if (typeof data === 'string') {
    try {
      const json = JSON.parse(data);
      return detectFormat(json);
    } catch {
      return 'unknown';
    }
  }

  if (typeof data === 'object' && data !== null) {
    if (data.schema === 'utopia-character/v3.1') return 'utopia-v3.1';
    if (data.schema === 'utopia-character/v3') return 'utopia-v3';
    if (data.data && data.data.name && data.spec === 'chara_card_v3') return 'st-v3';
    if (data.name && data.description && data.personality !== undefined) return 'st-v2';
    if (data.greeting !== undefined && data.definition !== undefined) return 'cai';
    if (data.name) return 'generic';
  }

  if (fileName && fileName.toLowerCase().endsWith('.png')) return 'png';
  return 'unknown';
}

// ---------- PNG 卡解析 ----------
export async function parsePNG(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        const data = extractTextChunk(buffer);
        if (!data) {
          reject(new Error('未找到文本数据块'));
          return;
        }
        const json = JSON.parse(data);
        resolve(json);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 从 PNG 的 tEXt 块提取 JSON 字符串
 * @param {ArrayBuffer} buffer
 * @returns {string|null} JSON 字符串，或 null
 */
function extractTextChunk(buffer) {
  const view = new DataView(buffer);
  let offset = 8;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    if (type === 'tEXt') {
      const data = new Uint8Array(buffer, offset + 8, length);
      const text = new TextDecoder('utf-8').decode(data);

      // 1. ST 官方：`chara\0{json}`（null 分隔）
      if (text.startsWith('chara\0')) {
        return text.substring(6);
      }
      // 2. Utopia 自产：`chara {json}`（空格分隔）
      if (text.startsWith('chara ')) {
        return text.substring(6);
      }
      // 3. 兼容：`chara` 后直接跟分隔符（\0 或空格）或 JSON
      if (text.startsWith('chara')) {
        return text.substring(5).replace(/^[\0 ]/, '');
      }
      // 4. 裸 JSON（兜底）
      if (text.startsWith('{')) {
        return text;
      }
    }
    offset += 12 + length;
  }
  return null;
}

// ---------- 格式转换函数 ----------
export function convertToUtopia(data, format) {
  let base = {};
  switch (format) {
    case 'utopia-v3.1':
    case 'utopia-v3':
      return data;
    case 'st-v3':
      base = fromSTV3(data);
      break;
    case 'st-v2':
      base = fromSTV2(data);
      break;
    case 'cai':
      base = fromCAI(data);
      break;
    case 'generic':
      base = fromGeneric(data);
      break;
    case 'png':
      return convertToUtopia(data, detectFormat(data));
    default:
      throw new Error('不支持的格式');
  }
  const now = getGameTime();
  const defaultEmotion = getDefaultEmotionState();
  defaultEmotion.lastUpdate = now;
  const defaultBody = getDefaultBodyState();
  defaultBody.lastUpdate = now;

  const personality = {
    neuroticism: 50,
    extraversion: 50,
    agreeableness: 50,
    openness: 50,
    conscientiousness: 50,
    expressiveness: 50,
  };

  const bodyProfile = base.bodyProfile || data.bodyProfile || null;
  const emotionProfile = base.emotionProfile || data.emotionProfile || null;

  return {
    name: base.name || '未命名角色',
    gender: base.gender || 'unknown',
    description: base.description || '',
    firstMessage: base.firstMessage || '',
    personality: base.personality || '',
    relationship: base.relationship || '',
    systemPrompt: base.systemPrompt || '',
    callUser: base.callUser || '用户',
    avatar: base.avatar || '',
    chatBg: base.chatBg || '',
    schema: 'utopia-character/v3.1',
    background: base.background || '',
    cgImage: base.cgImage || '',
    personalityParameters: base.personalityParameters || personality,
    generateFirstMessage: base.generateFirstMessage !== undefined ? base.generateFirstMessage : true,
    scene: base.scene || '',
    lastQuantifiedAt: base.lastQuantifiedAt || null,
    emotionState: defaultEmotion,
    bodyState: defaultBody,
    // ★ 透传 profile（可能为 null）
    bodyProfile,
    emotionProfile,
    lastSentMessageCount: 0,
    lastInteraction: { gameTime: now, realTime: Date.now() },
    dialogueExamples: base.dialogueExamples || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ---------- 各格式转换器 ----------

/**
 * ST V2 角色卡 → Utopia base 结构
 *
 * 映射原则：
 *   - 只映射 Utopia 已有的字段，ST 独有字段一律丢弃
 *   - 语义对齐优先于字段数量，不做重复填充
 *   - 未映射的字段由 convertToUtopia 用默认值填充
 *
 * 映射表：
 *   name                        → name
 *   description                 → description
 *   first_mes                   → firstMessage
 *   personality                 → personality
 *   system_prompt + post_history_instructions → systemPrompt（合并）
 *   scenario                    → scene
 *   mes_example                 → dialogueExamples
 *   avatar                      → avatar
 *   utopia.bodyProfile          → bodyProfile（★ Utopia 私有扩展兜底）
 *   utopia.emotionProfile       → emotionProfile（★ 同上）
 *
 * 丢弃字段：
 *   creator / creator_notes / tags / character_version
 *   alternate_greetings / character_book / extensions
 */
function fromSTV2(data) {
  const systemParts = [data.system_prompt, data.post_history_instructions]
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
  const systemPrompt = systemParts.join('\n\n');

  const bodyProfile = data.bodyProfile ?? data.utopia?.bodyProfile ?? undefined;
  const emotionProfile = data.emotionProfile ?? data.utopia?.emotionProfile ?? undefined;

  return {
    name: data.name || '',
    description: data.description || '',
    firstMessage: data.first_mes || '',
    personality: data.personality || '',
    systemPrompt,
    scene: data.scenario || '',
    dialogueExamples: data.mes_example || '',
    avatar: data.avatar || '',
    bodyProfile,
    emotionProfile,
  };
}

/**
 * ST V3 角色卡 → Utopia base 结构
 *
 * 与 V2 唯一区别：数据位于 data.data 下（多一层嵌套）
 * 映射规则与字段处理策略完全同 fromSTV2。
 *
 * ★ 个性化改造修复：profile 兜底路径为 data.data.extensions.utopia
 */
function fromSTV3(data) {
  const d = data.data;

  const systemParts = [d.system_prompt, d.post_history_instructions]
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
  const systemPrompt = systemParts.join('\n\n');

  //   优先级：data.data.bodyProfile > data.data.extensions.utopia.bodyProfile
  const bodyProfile = d.bodyProfile ?? d.extensions?.utopia?.bodyProfile ?? undefined;
  const emotionProfile = d.emotionProfile ?? d.extensions?.utopia?.emotionProfile ?? undefined;

  return {
    name: d.name || '',
    description: d.description || '',
    firstMessage: d.first_mes || '',
    personality: d.personality || '',
    systemPrompt,
    scene: d.scenario || '',
    dialogueExamples: d.mes_example || '',
    avatar: d.avatar || '',
    bodyProfile,
    emotionProfile,
  };
}

/**
 * Character.AI 卡 → Utopia base 结构
 *
 * 映射表：
 *   name            → name
 *   definition      → description
 *   greeting        → firstMessage
 *
 * 说明：CAI 卡不携带 profile，返回 undefined 由上层推导
 */
function fromCAI(data) {
  return {
    name: data.name || '',
    description: data.definition || '',
    firstMessage: data.greeting || '',
    personality: '',
    relationship: '',
    systemPrompt: '',
    callUser: '用户',
    avatar: '',
    dialogueExamples: '',
    background: '',
    cgImage: '',
    // CAI 无 profile
    bodyProfile: undefined,
    emotionProfile: undefined,
  };
}

/**
 * 通用格式 → Utopia base 结构
 */
function fromGeneric(data) {
  return {
    name: data.name || '',
    description: data.description || '',
    firstMessage: data.firstMessage || '',
    personality: data.personality || '',
    relationship: data.relationship || '',
    systemPrompt: data.systemPrompt || '',
    callUser: data.callUser || '用户',
    avatar: data.avatar || '',
    dialogueExamples: data.dialogueExamples || '',
    background: data.background || '',
    cgImage: data.cgImage || '',
    scene: data.scene || '',
    // ★ 通用格式：透传 profile
    bodyProfile: data.bodyProfile || undefined,
    emotionProfile: data.emotionProfile || undefined,
  };
}

// ---------- 导出为指定格式 ----------
export function convertFromUtopia(character, targetFormat) {
  switch (targetFormat) {
    case 'utopia-v3.1':
    case 'utopia-v3':
      return character;
    case 'st-v3':
      return toSTV3(character);
    case 'st-v2':
      return toSTV2(character);
    case 'generic':
      return toGeneric(character);
    default:
      throw new Error('不支持的导出格式');
  }
}

/**
 * Utopia 角色 → ST V3 卡片
 *
 * 与 fromSTV3 保持对称：导入 → 导出 → 再导入不应丢失已有字段。
 * 未在 Utopia 中存在的 ST 字段填充默认值（空串/空数组/null）。
 *
 *   - systemPrompt 是合并字段，导出时统一写入 system_prompt，
 *     post_history_instructions 留空（导入时的合并不可逆）
 *   - alternate_greetings / character_book 等字段 Utopia 不保存，
 *     导出填空
 *   - bodyProfile / emotionProfile 是 Utopia 私有扩展，
 *     导出时放入 extensions.utopia
 */
function toSTV3(char) {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: char.name,
      description: char.description,
      personality: char.personality,
      first_mes: char.firstMessage,
      mes_example: char.dialogueExamples || '',
      system_prompt: char.systemPrompt || '',
      scenario: char.scene || '',
      avatar: char.avatar || '',
      creator: '',
      tags: [],
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: null,
      world: null,
      extensions: {
        utopia: {
          bodyProfile: char.bodyProfile || null,
          emotionProfile: char.emotionProfile || null,
        },
      },
    },
  };
}

/**
 * Utopia 角色 → ST V2 卡片
 *
 * 与 fromSTV2 保持对称。
 * ST V2 无标准 extensions 字段，profile 放在顶层 utopia 字段中
 */
function toSTV2(char) {
  return {
    name: char.name,
    description: char.description,
    personality: char.personality,
    first_mes: char.firstMessage,
    mes_example: char.dialogueExamples || '',
    system_prompt: char.systemPrompt || '',
    scenario: char.scene || '',
    avatar: char.avatar || '',
    creator: '',
    tags: '',
    utopia: {
      bodyProfile: char.bodyProfile || null,
      emotionProfile: char.emotionProfile || null,
    },
  };
}

function toGeneric(char) {
  return {
    name: char.name,
    description: char.description,
    firstMessage: char.firstMessage,
    personality: char.personality,
    relationship: char.relationship,
    systemPrompt: char.systemPrompt,
    callUser: char.callUser,
    avatar: char.avatar,
    dialogueExamples: char.dialogueExamples || '',
    background: char.background || '',
    cgImage: char.cgImage || '',
    scene: char.scene || '',
    bodyProfile: char.bodyProfile || null,
    emotionProfile: char.emotionProfile || null,
  };
}