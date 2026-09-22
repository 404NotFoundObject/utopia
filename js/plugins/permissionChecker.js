/**
 * @module plugins/permissionChecker
 * @description 插件权限校验器
 *
 * 职责：
 *   - 维护「API 方法 → 所需权限」映射表
 *   - 提供权限校验函数
 *   - 权限名称的中文说明
 */

import { getPlugin } from './pluginVfs.js';

// ============================================================
// 方法 → 权限映射
// ============================================================

const METHOD_PERMISSIONS = {
  // ============================================================
  // character
  // ============================================================
  'character.getCurrentCharacter': 'character:read',
  'character.loadCharacters': 'character:read',
  'character.syncCharacterState': 'character:write',
  'character.syncAllCharactersState': 'character:write',
  'character.getCharacterGroups': 'character:read',
  'character.exportCharacter': 'character:read',
  'character.createCharacter': 'character:write',
  'character.updateCharacter': 'character:write',
  'character.deleteCharacter': 'character:write',
  'character.importCharacter': 'character:write',
  'character.selectCharacter': 'character:read',

  // ============================================================
  // conversation
  // ============================================================
  'conversation.getCurrentConversation': 'conversation:read',
  'conversation.loadConversations': 'conversation:read',
  'conversation.createNewConversation': 'conversation:write',
  'conversation.addMessageToConversation': 'conversation:write',
  'conversation.removeMessageFromConversation': 'conversation:write',
  'conversation.clearConversation': 'conversation:write',
  'conversation.deleteConversation': 'conversation:write',
  'conversation.ensureConversation': 'conversation:write',
  'conversation.updateConversationSummary': 'conversation:write',

  // ============================================================
  // chat
  // ============================================================
  'chat.sendMessage': 'chat:write',
  'chat.renderConversation': 'chat:read',
  'chat.setChatContainer': null,

  // ============================================================
  // groupChat
  // ============================================================
  'groupChat.getGroup': 'group:read',
  'groupChat.getGroupMembers': 'group:read',
  'groupChat.getGroupMessages': 'group:read',
  'groupChat.getGroupsByUser': 'group:read',
  'groupChat.createGroup': 'group:write',
  'groupChat.updateGroup': 'group:write',
  'groupChat.disbandGroup': 'group:write',
  'groupChat.addGroupMember': 'group:write',
  'groupChat.removeGroupMember': 'group:write',
  'groupChat.sendGroupMessage': 'group:write',
  'groupChat.sendUserGroupMessage': 'group:write',
  'groupChat.deleteGroupMessage': 'group:write',
  'groupChat.deleteGroupMessages': 'group:write',
  'groupChat.setGroupMemberMute': 'group:write',
  'groupChat.unMuteGroupMember': 'group:write',
  'groupChat.generateCharacterReply': 'group:write',
  'groupChat.generateCharacterReplyStream': 'group:write',
  'groupChat.generateCharacterReplySync': 'group:write',

  // ============================================================
  // groupChatEngine
  // ============================================================
  'groupChatEngine.decideSpeaker': 'group:read',
  'groupChatEngine.runAutoSpeakCycle': 'group:write',
  'groupChatEngine.extractMentionsFromMessage': 'group:read',
  'groupChatEngine.calculateSpeakProbability': 'group:read',

  // ============================================================
  // groupChatOps
  // ============================================================
  'groupChatOps.undoLastUserMessage': 'group:write',
  'groupChatOps.regenerateGroupReply': 'group:write',
  'groupChatOps.muteGroupMember': 'group:write',
  'groupChatOps.removeGroupMember': 'group:write',
  'groupChatOps.getUserRoleInGroup': 'group:read',

  // ============================================================
  // emotion
  // ============================================================
  'emotion.getDefaultEmotionState': 'character:read',
  'emotion.getInitialEmotionState': 'character:read',
  'emotion.updateEmotionByTime': 'character:write',
  'emotion.handleInteraction': 'character:write',
  'emotion.refreshEmotion': 'character:write',
  'emotion.getEmotionLabel': 'character:read',
  'emotion.getEmotionDescription': 'character:read',
  'emotion.buildEmotionPrompt': 'character:read',
  'emotion.classifyUserMessage': 'character:read',

  // ============================================================
  // bodyState
  // ============================================================
  'bodyState.getDefaultBodyState': 'character:read',
  'bodyState.getInitialBodyState': 'character:read',
  'bodyState.updateBodyByTime': 'character:write',
  'bodyState.refreshBodyState': 'character:write',
  'bodyState.tryWakeUp': 'character:write',
  'bodyState.handleBodyEvent': 'character:write',
  'bodyState.getBodyDescription': 'character:read',
  'bodyState.buildBodyPrompt': 'character:read',
  'bodyState.getSleepRefusalMessage': 'character:read',
  'bodyState.getWakingReply': 'character:read',

  // ============================================================
  // profileDefaults（★ 个性化改造：暴露给插件）
  // ------------------------------------------------------------
  // 本模块全部为"读取 / 推导 / 归一化"工具，不直接修改数据。
  // 插件修改角色的 profile 需通过 api.character.updateCharacter()
  // （使用 character:write 权限）。
  // ============================================================
  'profileDefaults.getDefaultBodyProfile': 'character:read',
  'profileDefaults.getDefaultEmotionProfile': 'character:read',
  'profileDefaults.getSpecialTypeList': 'character:read',
  'profileDefaults.deriveBodyProfileFromPersonality': 'character:read',
  'profileDefaults.deriveEmotionProfileFromPersonality': 'character:read',
  'profileDefaults.normalizeBodyProfile': 'character:read',
  'profileDefaults.normalizeEmotionProfile': 'character:read',
  'profileDefaults.getBodyProfile': 'character:read',
  'profileDefaults.getEmotionProfile': 'character:read',
  'profileDefaults.getCircadianMultiplier': 'character:read',
  // 注：SPECIAL_TYPES 是常量对象（非函数），不通过 invokeApiMethod 调用，
  //     插件可以读取 api.profileDefaults.SPECIAL_TYPES 获取定义表。

  // ============================================================
  // memory
  // ============================================================
  'memory.searchMemories': 'memory:read',
  'memory.getMemoriesByCharacter': 'memory:read',
  'memory.addMemory': 'memory:write',
  'memory.deleteMemory': 'memory:write',
  'memory.initMemoryIndex': 'memory:write',
  'memory.initMiniSearch': 'memory:write',
  'memory.getSupportedModels': 'memory:read',
  'memory.checkLocalModel': 'memory:read',
  'memory.downloadModel': 'memory:write',
  'memory.initSemanticEngine': 'memory:write',

  // ============================================================
  // time
  // ============================================================
  'time.initTime': null,
  'time.syncTime': 'time:read',
  'time.getGameTime': 'time:read',
  'time.getGameDate': 'time:read',
  'time.getTimeSpeed': 'time:read',
  'time.isTimePaused': 'time:read',
  'time.setTimeSpeed': 'time:write',
  'time.setTimePaused': 'time:write',
  'time.getTimeContext': 'time:read',
  'time.getPeriod': 'time:read',
  'time.getTimeDescription': 'time:read',
  'time.advanceGameTime': 'time:write',
  'time.resetGameTime': 'time:write',

  // ============================================================
  // worldBook
  // ============================================================
  'worldBook.getAllRules': 'worldbook:read',
  'worldBook.getRule': 'worldbook:read',
  'worldBook.addRule': 'worldbook:write',
  'worldBook.updateRule': 'worldbook:write',
  'worldBook.deleteRule': 'worldbook:write',
  'worldBook.toggleRule': 'worldbook:write',
  'worldBook.getAllGroups': 'worldbook:read',
  'worldBook.getGroup': 'worldbook:read',
  'worldBook.addGroup': 'worldbook:write',
  'worldBook.updateGroup': 'worldbook:write',
  'worldBook.deleteGroup': 'worldbook:write',
  'worldBook.toggleGroup': 'worldbook:write',
  'worldBook.getEnabledRules': 'worldbook:read',
  'worldBook.getRulesByGroup': 'worldbook:read',
  'worldBook.addRuleToGroup': 'worldbook:write',
  'worldBook.removeRuleFromGroup': 'worldbook:write',
  'worldBook.getGroupRules': 'worldbook:read',
  'worldBook.exportRules': 'worldbook:read',
  'worldBook.importRules': 'worldbook:write',
  'worldBook.exportGroups': 'worldbook:read',
  'worldBook.importGroups': 'worldbook:write',
  'worldBook.migrateWorldBookData': 'worldbook:write',
  'worldBook.reloadWorldBookRules': 'worldbook:write',
  'worldBook.getAvailableRulesForSelector': 'worldbook:read',
  'worldBook.getAvailableGroupsForSelector': 'worldbook:read',
  'worldBook.getAvailablePaths': 'worldbook:read',
  'worldBook.getAvailableOperators': 'worldbook:read',
  'worldBook.getDefaultRule': 'worldbook:read',
  'worldBook.getDefaultGroup': 'worldbook:read',
  'worldBook.getConditionDescription': 'worldbook:read',

  // ============================================================
  // injector
  // ============================================================
  'injector.applyInjection': 'injector:read',
  'injector.initInjector': 'injector:write',
  'injector.getInjector': 'injector:read',
  'injector.updateInjectorRules': 'injector:write',
  'injector.updateWorldBookRules': 'injector:write',
  'injector.resetInjectorState': 'injector:write',

  // ============================================================
  // personality
  // ============================================================
  'personality.getDefaultPersonality': 'character:read',
  'personality.quantifyPersonality': 'character:write',
  'personality.quantifyCharacter': 'character:write',
  'personality.autoQuantifyIfNeeded': 'character:write',

  // ============================================================
  // social
  // ============================================================
  'social.generatePostContent': 'social:read',
  'social.publishPostByCharacter': 'social:write',
  'social.publishPostByUser': 'social:write',
  'social.generateComment': 'social:read',
  'social.generateReplyForComment': 'social:write',
  'social.generateCommentsForPost': 'social:write',
  'social.userCommentPost': 'social:write',
  'social.getAllPosts': 'social:read',
  'social.deletePost': 'social:write',
  'social.deleteCharacterSocialData': 'social:write',
  'social.checkAutoPost': 'social:write',

  // ============================================================
  // proactiveChat
  // ============================================================
  'proactiveChat.getEligibleCharacters': 'character:read',
  'proactiveChat.buildPersonaSystemMessage': 'character:read',
  'proactiveChat.generateProactiveMessage': 'character:write',
  'proactiveChat.insertProactiveMessage': 'character:write',
  'proactiveChat.sendProactiveMessage': 'character:write',
  'proactiveChat.startProactiveVoiceCall': 'character:write',
  'proactiveChat.runProactiveCheck': 'character:write',
  'proactiveChat.startProactiveChat': 'character:write',
  'proactiveChat.stopProactiveChat': 'character:write',
  'proactiveChat.reloadProactiveChat': 'character:write',

  // ============================================================
  // settings
  // ============================================================
  'settings.loadSettings': 'settings:read',
  'settings.updateSettings': 'settings:write',
  'settings.getDefaultSettings': 'settings:read',

  // ============================================================
  // commandEngine
  // ============================================================
  'commandEngine.registerCommand': 'command:register',
  'commandEngine.getCommandList': 'command:register',
  'commandEngine.getEffectiveParams': 'command:register',
  'commandEngine.executeCommand': 'command:register',

  // ============================================================
  // summary
  // ============================================================
  'summary.generateSummary': 'conversation:read',
  'summary.shouldGenerateSummary': 'conversation:read',
  'summary.getMessagesToSummarize': 'conversation:read',
  'summary.formatMessagesForSummary': 'conversation:read',

  // ============================================================
  // suggestions
  // ============================================================
  'suggestions.generateSuggestedReplies': 'chat:read',
  'suggestions.showSuggestionsUI': null,

  // ============================================================
  // firstMessage
  // ============================================================
  'firstMessage.generateFirstMessage': 'character:read',
  'firstMessage.ensureFirstMessage': 'conversation:write',

  // ============================================================
  // api
  // ============================================================
  'api.sendChatRequest': 'api:call',
  'api.fetchModels': 'api:call',
  'api.fetchCapabilities': 'api:call',
  'api.testApiConnection': 'api:call',
  'api.resetApiAdapter': 'api:call',
  'api.clearApiConnectionCache': 'api:call',
  'api.getCurrentCapabilities': 'api:call',

  // ============================================================
  // db
  // ============================================================
  'db.openDB': 'storage:indexeddb',
  'db.getStores': 'storage:indexeddb',
  'db.getDB': 'storage:indexeddb',
  'db.checkDatabase': 'storage:indexeddb',
  'db.deleteDatabase': 'storage:indexeddb',

  // ============================================================
  // utils（无权限要求）
  // ============================================================
  'utils.generateUUID': null,
  'utils.deepClone': null,
  'utils.debounce': null,
  'utils.escapeHtml': null,
  'utils.formatTime': null,
  'utils.truncateText': null,

  // ============================================================
  // state
  // ============================================================
  'state.get': 'settings:read',
  'state.set': 'settings:write',
  // Worker 侧不支持 subscribe（回调无法跨 Worker），
  // ui.js 侧通过 uiApi.api.state.subscribe() 可用
  'state.subscribe': 'settings:read',
  'state.subscribeAll': 'settings:read',

  // ============================================================
  // ★ events（补充 on/once/off，与 subscribe/unsubscribe 等价）
  // ============================================================
  'events.on': 'event:subscribe',
  'events.once': 'event:subscribe',
  'events.off': 'event:subscribe',
  'events.subscribe': 'event:subscribe',
  'events.unsubscribe': 'event:subscribe',
  'events.emit': 'event:emit',
  'events.emitAsync': 'event:emit',
  'events.getEventNames': 'event:subscribe',

  // ============================================================
  // hooks
  // ============================================================
  'hooks.register': 'hook:register',
  'hooks.unregister': 'hook:register',
  'hooks.unregisterAll': 'hook:register',
  'hooks.list': 'hook:register',

  // ============================================================
  // tts
  // ============================================================
  'tts.speak': 'tts:use',
  'tts.stop': 'tts:use',
  'tts.pause': 'tts:use',
  'tts.resume': 'tts:use',
  'tts.isSpeaking': 'tts:use',
  'tts.getVoices': 'tts:use',
  'tts.getVoicesGroupedByLanguage': 'tts:use',
  'tts.getValidVoice': 'tts:use',
  'tts.testVoice': 'tts:use',

  // ============================================================
  // stt
  // ============================================================
  'stt.startListening': 'stt:use',
  'stt.stopListening': 'stt:use',
  'stt.resetTranscript': 'stt:use',
  'stt.getFinalTranscript': 'stt:use',
  'stt.getInterimTranscript': 'stt:use',
  'stt.isCurrentlyListening': 'stt:use',
  'stt.setLanguage': 'stt:use',
  'stt.transcribeWithWhisper': 'stt:use',
};

