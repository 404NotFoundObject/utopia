// js/modules/character.js - 角色管理模块（含 PNG 卡头像提取 + 个性化 profile）
import { getStores } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { generateUUID } from '../core/utils.js';
import { showToast } from '../ui/components/toast.js';
import { loadConversations } from './conversation.js';
import { testApiConnection } from '../core/api.js';
import { getDefaultEmotionState, getInitialEmotionState, updateEmotionByTime } from './emotionEngine.js';
import { getDefaultBodyState, getInitialBodyState, updateBodyByTime } from './bodyState.js';
import { getGameTime } from './time.js';
import { deleteCharacterSocialData } from './social.js';
import globalEventBus from '../core/eventBus.js';
import { detectFormat, parsePNG, convertToUtopia, convertFromUtopia } from './characterAdapter.js';
import {
  deriveBodyProfileFromPersonality,
  deriveEmotionProfileFromPersonality,
  normalizeBodyProfile,
  normalizeEmotionProfile,
} from './profileDefaults.js';

let _stores = null;
async function getS() {
  if (!_stores) _stores = await getStores();
  return _stores;
}

// ============================================================
// 角色更新串行锁
// ============================================================
const _updateLocks = new Map();

async function _withCharacterLock(characterId, fn) {
  const prev = _updateLocks.get(characterId) || Promise.resolve();
  let release;
  const current = new Promise(r => { release = r; });
  _updateLocks.set(characterId, current);

  try {
    await prev;
  } catch (_) {}

  try {
    return await fn();
  } finally {
    release();
    if (_updateLocks.get(characterId) === current) {
      _updateLocks.delete(characterId);
    }
  }
}

// ============================================================
// loadCharacters
// ============================================================
export async function loadCharacters() {
  const stores = await getS();
  const list = await stores.characters.getAll();
  const now = getGameTime();
  const nowReal = Date.now();

  for (const char of list) {
    let needUpdate = false;

    if (!char.emotionState) {
      const defaultEmotion = getDefaultEmotionState();
      defaultEmotion.lastUpdate = now;
      char.emotionState = defaultEmotion;
      needUpdate = true;
    }
    if (!char.bodyState) {
      const defaultBody = getDefaultBodyState();
      defaultBody.lastUpdate = now;
      char.bodyState = defaultBody;
      needUpdate = true;
    }
    if (char.gender === undefined) {
      char.gender = 'unknown';
      needUpdate = true;
    }
    if (char.lastSentMessageCount === undefined) {
      char.lastSentMessageCount = 0;
      needUpdate = true;
    }
    if (!char.lastInteraction) {
      char.lastInteraction = { gameTime: now, realTime: nowReal };
      needUpdate = true;
    }
    if (!char.groups) {
      char.groups = [];
      needUpdate = true;
    }
    if (char.dialogueExamples === undefined) {
      char.dialogueExamples = '';
      needUpdate = true;
    }
    if (char.ttsVoice === undefined) {
      char.ttsVoice = null;
      needUpdate = true;
    }
    if (char.ttsSpeed === undefined) {
      char.ttsSpeed = 1.0;
      needUpdate = true;
    }
    if (char.ttsPitch === undefined) {
      char.ttsPitch = 1.0;
      needUpdate = true;
    }
    if (char.lastProactiveTime === undefined) {
      char.lastProactiveTime = null;
      needUpdate = true;
    }
    if (char.unreadProactiveMessage === undefined) {
      char.unreadProactiveMessage = null;
      needUpdate = true;
    }
    if (char.unreadProactiveType === undefined) {
      char.unreadProactiveType = null;
      needUpdate = true;
    }
    if (char.inCall === undefined) {
      char.inCall = false;
      needUpdate = true;
    }

    if (!char.bodyProfile) {
      char.bodyProfile = deriveBodyProfileFromPersonality(char.personalityParameters);
      needUpdate = true;
    } else {
      // 已存在则归一化（clamp + 补齐缺失字段）
      const normalized = normalizeBodyProfile(char.bodyProfile);
      if (JSON.stringify(normalized) !== JSON.stringify(char.bodyProfile)) {
        char.bodyProfile = normalized;
        needUpdate = true;
      }
    }
    if (!char.emotionProfile) {
      char.emotionProfile = deriveEmotionProfileFromPersonality(char.personalityParameters);
      needUpdate = true;
    } else {
      const normalized = normalizeEmotionProfile(char.emotionProfile);
      if (JSON.stringify(normalized) !== JSON.stringify(char.emotionProfile)) {
        char.emotionProfile = normalized;
        needUpdate = true;
      }
    }

    if (needUpdate) {
      await stores.characters.update(char.id, char);
    }
  }

  list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const state = getAppState();
  state.set('characters', list);

  const currentId = state.get('currentCharacterId');
  if (currentId && !list.find(c => c.id === currentId)) {
    state.set('currentCharacterId', null);
    state.set('currentConversationId', null);
  }
  return list;
}

