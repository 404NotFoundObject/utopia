import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  convertToUtopia,
  convertFromUtopia,
  extractTextChunk,
} from '../../../js/modules/characterAdapter.js';
import { makeSTCharaPng } from '../../helpers/fixtures.js';

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

describe('characterAdapter · PNG 端到端解码（A-1）', () => {
  it('extractTextChunk 对 chara\\0 + base64 载荷返回解码后的 JSON 字符串', async () => {
    const card = { spec: 'chara_card_v2', data: { name: '凌川', description: '测试' } };
    const pngBlob = makeSTCharaPng(JSON.stringify(card));
    const buf = await pngBlob.arrayBuffer();
    const text = extractTextChunk(buf);
    // 必须是解码后的 JSON（可 JSON.parse），而不是 base64 字符串
    expect(text.startsWith('{')).toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed.spec).toBe('chara_card_v2');
    expect(parsed.data.name).toBe('凌川');
  });

  it('chara 空格 + 原始 JSON 载荷不 base64 解码，直接返回原文', async () => {
    const json = JSON.stringify({ name: '小兰', description: '历史明文' });
    const textData = new TextEncoder().encode('chara ' + json);
    // 手工拼一个最小 tEXt 块所在的 ArrayBuffer 太繁琐，这里直接测 decode 语义：
    // 构造一个带 chara 空格 tEXt 的 PNG 用 makeSTCharaPng 变体不可行，改用直接构造
    // —— 通过公开 extractTextChunk 走真实字节更可靠，下面用内联构造
    const buf = makePngWithText(new TextEncoder().encode('chara ' + json));
    const text = extractTextChunk(buf);
    expect(text).toBe(json);
    expect(JSON.parse(text).name).toBe('小兰');
  });

  it('裸 JSON（无 chara 前缀）直接返回原文', async () => {
    const json = JSON.stringify({ name: '裸JSON' });
    const buf = makePngWithText(new TextEncoder().encode(json));
    const text = extractTextChunk(buf);
    expect(text).toBe(json);
  });
});

describe('characterAdapter · 文本字段类型守卫（审计 C-5）', () => {
  it('原生 Utopia 格式的对象型 personality 不再变成 [object Object]', () => {
    // 回归：utopia-v3 分支此前 `return data` 零守卫，对象字段原样透传
    const out = convertToUtopia({
      schema: 'utopia-character/v3.1',
      name: '小兰',
      personality: { 外向: '高', 细心: '低' },
      description: ['第一条', '第二条'],
    }, 'utopia-v3.1');

    expect(out.personality).not.toBe('[object Object]');
    expect(out.personality).toBe('{"外向":"高","细心":"低"}');
    // 数组按行拼接
    expect(out.description).toBe('第一条\n第二条');
  });

  it('原生格式的结构化字段原样透传，不被文本化', () => {
    const params = { neuroticism: 30, extraversion: 80 };
    const out = convertToUtopia({
      schema: 'utopia-character/v3.1',
      name: '小兰',
      personalityParameters: params,
    }, 'utopia-v3.1');

    // 结构化字段必须原样保留（不能变成 JSON 字符串）
    expect(out.personalityParameters).toEqual(params);
    expect(out.personalityParameters).toBe(params);
  });

  it('通用格式的对象型字段也走守卫', () => {
    const out = convertToUtopia({
      name: '通用卡',
      personality: { a: 1 },
      systemPrompt: { b: 2 },
    }, 'generic');

    expect(out.personality).toBe('{"a":1}');
    expect(out.systemPrompt).toBe('{"b":2}');
  });

  it('未提供的字段不塞默认值（保持原样）', () => {
    const out = convertToUtopia({
      schema: 'utopia-character/v3.1',
      name: '小兰',
    }, 'utopia-v3.1');

    // 原本没有的字段不应被守卫凭空造出来
    expect('relationship' in out).toBe(false);
    expect(out.name).toBe('小兰');
  });
});

// 内联构造：在最小 PNG 的 IHDR 后插入指定 tEXt 数据，返回 ArrayBuffer
function makePngWithText(textBytes) {
  const base = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const bin = atob(base);
  const baseBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) baseBytes[i] = bin.charCodeAt(i);
  const insertPos = 8 + 25; // IHDR 结束
  const chunkLen = 4 + 4 + textBytes.length + 4;
  const out = new Uint8Array(baseBytes.length + chunkLen);
  out.set(baseBytes.subarray(0, insertPos), 0);
  const view = new DataView(out.buffer);
  view.setUint32(insertPos, textBytes.length);
  out[insertPos + 4] = 't'.charCodeAt(0);
  out[insertPos + 5] = 'E'.charCodeAt(0);
  out[insertPos + 6] = 'X'.charCodeAt(0);
  out[insertPos + 7] = 't'.charCodeAt(0);
  out.set(textBytes, insertPos + 8);
  out.set(baseBytes.subarray(insertPos), insertPos + 8 + textBytes.length + 4);
  return out.buffer;
}