// ============================================================
// 权限说明标签
// ============================================================

const PERMISSION_LABELS = {
  'character:read': '读取角色信息',
  'conversation:read': '读取会话记录',
  'chat:read': '读取聊天消息',
  'group:read': '读取群聊',
  'memory:read': '读取记忆',
  'worldbook:read': '读取世界书',
  'social:read': '读取朋友圈',
  'settings:read': '读取设置',
  'time:read': '读取游戏时间',
  'injector:read': '读取注入器',

  'character:write': '创建/修改/删除角色',
  'conversation:write': '修改会话记录',
  'chat:write': '发送消息',
  'group:write': '发送群聊消息',
  'memory:write': '写入/删除记忆',
  'worldbook:write': '修改世界书',
  'social:write': '发布朋友圈',
  'settings:write': '修改设置',
  'time:write': '修改游戏时间',
  'injector:write': '修改注入规则',

  'hook:register': '注册钩子（拦截系统行为）',
  'command:register': '注册自定义命令',
  'ui:inject': '注入界面元素',

  'event:subscribe': '订阅系统事件',
  'event:emit': '发布系统事件',

  'api:call': '调用 AI API',
  'tts:use': '使用语音合成',
  'stt:use': '使用语音识别',
  'http:request': '发起网络请求',
  'storage:local': '使用 localStorage',
  'storage:indexeddb': '使用 IndexedDB',

  '*': '⚠️ 完全访问权限（不推荐）',
};

