/**
 * 回复编辑插件 - UI 入口
 *
 * 功能：
 *   - 在 AI 回复上注册右键菜单，添加"✏️ 编辑此回复"选项
 *   - 使用 uiApi.dialog.prompt 编辑
 *   - 保存后通过 api.chat.renderConversation 刷新
 */

export default {
  async setup(uiApi, manifest) {
    const log = uiApi.logger;
    log.info('UI 已加载');

    // ============================================================
    // 注册右键菜单
    // ============================================================
    const removeCtxMenu = uiApi.contextMenu.register('.message, .group-message', (target) => {
      // 单聊用 .assistant 类；群聊用 data-message-role="assistant"
      const isAssistant = target.classList.contains('assistant')
        || target.dataset.messageRole === 'assistant';
      if (!isAssistant) return null;   // null 表示不显示菜单

      return [
        {
          label: '✏️ 编辑此回复',
          icon: 'fa-edit',
          onClick: () => handleEdit(target, uiApi),
        },
      ];
    }, { priority: 50 });

    log.info('已注册右键菜单');

    // ============================================================
    // 编辑处理
    // ============================================================
    async function handleEdit(messageEl, uiApi) {
      try {
        const api = uiApi.api;
        const messageId = messageEl.dataset.id || messageEl.dataset.messageId;
        if (!messageId) {
          uiApi.utils.showToast('无法定位消息ID', 'error');
          return;
        }

        // ---- 1. 读取当前内容 ----
        const bubbleEl = messageEl.querySelector('.bubble')
          || messageEl.querySelector('.group-message-bubble');
        if (!bubbleEl) {
          uiApi.utils.showToast('无法读取消息内容', 'error');
          return;
        }

        // 克隆并移除 timestamp，获取纯文本
        const clone = bubbleEl.cloneNode(true);
        const ts = clone.querySelector('.timestamp');
        if (ts) ts.remove();
        const currentContent = (clone.textContent || '').trim();

        if (!currentContent) {
          uiApi.utils.showToast('消息内容为空', 'warning');
          return;
        }

        // ---- 2. 弹出编辑框 ----
        const newContent = await uiApi.dialog.prompt(
          '编辑 AI 回复内容：',
          currentContent,
          {
            title: '编辑回复',
            okText: '保存',
            cancelText: '取消',
          }
        );

        if (newContent === null) return;                    // 用户取消
        if (newContent.trim() === currentContent) return;   // 未修改
        if (!newContent.trim()) {
          uiApi.utils.showToast('内容不能为空', 'warning');
          return;
        }

        // ---- 3. 区分单聊 / 群聊 ----
        const isGroup = messageEl.classList.contains('group-message');

        if (!isGroup) {
          // 单聊：更新 conversation 并刷新
          const conversation = await api.conversation.getCurrentConversation();
          if (!conversation) {
            uiApi.utils.showToast('未找到当前会话', 'error');
            return;
          }
          const msgIndex = conversation.messages.findIndex(m => m.id === messageId);
          if (msgIndex === -1) {
            uiApi.utils.showToast('消息不存在（可能已被删除）', 'error');
            return;
          }
          conversation.messages[msgIndex].content = newContent.trim();
          conversation.updatedAt = Date.now();
          const stores = await api.db.getStores();
          await stores.conversations.update(conversation.id, conversation);
          try {
            await api.chat.renderConversation(conversation.id);
          } catch (err) {
            log.warn('刷新会话失败，回退到局部更新:', err);
            await refreshBubbleContent(bubbleEl, newContent.trim());
          }
        } else {
          // 群聊：更新 group_messages 存储（核心未暴露群聊渲染 API，故局部刷新）
          const stores = await api.db.getStores();
          const groupMsg = await stores.group_messages.get(messageId);
          if (!groupMsg) {
            uiApi.utils.showToast('消息不存在（可能已被删除）', 'error');
            return;
          }
          groupMsg.content = newContent.trim();
          groupMsg.updatedAt = Date.now();
          await stores.group_messages.update(messageId, groupMsg);
          await refreshBubbleContent(bubbleEl, newContent.trim());
        }

        uiApi.utils.showToast('已保存', 'success');
        log.info('消息已更新:', messageId);
      } catch (err) {
        log.error('编辑失败:', err);
        uiApi.utils.showToast('编辑失败: ' + err.message, 'error');
      }
    }

    // ============================================================
    // 局部刷新气泡内容（单聊 / 群聊通用）
    //   只替换内容容器，保留时间戳与发送者名等兄弟节点。
    // ============================================================
    async function refreshBubbleContent(bubbleEl, newContent) {
      const contentEl = bubbleEl.querySelector('.bubble-content')
        || bubbleEl.querySelector('.content');
      if (!contentEl) {
        // 兜底：清空气泡但保留时间戳，再以纯文本填充
        const timeEl = bubbleEl.querySelector('.timestamp');
        bubbleEl.innerHTML = '';
        if (timeEl) bubbleEl.appendChild(timeEl);
        bubbleEl.appendChild(document.createTextNode(newContent));
        return;
      }
      try {
        const rendered = await uiApi.utils.renderMarkdown(newContent);
        if (typeof rendered === 'string') {
          contentEl.innerHTML = rendered;
          return;
        }
      } catch (err) {
        log.warn('Markdown 渲染失败，使用纯文本:', err);
      }
      contentEl.textContent = newContent;
    }

    // ============================================================
    // teardown
    // ============================================================
    return async function teardown() {
      if (removeCtxMenu) removeCtxMenu();
      log.info('UI 已卸载');
    };
  },
};