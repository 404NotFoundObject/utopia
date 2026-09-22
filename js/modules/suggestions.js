// js/modules/suggestions.js - 推荐回复生成
import { sendChatRequest } from '../core/api.js';
import { getCurrentCharacter } from './character.js';
import { getTimeContext } from './time.js';
import { searchMemories } from './memory.js';
import { showToast } from '../ui/components/toast.js';
import { getAppState } from '../core/state.js';

/**
 * 生成推荐回复（3-5条）
 */
export async function generateSuggestedReplies(convId, contextMessage, count = 4) {
  const stores = await import('../core/db.js').then(m => m.getStores());
  const conv = await stores.conversations.get(convId);
  if (!conv) return [];

  const character = getCurrentCharacter();
  if (!character) return [];

  const recent = conv.messages.slice(-6);
  const context = recent.map(m => `${m.role === 'user' ? '用户' : character.name}: ${m.content}`).join('\n');

  const memories = await searchMemories(character.id, contextMessage, 3);
  const memoryText = memories.length ? memories.map(m => m.userMessage + ' → ' + m.assistantMessage).join('\n') : '';

  const timeCtx = getTimeContext();
  const prompt = `你是角色“${character.name}”，请根据以下对话上下文，生成 ${count} 条用户可能说的回复（每条简短，5-15字），用于推荐给用户选择。回复要符合角色人设和当前情境。

对话历史：
${context}

当前时间：${timeCtx.gameTime.natural}
角色情绪：${character.emotionState?.valence || 0} 愉悦度
相关记忆：${memoryText || '无'}

请直接输出 ${count} 条推荐回复，每条一行，不要添加编号或前缀。`;

  try {
    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '你是一个角色扮演助手，擅长根据上下文生成合适的用户回复选项。',
      temperature: 0.8,
      maxTokens: 200,
      stream: false,
    });
    const content = response.content || '';
    const lines = content.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    return lines.slice(0, count);
  } catch (e) {
    console.error('生成推荐回复失败:', e);
    return [];
  }
}

/**
 * 显示推荐回复UI（在输入框上方）
 */
export function showSuggestionsUI(suggestions, onSelect) {
  const existing = document.getElementById('suggestions-container');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'suggestions-container';
  container.className = 'suggestions-container';

  const title = document.createElement('div');
  title.className = 'suggestions-title';
  title.textContent = '💡 推荐回复';
  container.appendChild(title);

  const list = document.createElement('div');
  list.className = 'suggestions-list';

  for (const suggestion of suggestions) {
    const btn = document.createElement('button');
    btn.className = 'suggestion-btn';
    btn.textContent = suggestion;
    btn.addEventListener('click', () => {
      container.remove();
      onSelect(suggestion);
    });
    list.appendChild(btn);
  }

  container.appendChild(list);
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.parentNode.insertBefore(container, chatInput);
  }
}