// ============================================================
// 导出函数
// ============================================================

/**
 * 获取某方法所需的权限
 * @param {string} method - "module.method" 形式
 * @returns {string|null|'__unknown__'}
 *   - 权限名（如 'character:read'）
 *   - null：无需权限
 *   - '__unknown__'：未声明的方法
 */
export function getRequiredPermission(method) {
  if (!(method in METHOD_PERMISSIONS)) {
    return '__unknown__';
  }
  return METHOD_PERMISSIONS[method];
}

export function manifestHasPermission(manifest, permission) {
  if (!manifest?.permissions) return false;
  if (manifest.permissions.includes('*')) return true;
  return manifest.permissions.includes(permission);
}

export async function checkPluginPermission(pluginId, permission) {
  const record = await getPlugin(pluginId);
  if (!record) return false;
  return manifestHasPermission(record.manifest, permission);
}

/**
 * 校验方法调用权限，失败抛异常
 */
export async function assertPermission(pluginId, method) {
  const permission = getRequiredPermission(method);

  if (permission === null) return;

  if (permission === '__unknown__') {
    throw new Error(
      `插件 "${pluginId}" 试图调用未授权的 API 方法: ${method}（该方法未在权限表中声明）`
    );
  }

  const ok = await checkPluginPermission(pluginId, permission);
  if (!ok) {
    throw new Error(
      `插件 "${pluginId}" 缺少权限: ${permission}（调用 ${method}）`
    );
  }
}

export function getPermissionLabel(permission) {
  return PERMISSION_LABELS[permission] || permission;
}

export function getAllPermissionLabels() {
  return { ...PERMISSION_LABELS };
}

export function listAllMethodPermissions() {
  return { ...METHOD_PERMISSIONS };
}