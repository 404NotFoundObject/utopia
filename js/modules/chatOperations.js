// js/modules/chatOperations.js
import { getStores } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { generateUUID } from '../core/utils.js';
import { getGameTime, getTimeContext } from './time.js';
import {
  removeMessageFromConversation,
  addMessageToConversation,
  updateConversationWithLock,
} from './conversation.js';
import { deleteMemory, addMemory, searchMemories } from './memory.js';
import { sendChatRequest } from '../core/api.js';
import { getCurrentCharacter, syncCharacterState } from './character.js';
import {
  handleInteraction,
  buildEmotionPrompt,
} from './emotionEngine.js';
import {
  buildBodyPrompt,
} from './bodyState.js';
import { applyInjection } from './injector.js';
import { showToast } from '../ui/components/toast.js';
import {
  fitContextByBudget,
  systemMsg,
  PRIORITY,
  formatBudgetReport,
  computeBudget,
  getWorldBookBudgetRatio,
} from './tokenBudget.js';

let _chatUIModule = null;
async function getChatUI() {
  if (!_chatUIModule) {
    _chatUIModule = await import('../ui/screens/chatUI.js');
  }
  return _chatUIModule;
}

let _stores = null;
async function getS() {
  if (!_stores) _stores = await getStores();
  return _stores;
}

/**
 * 查找与给定"用户消息 + 助手回复"对应的记忆条目
 *
 * @param {Object[]} allMemories - 该角色的所有记忆
 * @param {string} userContent - 用户消息内容
 * @param {string} assistantContent - 助手回复内容
 * @returns {Object[]} 匹配的记忆数组（0 或 1 条）
 */
function findRelatedMemories(allMemories, userContent, assistantContent) {
  const matched = allMemories.filter(m =>
    m.userMessage === userContent &&
    m.assistantMessage === assistantContent
  );

  if (matched.length === 0) return [];
  if (matched.length === 1) return matched;

  matched.sort((a, b) => b.timestamp - a.timestamp);
  return matched.slice(0, 1);
}

export async function getOperationHistory(convId) {
  const stores = await getS();
  const conv = await stores.conversations.get(convId);
  if (!conv) return [];
  return conv.operations || [];
}

// recordOperation 保留为导出 API（插件可能使用），内部走锁
export async function recordOperation(convId, operation) {
  return updateConversationWithLock(convId, (conv) => {
    if (!conv.operations) conv.operations = [];
    conv.operations.push({
      id: generateUUID(),
      ...operation,
      timestamp: getGameTime(),
    });
    if (conv.operations.length > 100) {
      conv.operations = conv.operations.slice(-100);
    }
  });
}

/**
 * 撤回上一轮对话
 */
export async function undoLastMessage(convId) {
  const state = getAppState();
  if (state.get('sending')) {
    console.warn('[Undo] 已有消息正在处理中，忽略本次撤回');
    return { success: false, reason: '正在生成回复，请稍候' };
  }

  const stores = await getS();

  const result = await updateConversationWithLock(convId, async (conv) => {
    const messages = conv.messages;
    if (messages.length === 0) {
      return { success: false, reason: '没有可撤回的消息' };
    }

    let userMsgIndex = -1;
    let assistantMsgIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && userMsgIndex === -1) userMsgIndex = i;
      if (messages[i].role === 'assistant' && assistantMsgIndex === -1) assistantMsgIndex = i;
      if (userMsgIndex !== -1 && assistantMsgIndex !== -1) {
        if (userMsgIndex < assistantMsgIndex) break;
        userMsgIndex = -1;
        assistantMsgIndex = -1;
      }
    }

    if (userMsgIndex === -1 || assistantMsgIndex === -1) {
      return { success: false, reason: '没有找到可撤回的对话对' };
    }

    const userMsg = messages[userMsgIndex];
    const assistantMsg = messages[assistantMsgIndex];
    const allMemories = await stores.memories.getByIndex('characterId', conv.characterId);
    const relatedMemories = findRelatedMemories(
      allMemories,
      userMsg.content,
      assistantMsg.content
    );

    for (const mem of relatedMemories) {
      await deleteMemory(mem.id);
    }

    const sortedIndices = [userMsgIndex, assistantMsgIndex].sort((a, b) => b - a);
    for (const idx of sortedIndices) conv.messages.splice(idx, 1);

    // 记录操作（在同一个锁内，避免竞态）
    if (!conv.operations) conv.operations = [];
    conv.operations.push({
      id: generateUUID(),
      type: 'undo',
      data: {
        userMessageId: userMsg.id,
        assistantMessageId: assistantMsg.id,
        userContent: userMsg.content,
        assistantContent: assistantMsg.content,
        memoryIds: relatedMemories.map(m => m.id),
      },
      timestamp: getGameTime(),
    });
    if (conv.operations.length > 100) {
      conv.operations = conv.operations.slice(-100);
    }

    return { success: true, userMsg, assistantMsg, relatedMemories };
  });

  if (!result) {
    return { success: false, reason: '会话不存在' };
  }
  if (!result.success) {
    return result;
  }

  const chatUI = await getChatUI();

  const isCurrentConvAtEnd = state.get('currentMode') === 'chat'
                          && state.get('currentConversationId') === convId;
  if (isCurrentConvAtEnd) {
    await chatUI.renderConversation(convId);
  }

  return {
    success: true,
    removed: {
      user: result.userMsg,
      assistant: result.assistantMsg,
      memories: result.relatedMemories.length,
    },
  };
}

