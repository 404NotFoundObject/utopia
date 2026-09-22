// js/modules/personality.js - 性格/体质/情绪量化模块
import { sendChatRequest } from '../core/api.js';
import { updateCharacter } from './character.js';
import { showToast } from '../ui/components/toast.js';
import {
  normalizeBodyProfile,
  normalizeEmotionProfile,
  deriveBodyProfileFromPersonality,
  deriveEmotionProfileFromPersonality,
  getSpecialTypeList,
} from './profileDefaults.js';

export function getDefaultPersonality() {
  return {
    neuroticism: 50,
    extraversion: 50,
    agreeableness: 50,
    openness: 50,
    conscientiousness: 50,
    expressiveness: 50,
  };
}

// ============================================================
// 提示词构建
// ============================================================

function buildQuantifyPrompt(character) {
  const specialTypes = getSpecialTypeList()
    .map(t => `  - "${t.id}"（${t.label}）：${t.description}`)
    .join('\n');

  return `你是一个角色分析专家。请分析以下角色的性格、体质和情绪特征，输出三组参数。

角色信息：
- 名称：${character.name}
- 简介：${character.description || '无'}
- 性格描述：${character.personality || '无'}
- 关系：${character.relationship || '无'}
- 系统提示词：${character.systemPrompt ? character.systemPrompt.substring(0, 300) : '无'}

【输出格式】
必须且只能输出一个 JSON 对象，包含三个字段：
{
  "personality": {
    "neuroticism": 0-100整数,
    "extraversion": 0-100整数,
    "agreeableness": 0-100整数,
    "openness": 0-100整数,
    "conscientiousness": 0-100整数,
    "expressiveness": 0-100整数
  },
  "bodyProfile": {
    "chronotype": "morning" | "neutral" | "evening",
    "circadianEnabled": true | false,
    "sleepNeedHours": 0-14数字,
    "allowNapping": true | false,
    "napTendency": 0-1数字,
    "energyDecayFactor": 0-3数字,
    "energyRecoveryFactor": 0-3数字,
    "sleepinessRateFactor": 0-3数字,
    "wakeEase": 0-1数字,
    "constitution": 0-1数字,
    "illnessResistance": 0-1数字,
    "injuryResistance": 0-1数字,
    "recoverySpeed": 0-3数字,
    "special": null 或以下值之一
  },
  "emotionProfile": {
    "emotionalSensitivity": 0-1数字,
    "emotionalVolatility": 0-1数字,
    "emotionalDecayFactor": 0-3数字,
    "attachmentSpeed": 0-1数字,
    "trustRecoveryFactor": 0-3数字
  }
}

【personality 维度说明】
- neuroticism（神经质）：情绪稳定性。高分=敏感易焦虑，低分=冷静从容
- extraversion（外向性）：社交活跃度。高分=热情主动，低分=内向被动
- agreeableness（宜人性）：合作友善度。高分=温柔体贴，低分=固执挑剔
- openness（开放性）：接受新事物程度。高分=好奇浪漫，低分=传统务实
- conscientiousness（尽责性）：自律规划性。高分=认真有计划，低分=随性自由
- expressiveness（情感表达性）：情感外露程度。高分=情绪外显，低分=内敛含蓄

【bodyProfile 关键判定规则】
- 含"军人/保镖/特种兵/运动员/武僧/武道家/健身" → constitution ≥ 0.8, recoverySpeed ≥ 1.3
- 含"体弱/病弱/林黛玉/多病/孱弱/虚弱" → constitution ≤ 0.3, illnessResistance ≤ 0.3
- 含"夜猫子/晚睡/熬夜/深夜工作/不睡" → chronotype = "evening"
- 含"早起/晨练/清晨活动/习惯早起" → chronotype = "morning"
- 含"午休/小憩/习惯午睡" → allowNapping = true, napTendency ≥ 0.6
- 含"精力充沛/精力旺盛/不疲惫" → energyDecayFactor ≤ 0.6, energyRecoveryFactor ≥ 1.3
- 含"容易疲惫/精力不足" → energyDecayFactor ≥ 1.3

【bodyProfile.special 可选值】
${specialTypes}
- null：普通人类

【emotionProfile 关键判定规则】
- 敏感、细腻、多愁善感、易受伤 → emotionalSensitivity ≥ 0.7
- 冷静、理智、克制、不动声色 → emotionalSensitivity ≤ 0.3, emotionalVolatility ≤ 0.3
- 情绪起伏大、易激动、情绪化 → emotionalVolatility ≥ 0.7
- 情绪恢复快、不拘小节、心胸开阔 → emotionalDecayFactor ≥ 1.5
- 情绪久久不能平复、记仇、心事重 → emotionalDecayFactor ≤ 0.6
- 慢热、不易亲近、高冷 → attachmentSpeed ≤ 0.3
- 容易付出信任、轻信他人 → trustRecoveryFactor ≥ 1.5

【严格禁止】
- 不要输出 markdown 代码块（\`\`\`json ... \`\`\`）
- 不要输出任何解释、分析、前言或后记
- 不要输出除 JSON 以外的任何字符

请直接输出 JSON：`;
}

