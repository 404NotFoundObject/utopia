import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(resolve(root, 'js/ui/screens/settingsUI.js'), 'utf-8');

/**
 * 设置编排层的接线守护。
 *
 * 新增 section 必须在三处同步：import、render 列表、bind 列表。
 * 漏掉 bind 的结果是「界面有按钮但点了没反应」——与本项目反复出现的
 * 「跨文件改动只改了一边」是同一类错误，用静态断言钉死。
 */
describe('设置编排层接线', () => {
  const pairs = [...source.matchAll(
    /import\s*\{\s*(render\w+)\s*,\s*(bind\w+)\s*\}\s*from\s*'\.\/settingsUI\/sections\/[\w.]+\.js'/g
  )].map((m) => ({ render: m[1], bind: m[2] }));

  test('至少识别出十余个 section', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(15);
  });

  test('每个 import 的 render / bind 都在编排层实际被调用', () => {
    for (const { render, bind } of pairs) {
      expect(source, `${render} 未插入 HTML`).toMatch(new RegExp(`\\$\\{${render}\\(`));
      expect(source, `${bind} 未在 bindSettingsSave 中调用`).toMatch(new RegExp(`${bind}\\(modalContent`));
    }
  });

  test('关于 section 已接线（版本展示 + 检查更新）', () => {
    expect(pairs).toContainEqual({ render: 'renderAboutSection', bind: 'bindAboutSection' });
  });
});
