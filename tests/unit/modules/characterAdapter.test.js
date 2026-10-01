import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  convertToUtopia,
  convertFromUtopia,
} from '../../../js/modules/characterAdapter.js';

describe('characterAdapter · 格式检测', () => {
  it('识别 ST v2 信封 { spec: chara_card_v2, data }', () => {
    const fmt = detectFormat({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: '小兰', description: '描述', personality: '温柔' },
    });
    expect(fmt).toBe('st-v2');
  });

  it('识别裸 ST v2 卡（无信封）', () => {
    const fmt = detectFormat({ name: '小兰', description: '描述', personality: '温柔' });
    expect(fmt).toBe('st-v2');
  });

  it('识别 ST v3 信封', () => {
    const fmt = detectFormat({ spec: 'chara_card_v3', data: { name: '小兰' } });
    expect(fmt).toBe('st-v3');
  });
});

describe('characterAdapter · ST v2 信封转换', () => {
  it('信封 ST v2 卡转换后保留世界书与备用开场白', () => {
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '小兰',
        description: '描述',
        personality: '温柔',
        first_mes: '你好',
        character_book: { entries: [{ keys: ['武器'], content: '长剑' }] },
        alternate_greetings: ['另一种开场白'],
      },
    };
    const out = convertToUtopia(card, 'st-v2');
    expect(out.name).toBe('小兰');
    expect(out.characterBook).toEqual({ entries: [{ keys: ['武器'], content: '长剑' }] });
    expect(out.alternateGreetings).toEqual(['另一种开场白']);
  });

  it('personality 为对象时转为 JSON 字符串而非 [object Object]', () => {
    const card = {
      name: '小兰',
      description: '描述',
      personality: { 温柔: 80, 独立: 60 },
    };
    const out = convertToUtopia(card, 'st-v2');
    expect(out.personality).toContain('温柔');
    expect(out.personality).not.toContain('[object Object]');
  });
});

describe('characterAdapter · 往返保真（P1-7）', () => {
  it('ST v3 导入 → 导出 → 再导入不丢 character_book 与 alternate_greetings', () => {
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: '小兰',
        description: '描述',
        personality: '温柔',
        first_mes: '你好',
        character_book: { entries: [{ keys: ['武器'], content: '长剑' }] },
        alternate_greetings: ['开场白A'],
      },
    };
    const utopia = convertToUtopia(card, 'st-v3');
    const exported = convertFromUtopia(utopia, 'st-v3');
    expect(exported.data.character_book).toEqual({ entries: [{ keys: ['武器'], content: '长剑' }] });
    expect(exported.data.alternate_greetings).toEqual(['开场白A']);
  });
});