// ============================================================
// createCharacter
// ============================================================
/**
 * 创建角色
 *
 * @param {Object} data - 角色数据
 * @param {Object} [opts]
 * @param {boolean} [opts.skipApiCheck=false] - 是否跳过 API 连通性检查
 *   默认 false：创建前强制检查 API，保证性格量化和动态开场白可用。
 *   导入路径传 true：允许用户在未配置 API 时导入角色卡，
 *   此时性格量化和动态开场白会使用默认值，由调用方负责提示用户。
 */
export async function createCharacter(data, opts = {}) {
  const { skipApiCheck = false } = opts;

  if (!skipApiCheck) {
    const isConnected = await testApiConnection(true);
    if (!isConnected) {
      showToast('请先配置有效的 API 密钥（设置 → API 配置）', 'warning');
      throw new Error('API 未连通，无法创建角色');
    }
  }

  const personality = data.personalityParameters || {};
  const now = getGameTime();

  let emotionState = data.emotionState;
  if (!emotionState) {
    emotionState = getInitialEmotionState(personality);
  }
  emotionState.lastUpdate = now;

  let bodyState = data.bodyState;
  if (!bodyState) {
    bodyState = getInitialBodyState(now, personality);
  }
  bodyState.lastUpdate = now;

  const bodyProfile = data.bodyProfile
    ? normalizeBodyProfile(data.bodyProfile)
    : deriveBodyProfileFromPersonality(personality);
  const emotionProfile = data.emotionProfile
    ? normalizeEmotionProfile(data.emotionProfile)
    : deriveEmotionProfileFromPersonality(personality);

  const character = {
    id: generateUUID(),
    name: data.name || '未命名角色',
    gender: data.gender || 'unknown',
    description: data.description || '',
    firstMessage: data.firstMessage || '',
    personality: data.personality || '',
    relationship: data.relationship || '',
    systemPrompt: data.systemPrompt || '',
    callUser: data.callUser || '用户',
    avatar: data.avatar || '',
    chatBg: data.chatBg || '',
    schema: data.schema || 'utopia-character/v3.1',
    background: data.background || '',
    cgImage: data.cgImage || '',
    personalityParameters: data.personalityParameters || null,
    generateFirstMessage: data.generateFirstMessage !== undefined ? data.generateFirstMessage : true,
    scene: data.scene || '',
    lastQuantifiedAt: data.lastQuantifiedAt || null,
    emotionState: emotionState,
    bodyState: bodyState,
    bodyProfile: bodyProfile,
    emotionProfile: emotionProfile,
    lastSentMessageCount: data.lastSentMessageCount || 0,
    lastInteraction: data.lastInteraction || { gameTime: now, realTime: Date.now() },
    groups: data.groups || [],
    dialogueExamples: data.dialogueExamples || '',
    ttsVoice: data.ttsVoice || null,
    ttsSpeed: data.ttsSpeed ?? 1.0,
    ttsPitch: data.ttsPitch ?? 1.0,
    lastProactiveTime: data.lastProactiveTime || null,
    unreadProactiveMessage: data.unreadProactiveMessage || null,
    unreadProactiveType: data.unreadProactiveType || null,
    inCall: data.inCall || false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const stores = await getS();
  await stores.characters.add(character);
  await loadCharacters();
  showToast('角色创建成功', 'success');

  const userProvidedProfile = !!(data.bodyProfile || data.emotionProfile);
  import('./personality.js').then(({ autoQuantifyIfNeeded }) => {
    autoQuantifyIfNeeded(character, true, {
      preserveProfiles: userProvidedProfile,
    }).catch(err => {
      console.warn('后台量化失败:', err);
    });
  });

  return character;
}

// ============================================================
// updateCharacter（串行队列保护）
// ============================================================
export async function updateCharacter(id, updates, opts = {}) {
  return _withCharacterLock(id, async () => {
    const stores = await getS();
    const existing = await stores.characters.get(id);
    if (!existing) throw new Error('角色不存在');
    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    await stores.characters.update(id, updated);

    if (opts.skipReload === true) {
      const state = getAppState();
      const list = state.get('characters') || [];
      let found = false;
      const next = list.map(c => {
        if (c.id === id) {
          found = true;
          return updated;
        }
        return c;
      });
      if (found) {
        state.set('characters', next);
      } else {
        await loadCharacters();
      }
    } else {
      await loadCharacters();
    }
    return updated;
  });
}

// ============================================================
// deleteCharacter
// ============================================================
export async function deleteCharacter(id) {
  const stores = await getS();

  const convs = await stores.conversations.getByIndex('characterId', id);
  for (const conv of convs) {
    await stores.conversations.delete(conv.id);
  }

  await stores.characters.delete(id);

  await deleteCharacterSocialData(id);

  const memories = await stores.memories.getByIndex('characterId', id);
  for (const mem of memories) {
    await stores.memories.delete(mem.id);
  }

  const groupMembers = await stores.group_members.getByIndex('memberId', id);
  for (const member of groupMembers) {
    await stores.group_members.delete(member.id);
  }

  try {
    const charRules = await stores.world_book.getByIndex('scope', `character:${id}`);
    for (const rule of charRules) {
      await stores.world_book.delete(rule.id);
    }
    if (charRules.length > 0) {
      console.log(`[Character] 已清理角色 ${id} 的 ${charRules.length} 条世界书规则`);
      try {
        const { reloadWorldBookRules } = await import('./worldBook.js');
        await reloadWorldBookRules();
      } catch (e) {
        console.warn('[Character] 重建世界书规则失败:', e);
      }
    }
  } catch (e) {
    console.warn('[Character] 清理角色世界书规则失败:', e);
  }

  await loadCharacters();

  const state = getAppState();
  if (state.get('currentCharacterId') === id) {
    state.set('currentCharacterId', null);
    state.set('currentConversationId', null);
  }

  showToast('角色已删除', 'success');
}

// ============================================================
// 导入/导出
// ============================================================
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 导入角色（支持 JSON / PNG 卡）
 */
export async function importCharacter(input, fileName = '') {
  let rawData;
  let format;
  let pngDataURL = null;

  if (input instanceof File) {
    const isPNG = input.type === 'image/png' || fileName.toLowerCase().endsWith('.png');

    if (isPNG) {
      try {
        pngDataURL = await fileToDataURL(input);
      } catch (err) {
        console.warn('[Import] PNG 图片转 DataURL 失败:', err);
        pngDataURL = null;
      }

      try {
        const json = await parsePNG(input);
        rawData = json;
        format = detectFormat(json);
      } catch (err) {
        throw new Error('PNG 卡解析失败: ' + err.message);
      }
    } else {
      const text = await input.text();
      try {
        rawData = JSON.parse(text);
        format = detectFormat(rawData);
      } catch {
        format = 'unknown';
        rawData = text;
      }
    }
  } else if (typeof input === 'string') {
    try {
      rawData = JSON.parse(input);
      format = detectFormat(rawData);
    } catch {
      format = 'unknown';
      rawData = input;
    }
  } else {
    rawData = input;
    format = detectFormat(rawData);
  }

  if (format === 'unknown') {
    throw new Error('无法识别的角色卡格式。支持: Utopia、SillyTavern (v2/v3)、PNG 卡、Character.AI、通用格式');
  }

  if (pngDataURL && (format === 'st-v2' || format === 'st-v3')) {
    try {
      if (rawData.data) {
        rawData.data.avatar = pngDataURL;
      } else {
        rawData.avatar = pngDataURL;
      }
    } catch (err) {
      console.warn('[Import] 设置 PNG 头像失败:', err);
    }
  }

  const charData = convertToUtopia(rawData, format);

  if (!charData.avatar && pngDataURL) {
    charData.avatar = pngDataURL;
  }

  return createCharacter(charData, { skipApiCheck: true });
}

export async function exportCharacter(id, targetFormat = 'utopia-v3.1') {
  const stores = await getS();
  const char = await stores.characters.get(id);
  if (!char) throw new Error('角色不存在');

  if (targetFormat === 'utopia-v3.1' || targetFormat === 'utopia-v3') {
    const exportData = {
      schema: char.schema || 'utopia-character/v3.1',
      name: char.name,
      gender: char.gender || 'unknown',
      description: char.description,
      firstMessage: char.firstMessage,
      personality: char.personality,
      relationship: char.relationship,
      systemPrompt: char.systemPrompt,
      callUser: char.callUser,
      avatar: char.avatar,
      chatBg: char.chatBg || '',
      background: char.background || '',
      cgImage: char.cgImage || '',
      personalityParameters: char.personalityParameters || null,
      generateFirstMessage: char.generateFirstMessage !== undefined ? char.generateFirstMessage : true,
      scene: char.scene || '',
      lastQuantifiedAt: char.lastQuantifiedAt || null,
      dialogueExamples: char.dialogueExamples || '',
      ttsVoice: char.ttsVoice || null,
      ttsSpeed: char.ttsSpeed ?? 1.0,
      ttsPitch: char.ttsPitch ?? 1.0,
      bodyProfile: char.bodyProfile || null,
      emotionProfile: char.emotionProfile || null,
    };
    return JSON.stringify(exportData, null, 2);
  }

  const converted = convertFromUtopia(char, targetFormat);
  return JSON.stringify(converted, null, 2);
}

export function getCurrentCharacter() {
  const state = getAppState();
  const id = state.get('currentCharacterId');
  if (!id) return null;
  const chars = state.get('characters');
  return chars.find(c => c.id === id) || null;
}

export async function selectCharacter(id) {
  const state = getAppState();

  state.set('currentMode', 'chat');
  state.set('currentGroupId', null);

  const prevId = state.get('currentCharacterId');
  if (prevId === id) {
    state.set('currentCharacterId', null);
  }
  state.set('currentCharacterId', id);

  await loadConversations(id);
  const char = getCurrentCharacter();
  globalEventBus.emit('character:switched', {
    characterId: id,
    character: char,
    timestamp: Date.now(),
  });
}

// ============================================================
// 状态同步
// ============================================================
export async function syncCharacterState(id) {
  const stores = await getS();
  const char = await stores.characters.get(id);
  if (!char) return;
  const now = getGameTime();
  let lastUpdate = Math.max(
    char.emotionState?.lastUpdate || 0,
    char.bodyState?.lastUpdate || 0
  );
  if (lastUpdate === 0) {
    lastUpdate = now;
  }
  const hours = (now - lastUpdate) / (1000 * 60 * 60);
  if (hours > 0.01) {
    if (char.emotionState) {
      await updateEmotionByTime(char, hours);
    }
    if (char.bodyState) {
      await updateBodyByTime(char, hours);
    }
  }
}

export async function syncAllCharactersState() {
  const stores = await getS();
  const list = await stores.characters.getAll();
  for (const char of list) {
    await syncCharacterState(char.id);
  }
}

export async function getCharacterGroups(characterId) {
  const stores = await getS();
  const char = await stores.characters.get(characterId);
  if (!char) return [];
  const groups = [];
  for (const gid of (char.groups || [])) {
    const group = await stores.groups.get(gid);
    if (group && group.status === 'active') {
      groups.push(group);
    }
  }
  return groups;
}