// ============================================================
// 解析工具
// ============================================================

const VALID_DIMS = ['neuroticism', 'extraversion', 'agreeableness', 'openness', 'conscientiousness', 'expressiveness'];

/**
 * 从模型输出中提取并解析三组参数
 * 策略优先级：
 *   1. 剥离 markdown 后直接解析
 *   2. 从文本中提取最外层 JSON 对象
 *   3. 修复被截断的 JSON
 *   4. 正则提取各字段
 */
function parseQuantifyJson(text) {
  if (!text) return null;

  let cleaned = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // 策略 1.1：直接解析
  let parsed = tryParseJson(cleaned);
  if (parsed) return normalizeResult(parsed);

  // 策略 2：提取最外层 JSON 对象
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    parsed = tryParseJson(jsonMatch[0]);
    if (parsed) return normalizeResult(parsed);
  }

  // 策略 3：修复截断
  const partialMatch = cleaned.match(/\{[\s\S]*/);
  if (partialMatch) {
    const repaired = repairTruncatedJson(partialMatch[0]);
    if (repaired) {
      parsed = tryParseJson(repaired);
      if (parsed) {
        console.log('[Quantify] 通过修复截断 JSON 成功解析');
        return normalizeResult(parsed);
      }
    }
  }

  // 策略 4：正则提取
  const extracted = extractByRegex(cleaned);
  if (extracted) {
    console.log('[Quantify] 通过正则提取成功');
    return normalizeResult(extracted);
  }

  return null;
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * 修复被截断的 JSON：尝试补齐字符串和括号
 */
function repairTruncatedJson(text) {
  let fixed = text;
  const quoteCount = (fixed.match(/"/g) || []).length;
  if (quoteCount % 2 === 1) fixed += '"';
  const openBraces = (fixed.match(/\{/g) || []).length;
  const closeBraces = (fixed.match(/\}/g) || []).length;
  fixed += '}'.repeat(Math.max(0, openBraces - closeBraces));
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;
  fixed += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
  return fixed;
}

/**
 * 用正则从任意文本中提取三组参数
 */
function extractByRegex(text) {
  const result = {};

  // ---- personality ----
  const personality = {};
  let foundP = 0;
  for (const dim of VALID_DIMS) {
    const patterns = [
      new RegExp(`"${dim}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'),
      new RegExp(`'${dim}'\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'),
      new RegExp(`${dim}\\s*[:：]\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'),
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        personality[dim] = parseInt(m[1]);
        foundP++;
        break;
      }
    }
  }
  if (foundP >= 4) {
    for (const dim of VALID_DIMS) {
      if (personality[dim] === undefined) personality[dim] = 50;
    }
    result.personality = personality;
  }

  // ---- bodyProfile ----
  const bodyProfile = {};
  let foundB = 0;
  const chronotypeMatch = text.match(/"chronotype"\s*:\s*"([^"]+)"/i);
  if (chronotypeMatch) {
    bodyProfile.chronotype = chronotypeMatch[1];
    foundB++;
  }
  const specialMatch = text.match(/"special"\s*:\s*(?:"([^"]+)"|null)/i);
  if (specialMatch !== null) {
    bodyProfile.special = specialMatch[1] || null;
    foundB++;
  }
  const bodyNumFields = [
    'sleepNeedHours', 'napTendency', 'energyDecayFactor', 'energyRecoveryFactor',
    'sleepinessRateFactor', 'wakeEase', 'constitution', 'illnessResistance',
    'injuryResistance', 'recoverySpeed',
  ];
  for (const field of bodyNumFields) {
    const m = text.match(new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'));
    if (m) {
      bodyProfile[field] = parseFloat(m[1]);
      foundB++;
    }
  }
  const circadianMatch = text.match(/"circadianEnabled"\s*:\s*(true|false)/i);
  if (circadianMatch) {
    bodyProfile.circadianEnabled = circadianMatch[1] === 'true';
    foundB++;
  }
  const nappingMatch = text.match(/"allowNapping"\s*:\s*(true|false)/i);
  if (nappingMatch) {
    bodyProfile.allowNapping = nappingMatch[1] === 'true';
    foundB++;
  }
  if (foundB >= 3) result.bodyProfile = bodyProfile;

  // ---- emotionProfile ----
  const emotionProfile = {};
  let foundE = 0;
  const emotionNumFields = [
    'emotionalSensitivity', 'emotionalVolatility', 'emotionalDecayFactor',
    'attachmentSpeed', 'trustRecoveryFactor',
  ];
  for (const field of emotionNumFields) {
    const m = text.match(new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'));
    if (m) {
      emotionProfile[field] = parseFloat(m[1]);
      foundE++;
    }
  }
  if (foundE >= 2) result.emotionProfile = emotionProfile;

  return (foundP >= 4 || foundB >= 3 || foundE >= 2) ? result : null;
}

/**
 * 规范化 LLM 返回，缺失字段用性格推导值补齐
 */
function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // ---- personality ----
  const personality = {};
  const rawP = raw.personality || raw;
  for (const dim of VALID_DIMS) {
    let val = parseInt(rawP[dim]);
    if (isNaN(val) || val < 0 || val > 100) val = 50;
    personality[dim] = val;
  }

  // ---- bodyProfile ----
  let bodyProfile = raw.bodyProfile;
  if (!bodyProfile || typeof bodyProfile !== 'object') {
    bodyProfile = deriveBodyProfileFromPersonality(personality);
  } else {
    const derived = deriveBodyProfileFromPersonality(personality);
    bodyProfile = normalizeBodyProfile({ ...derived, ...bodyProfile });
  }

  // ---- emotionProfile ----
  let emotionProfile = raw.emotionProfile;
  if (!emotionProfile || typeof emotionProfile !== 'object') {
    emotionProfile = deriveEmotionProfileFromPersonality(personality);
  } else {
    const derived = deriveEmotionProfileFromPersonality(personality);
    emotionProfile = normalizeEmotionProfile({ ...derived, ...emotionProfile });
  }

  return { personalityParameters: personality, bodyProfile, emotionProfile };
}

// ============================================================
// 量化主函数
// ============================================================

/**
 * 主入口：量化角色，返回三组参数
 *
 * @param {Object} character
 * @param {number} [retries=3]
 * @returns {Promise<{personalityParameters, bodyProfile, emotionProfile}>}
 */
export async function quantifyCharacter(character, retries = 3) {
  const prompt = buildQuantifyPrompt(character);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const maxTokens = 2000 + attempt * 500;
      console.log(`[Quantify] 尝试 ${attempt + 1}/${retries}，maxTokens=${maxTokens}`);

      const response = await sendChatRequest({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: '你是一个角色分析专家。你只输出 JSON 对象，不输出任何解释、说明或 markdown 代码块。',
        temperature: 0.1,
        maxTokens: maxTokens,
        stream: false,
      });

      const content = response.content?.trim();

      if (!content) {
        console.warn(`[Quantify] 尝试 ${attempt + 1} 返回空内容，重试...`);
        if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      console.log(`[Quantify] 尝试 ${attempt + 1} 返回内容 (前 200 字符):`, content.slice(0, 200));

      const result = parseQuantifyJson(content);
      if (!result) {
        console.warn(`[Quantify] 尝试 ${attempt + 1} JSON 解析失败，原始内容:`, content);
        if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      console.log(`[Quantify] 尝试 ${attempt + 1} 解析成功:`, result);
      return result;

    } catch (error) {
      console.warn(`[Quantify] 尝试 ${attempt + 1} 失败:`, error.message);
      if (attempt === retries - 1) break;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.warn('[Quantify] 所有尝试失败，使用默认值');
  const defaultPersonality = getDefaultPersonality();
  return {
    personalityParameters: defaultPersonality,
    bodyProfile: deriveBodyProfileFromPersonality(defaultPersonality),
    emotionProfile: deriveEmotionProfileFromPersonality(defaultPersonality),
  };
}

/**
 * 兼容 API：仅返回 personalityParameters
 * @deprecated 建议改用 quantifyCharacter 获取三组参数
 */
export async function quantifyPersonality(character, retries = 3) {
  const result = await quantifyCharacter(character, retries);
  return result.personalityParameters;
}

// ============================================================
// 自动量化（含三组参数写入）
// ============================================================

/**
 * 自动量化（含三组参数写入）
 *
 * @param {Object} character
 * @param {boolean} [force=false]
 * @param {Object} [options]
 * @param {boolean} [options.preserveProfiles=false]
 * @returns {Promise<Object>}
 */
export async function autoQuantifyIfNeeded(character, force = false, options = {}) {
  if (!character) return character;
  if (!force && character.personalityParameters && character.lastQuantifiedAt) {
    return character;
  }

  const preserveProfiles = options.preserveProfiles === true;

  try {
    const result = await quantifyCharacter(character);
    const updates = {
      personalityParameters: result.personalityParameters,
      bodyProfile: preserveProfiles && character.bodyProfile
        ? character.bodyProfile
        : result.bodyProfile,
      emotionProfile: preserveProfiles && character.emotionProfile
        ? character.emotionProfile
        : result.emotionProfile,
      lastQuantifiedAt: Date.now(),
      schema: 'utopia-character/v3.1',
    };
    await updateCharacter(character.id, updates);
    showToast('角色性格与体质量化完成', 'success');
    return { ...character, ...updates };
  } catch (error) {
    showToast('量化失败，使用默认值', 'warning');
    const defaultPersonality = getDefaultPersonality();
    const updates = {
      personalityParameters: defaultPersonality,
      bodyProfile: preserveProfiles && character.bodyProfile
        ? character.bodyProfile
        : deriveBodyProfileFromPersonality(defaultPersonality),
      emotionProfile: preserveProfiles && character.emotionProfile
        ? character.emotionProfile
        : deriveEmotionProfileFromPersonality(defaultPersonality),
      lastQuantifiedAt: Date.now(),
      schema: 'utopia-character/v3.1',
    };
    await updateCharacter(character.id, updates);
    return { ...character, ...updates };
  }
}