import { describe, it, expect, beforeEach } from 'vitest';
import { appendConsoleMessage } from '../../js/ui/components/console.js';

function messages() {
  return Array.from(document.querySelectorAll('#chatMessages .message.console'));
}

describe('ui/components/console · 控制台消息', () => {
  beforeEach(() => {
    document.getElementById('chatMessages').innerHTML = '';
  });

  describe('渲染', () => {
    it('追加到 #chatMessages 下', () => {
      appendConsoleMessage('命令执行完成');
      expect(messages()).toHaveLength(1);
    });

    it('带 console 语义的 class 与 data 标记', () => {
      appendConsoleMessage('内容');
      const el = messages()[0];
      expect(el.classList.contains('console')).toBe(true);
      expect(el.dataset.console).toBe('true');
    });

    it('文本渲染进 .console-content', () => {
      appendConsoleMessage('输出结果');
      expect(document.querySelector('.console-content').textContent).toContain('输出结果');
    });

    it('包含控制台标题', () => {
      appendConsoleMessage('内容');
      expect(document.querySelector('.console-header').textContent).toBe('Utopia 控制台');
    });

    it('多次调用依次追加，不覆盖', () => {
      appendConsoleMessage('第一条');
      appendConsoleMessage('第二条');
      appendConsoleMessage('第三条');
      expect(messages()).toHaveLength(3);
    });

    it('换行符拆分为多个 .console-line', () => {
      appendConsoleMessage('第一行\n第二行\n第三行');
      const lines = Array.from(document.querySelectorAll('#chatMessages .console-line'));
      expect(lines.map(el => el.textContent)).toEqual(['第一行', '第二行', '第三行']);
    });
  });

  describe('type 样式', () => {
    it.each(['info', 'success', 'error', 'warning'])('类型 %s 生成对应 class', (type) => {
      appendConsoleMessage('内容', type);
      expect(messages()[0].classList.contains(`console-${type}`)).toBe(true);
    });

    it('未识别的类型仍能渲染且使用默认图标', () => {
      appendConsoleMessage('内容', 'mystery');
      expect(messages()).toHaveLength(1);
      expect(document.querySelector('.console-icon').textContent).toBe('🖥️');
    });
  });

  describe('XSS 防护', () => {
    it('HTML 标签被转义为纯文本', () => {
      appendConsoleMessage('<b>加粗</b>');
      const line = document.querySelector('.console-line');
      expect(line.textContent).toBe('<b>加粗</b>');
      expect(line.querySelector('b')).toBeNull();
    });

    it('img onerror 载荷不会生成真实节点', () => {
      appendConsoleMessage('<img src=x onerror="alert(1)">');
      expect(document.querySelector('#chatMessages img')).toBeNull();
    });

    it('script 标签不会被插入', () => {
      appendConsoleMessage('<script>window.__pwned = true;</script>');
      expect(document.querySelector('#chatMessages script')).toBeNull();
      expect(window.__pwned).toBeUndefined();
    });

    it('多行中的每一行都独立转义', () => {
      appendConsoleMessage('<img src=x>\n<svg onload=alert(1)>');
      expect(document.querySelectorAll('#chatMessages img')).toHaveLength(0);
      expect(document.querySelectorAll('#chatMessages svg')).toHaveLength(0);
    });

    it('null / undefined 渲染为空内容而不是字面量', () => {
      appendConsoleMessage(null);
      expect(document.querySelector('.console-line').textContent).toBe('');
    });
  });

  describe('空状态处理', () => {
    it('渲染前移除已有的 .empty-msg 占位', () => {
      const container = document.getElementById('chatMessages');
      container.innerHTML = '<div class="empty-msg">暂无消息</div>';
      appendConsoleMessage('第一条命令输出');
      expect(container.querySelector('.empty-msg')).toBeNull();
      expect(messages()).toHaveLength(1);
    });

    it('容器不存在时静默返回，不抛错', () => {
      const container = document.getElementById('chatMessages');
      container.remove();
      expect(() => appendConsoleMessage('内容')).not.toThrow();
      // 还原骨架，避免影响同文件后续用例
      const restored = document.createElement('div');
      restored.id = 'chatMessages';
      document.body.appendChild(restored);
    });
  });
});
