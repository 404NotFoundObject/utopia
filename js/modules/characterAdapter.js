// js/modules/characterAdapter.js - 角色卡格式适配器
import { getGameTime } from './time.js';
import { getDefaultEmotionState, getInitialEmotionState } from './emotionEngine.js';
import { getDefaultBodyState, getInitialBodyState } from './bodyState.js';
// ★ tEXt 扫描与载荷解码的唯一实现在 utils/png.js：两份拷贝的关键字覆盖会漂移，
// 这里直接复用同一份并原样再导出，保证既有 import 不受影响。
import { extractTextChunk as extractPngTextChunk } from '../utils/png.js';

export { extractPngTextChunk as extractTextChunk };

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
    // ST v2 信封：{ spec: 'chara_card_v2', data: {...} }
    if (data.spec === 'chara_card_v2' && data.data && data.data.name) return 'st-v2';
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
        const data = extractPngTextChunk(buffer);
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

// ---------- 格式转换函数 ----------
export function convertToUtopia(data, format) {
  let base = {};
  switch (format) {
    case 'utopia-v3.1':
    case 'utopia-v3':
      // 对象型的 personality / description 必须做安全转换：零守卫进入提示词时
      // 会在模板拼接中静默变成 [object Object]。
      // 这里只把文本字段做安全转换，结构化字段（personalityParameters /
      // emotionState / bodyState / schema 等）原样透传，不改变既有语义。
      return sanitizeUtopiaTextFields(data);
    case 'st-v3':
      base = fromSTV3(data);
      break;
    case 'st-v2':
      // 信封形式 { spec, data } 取 data；裸卡直接用 data
      base = fromSTV2(data.spec === 'chara_card_v2' && data.data ? data.data : data);
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
    // ★ 世界书 / 备用开场白透传（ST 卡往返不丢失）
    characterBook: base.characterBook || null,
    alternateGreetings: base.alternateGreetings || null,
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
    personality: toSafeText(data.personality),
    systemPrompt,
    scene: data.scenario || '',
    dialogueExamples: data.mes_example || '',
    avatar: data.avatar || '',
    bodyProfile,
    emotionProfile,
    // ★ 世界书（character_book）透传，避免静默丢失
    characterBook: data.character_book ?? null,
    alternateGreetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings : null,
  };
}

/**
 * ST V3 角色卡 → Utopia base 结构
 *
 * 与 V2 唯一区别：数据位于 data.data 下（多一层嵌套）
 * 映射规则与字段处理策略完全同 fromSTV2。
 *
 * ★ profile 兜底路径：data.data.extensions.utopia
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
    personality: toSafeText(d.personality),
    systemPrompt,
    scene: d.scenario || '',
    dialogueExamples: d.mes_example || '',
    avatar: d.avatar || '',
    bodyProfile,
    emotionProfile,
    // ★ 世界书（character_book）透传，避免静默丢失
    characterBook: d.character_book ?? null,
    alternateGreetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings : null,
  };
}

/** 进入提示词的文本字段白名单（结构化字段不在此列，避免被误转） */
const TEXT_FIELDS = [
  'name', 'description', 'firstMessage', 'personality', 'relationship',
  'systemPrompt', 'callUser', 'avatar', 'chatBg', 'background',
  'cgImage', 'scene', 'dialogueExamples',
];

/**
 * 把任意值安全转为文本，避免对象/数组被隐式转成 `[object Object]` 进入提示词。
 *
 * 作为通用工具供所有进入提示词的文本字段使用：只守卫 ST v2/v3 的 personality
 * 字段的话，通用格式与原生直通路径遇到对象型字段会静默变成 `[object Object]`。
 */
function toSafeText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join('\n');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * 对 Utopia 原生格式的文本字段做安全转换。
 *
 * 只处理 TEXT_FIELDS 白名单内且存在的字段：
 *  - 存在的对象/数组型字段 → 转文本，避免变成 [object Object]
 *  - 不存在的字段 → 不塞默认值，保持原样（避免改变既有语义）
 * 结构化字段（personalityParameters / emotionState / bodyState 等）一律原样透传。
 */
function sanitizeUtopiaTextFields(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const field of TEXT_FIELDS) {
    if (out[field] !== undefined) {
      out[field] = toSafeText(out[field]);
    }
  }
  return out;
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
    // 所有进入提示词的文本字段统一走 toSafeText 守卫：
    // 对象/数组型的 personality、description 会被隐式转成 [object Object]。
    name: toSafeText(data.name),
    description: toSafeText(data.description),
    firstMessage: toSafeText(data.firstMessage),
    personality: toSafeText(data.personality),
    relationship: toSafeText(data.relationship),
    systemPrompt: toSafeText(data.systemPrompt),
    callUser: toSafeText(data.callUser) || '用户',
    avatar: toSafeText(data.avatar),
    dialogueExamples: toSafeText(data.dialogueExamples),
    background: toSafeText(data.background),
    cgImage: toSafeText(data.cgImage),
    scene: toSafeText(data.scene),
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
      alternate_greetings: char.alternateGreetings || [],
      character_book: char.characterBook || null,
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
    character_book: char.characterBook || null,
    alternate_greetings: char.alternateGreetings || [],
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