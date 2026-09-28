import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  showBanner,
  hideBanner,
  showSuccessBanner,
  showErrorBanner,
  showWarningBanner,
} from '../../js/ui/components/banner.js';

function getBanners() {
  return Array.from(document.querySelectorAll('.banner-container'));
}

function getLines() {
  return Array.from(document.querySelectorAll('.banner-container .banner-line'));
}

describe('ui/components/banner · 旁白提示', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    hideBanner();
    vi.advanceTimersByTime(500);
    vi.useRealTimers();
  });

  describe('渲染', () => {
    it('挂载到 document.body 下', () => {
      showBanner('旁白文字');
      expect(getBanners()).toHaveLength(1);
      expect(document.body.contains(getBanners()[0])).toBe(true);
    });

    it('默认类型为 info', () => {
      showBanner('旁白');
      expect(getBanners()[0].className).toContain('banner-info');
    });

    it('把文本放进 .banner-line 节点', () => {
      showBanner('只有一行');
      expect(getLines()).toHaveLength(1);
      expect(getLines()[0].textContent).toBe('只有一行');
    });

    it('换行符拆分为多个 .banner-line', () => {
      showBanner('第一行\n第二行\n第三行');
      expect(getLines()).toHaveLength(3);
      expect(getLines().map(el => el.textContent)).toEqual(['第一行', '第二行', '第三行']);
    });

    it('空行渲染为占位内容以保持行高', () => {
      showBanner('上\n\n下');
      const lines = getLines();
      expect(lines).toHaveLength(3);
      expect(lines[1].textContent).toBe(' ');
    });

    it('连续调用只保留最新一条', () => {
      showBanner('旧');
      showBanner('新');
      expect(getBanners()).toHaveLength(1);
      expect(getLines()[0].textContent).toBe('新');
    });
  });

  describe('type 白名单校验', () => {
    it.each(['info', 'success', 'error', 'warning'])('保留合法类型 %s', (type) => {
      showBanner('内容', 3000, type);
      expect(getBanners()[0].className).toContain(`banner-${type}`);
    });

    it.each(['danger', 'INFO', '', null, undefined, 'info" onload="x'])(
      '非法类型 %s 回退到 info',
      (type) => {
        showBanner('内容', 3000, type);
        expect(getBanners()[0].className).toContain('banner-info');
      },
    );

    it('恶意 type 不会注入额外属性', () => {
      showBanner('内容', 3000, 'x" onclick="alert(1)');
      const banner = getBanners()[0];
      expect(banner.getAttribute('onclick')).toBeNull();
    });
  });

  describe('XSS 防护', () => {
    it('标签被转义为纯文本', () => {
      showBanner('<b>加粗</b>');
      const line = getLines()[0];
      expect(line.textContent).toBe('<b>加粗</b>');
      expect(line.querySelector('b')).toBeNull();
    });

    it('img onerror 载荷不会产生真实节点', () => {
      showBanner('<img src=x onerror="alert(1)">');
      expect(document.querySelector('.banner-container img')).toBeNull();
      expect(getLines()[0].textContent).toBe('<img src=x onerror="alert(1)">');
    });

    it('多行中的每一行都独立转义', () => {
      showBanner('<script>a</script>\n<img src=x>');
      expect(document.querySelectorAll('.banner-container script')).toHaveLength(0);
      expect(document.querySelectorAll('.banner-container img')).toHaveLength(0);
    });

    it('null / undefined 渲染为空行而不是字面量', () => {
      showBanner(null);
      expect(getLines()[0].textContent).toBe(' ');
    });
  });

  describe('自动消失与手动关闭', () => {
    it('到达 duration 后自动移除', () => {
      showBanner('短暂', 2000);
      expect(getBanners()).toHaveLength(1);
      vi.advanceTimersByTime(2000); // 触发 hideBanner
      vi.advanceTimersByTime(300);  // 等待退场动画
      expect(getBanners()).toHaveLength(0);
    });

    it('duration 之前保持可见', () => {
      showBanner('保持', 5000);
      vi.advanceTimersByTime(4000);
      expect(getBanners()).toHaveLength(1);
    });

    it('hideBanner 立即取消可见状态，动画结束后移除节点', () => {
      showBanner('手动关', 99999);
      const banner = getBanners()[0];
      banner.classList.add('banner-visible');

      hideBanner();
      expect(banner.classList.contains('banner-visible')).toBe(false);
      vi.advanceTimersByTime(300);
      expect(getBanners()).toHaveLength(0);
    });

    it('重复调用 hideBanner 不抛错', () => {
      showBanner('内容');
      hideBanner();
      expect(() => hideBanner()).not.toThrow();
    });

    it('点击提示框将其关闭', () => {
      showBanner('点我', 99999);
      getBanners()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(300);
      expect(getBanners()).toHaveLength(0);
    });
  });

  describe('快捷方法', () => {
    it('showSuccessBanner 使用 success 类型', () => {
      showSuccessBanner('成功');
      expect(getBanners()[0].className).toContain('banner-success');
    });

    it('showErrorBanner 使用 error 类型', () => {
      showErrorBanner('失败');
      expect(getBanners()[0].className).toContain('banner-error');
    });

    it('showWarningBanner 使用 warning 类型', () => {
      showWarningBanner('注意');
      expect(getBanners()[0].className).toContain('banner-warning');
    });
  });
});