export async function regenerateLastReply(convId) {
  const state = getAppState();

  if (state.get('sending')) {
    console.warn('[Regenerate] 已有消息正在处理中，忽略本次重新生成');
    return { success: false, reason: '正在处理其他消息，请稍候' };
  }
  state.set('sending', true);

  try {
    const stores = await getS();

    // ---------- 阶段 1：锁内准备 ----------
    const setupResult = await updateConversationWithLock(convId, async (conv) => {
      const messages = conv.messages;
      if (messages.length === 0) {
        return { success: false, reason: '没有消息可重新生成' };
      }

      let assistantIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          assistantIndex = i;
          break;
        }
      }
      if (assistantIndex === -1) {
        return { success: false, reason: '没有 AI 回复可重新生成' };
      }

      const assistantMsg = messages[assistantIndex];
      let userIndex = -1;
      for (let i = assistantIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          userIndex = i;
          break;
        }
      }
      if (userIndex === -1) {
        return { success: false, reason: '没有对应的用户消息' };
      }

      const userMsg = messages[userIndex];

      const allMemories = await stores.memories.getByIndex('characterId', conv.characterId);
      const relatedMemories = findRelatedMemories(
        allMemories,
        userMsg.content,
        assistantMsg.content
      );
      for (const mem of relatedMemories) {
        await deleteMemory(mem.id);
      }

      conv.messages.splice(assistantIndex, 1);

      if (!conv.operations) conv.operations = [];
      conv.operations.push({
        id: generateUUID(),
        type: 'regenerate',
        data: {
          userMessageId: userMsg.id,
          oldAssistantMessageId: assistantMsg.id,
          oldAssistantContent: assistantMsg.content,
          memoryIds: relatedMemories.map(m => m.id),
        },
        timestamp: getGameTime(),
      });
      if (conv.operations.length > 100) {
        conv.operations = conv.operations.slice(-100);
      }

      return { success: true, userMsg, assistantMsg, relatedMemories };
    });

    if (!setupResult) {
      return { success: false, reason: '会话不存在' };
    }
    if (!setupResult.success) {
      return setupResult;
    }

    const userMsg = setupResult.userMsg;

    let character = getCurrentCharacter();
    if (!character) return { success: false, reason: '未找到角色' };
    try {
      await syncCharacterState(character.id);

      const fresh = (state.get('characters') || []).find(c => c.id === character.id);
      if (fresh) {
        character = fresh;
      }
    } catch (e) {
      console.warn('[Regenerate] 状态刷新失败:', e);
    }

    const settings = state.get('settings') || {};

    // 重新读取锁内修改后的 conv，用于后续构建
    const conv = await stores.conversations.get(convId);

    const systemMessages = [];

    const emotionPrompt = buildEmotionPrompt(character);
    if (emotionPrompt) {
      systemMessages.push(systemMsg(emotionPrompt, 'emotion', PRIORITY.EMOTION));
    }
    const bodyPrompt = buildBodyPrompt(character);
    if (bodyPrompt) {
      systemMessages.push(systemMsg(bodyPrompt, 'body', PRIORITY.BODY));
    }

    if (character.dialogueExamples && character.dialogueExamples.trim()) {
      const exampleText = `【对话风格参考】\n以下是该角色的典型对话示例，请模仿其语气和风格：\n${character.dialogueExamples}`;
      systemMessages.push(systemMsg(exampleText, 'examples', PRIORITY.EXAMPLES));
    }

    const pendingInjection = state.get('pendingInjection');
    if (pendingInjection) {
      systemMessages.push(systemMsg(`【临时注入】${pendingInjection}`, 'injection', PRIORITY.USER_CONTEXT));
      state.set('pendingInjection', null);
    }


    const summary = conv.summary || '';
    if (summary) {
      systemMessages.push(systemMsg(`【对话摘要】${summary}`, 'summary', PRIORITY.SUMMARY));
    }

    try {
      const memoryResults = await searchMemories(character.id, userMsg.content, 5);
      if (memoryResults.length > 0) {
        let memoryContext = '【长期记忆】以下是您之前与我的相关对话片段，供参考：\n';
        memoryResults.forEach((mem, idx) => {
          memoryContext += `[${idx + 1}] 您曾问："${mem.userMessage}"\n我回答："${mem.assistantMessage}"\n`;
        });
        systemMessages.push(systemMsg(memoryContext, 'memory', PRIORITY.MEMORY));
      }
    } catch (e) {
      console.warn('[Regenerate] 记忆检索失败:', e);
    }

    const contextMode = settings.contextMode || 'smart';
    let historyMessages = [];

    if (contextMode === 'full') {
      historyMessages = conv.messages.map(m => ({ role: m.role, content: m.content }));
    } else if (contextMode === 'summary_only') {
      const lastMsg = conv.messages.slice(-1);
      if (lastMsg.length) historyMessages = lastMsg.map(m => ({ role: m.role, content: m.content }));
    } else {
      historyMessages = conv.messages.slice(-20).map(m => ({ role: m.role, content: m.content }));
    }

    const modelName = settings.modelName;
    const tbEnabled = settings.tokenBudget?.enabled !== false;
    const wbBudgetRatio = getWorldBookBudgetRatio();

    let worldBookBudget;
    let systemBudgetOverride;

    if (tbEnabled) {
      const rawBudget = computeBudget(modelName);
      const rawSystemBudget = rawBudget.breakdown.system;
      worldBookBudget = Math.floor(rawSystemBudget * wbBudgetRatio);
      systemBudgetOverride = rawSystemBudget - worldBookBudget;
    } else {
      const rawBudget = computeBudget(modelName);
      worldBookBudget = Math.floor(rawBudget.breakdown.system * wbBudgetRatio);
      systemBudgetOverride = undefined;
    }

    const budgetResult = fitContextByBudget({
      modelName,
      systemMessages,
      historyMessages,
      userMessage: '',
      summary,
      systemBudgetOverride,
    });

    console.log(formatBudgetReport(budgetResult.stats));

    if (typeof window !== 'undefined') {
      window.__lastBudgetStats = budgetResult.stats;
    }

    const messagesForAPI = [
      ...budgetResult.systemKept.map(m => ({ role: 'system', content: m.content })),
      ...budgetResult.historyKept,
    ];

    const timeContext = getTimeContext();
    const context = {
      character,
      emotionState: character.emotionState,
      bodyState: character.bodyState,
      user: {
        ...(settings.user || { name: '用户' }),
        message: userMsg.content,
      },
      conversation: conv,
      ...timeContext,
    };

    // ---------- 阶段 2：写入消息 + 流式请求 ----------
    let newAssistantMsg = null;
    let msgAdded = false;
    let messageCommitted = false;
    let chatUI = null;
    let abortController = null;

    try {
      const result = await applyInjection(messagesForAPI, context, { worldBookBudget });

      const finalMessages = result;

      let finalContent = '';
      newAssistantMsg = {
        id: generateUUID(),
        role: 'assistant',
        content: '',
        timestamp: getGameTime(),
      };
      await addMessageToConversation(convId, newAssistantMsg);
      msgAdded = true;

      chatUI = await getChatUI();

      const isCurrentConvAtStart = state.get('currentCharacterId') === character.id
                                && state.get('currentMode') === 'chat';
      if (isCurrentConvAtStart) {
        chatUI.appendMessage(newAssistantMsg);
      }

      abortController = new AbortController();

      await sendChatRequest({
        messages: finalMessages,
        systemPrompt: '',                          
        preserveSystemInMessages: true,            
        model: settings.modelName,
        stream: true,
        signal: abortController.signal,            
        onChunk: (chunk) => {
          finalContent += chunk;
          chatUI.updateMessageContent(newAssistantMsg.id, finalContent);
          chatUI.scrollToBottom();
        },
      });

      await updateConversationWithLock(convId, (conv2) => {
        const msgIndex = conv2.messages.findIndex(m => m.id === newAssistantMsg.id);
        if (msgIndex !== -1) {
          conv2.messages[msgIndex].content = finalContent;
        }
      });
      messageCommitted = true;

      if (finalContent && finalContent.trim()) {
        await addMemory(character.id, userMsg.content, finalContent);
      }

      const isCurrentConvAtEnd = state.get('currentCharacterId') === character.id
                              && state.get('currentMode') === 'chat';
      if (isCurrentConvAtEnd) {
        await chatUI.renderConversation(convId);
      }

      return { success: true, newContent: finalContent };
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[Regenerate] 用户取消了重新生成');
      } else {
        console.error('重新生成失败:', error);
      }

      if (msgAdded && !messageCommitted && newAssistantMsg) {
        try {
          await removeMessageFromConversation(convId, newAssistantMsg.id);
        } catch (cleanupErr) {
          console.warn('[Regenerate] 清理数据库消息失败:', cleanupErr);
        }
        try {
          if (!chatUI) chatUI = await getChatUI();
          chatUI.removeMessage(newAssistantMsg.id);
        } catch (cleanupErr) {
          console.warn('[Regenerate] 清理 UI 消息失败:', cleanupErr);
        }
      }

      if (error.name === 'AbortError') {
        showToast('已取消重新生成', 'info');
        return { success: false, reason: '已取消' };
      } else {
        showToast('重新生成失败: ' + error.message, 'error');
        return { success: false, reason: error.message };
      }
    }
  } finally {
    state.set('sending', false);
  }
}

export async function getUndoablePair(convId) {
  const stores = await getS();
  const conv = await stores.conversations.get(convId);
  if (!conv) return null;
  const messages = conv.messages;
  for (let i = messages.length - 1; i >= 1; i--) {
    if (messages[i].role === 'assistant' && messages[i - 1].role === 'user') {
      return { user: messages[i - 1], assistant: messages[i] };
    }
  }
  return null;
}