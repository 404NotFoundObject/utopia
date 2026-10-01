import { describe, it, expect } from 'vitest';
import { embedJSONToPNG, extractJSONFromPNG } from '../../../js/utils/png.js';
import { tinyPngBlob, parsePngChunks, makeSTCharaPng } from '../../helpers/fixtures.js';

async function toBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('utils/png · tEXt 块读写', () => {
  describe('embedJSONToPNG', () => {
    it('在 IHDR 之后插入 tEXt 块', async () => {
      const out = await embedJSONToPNG(tinyPngBlob(), JSON.stringify({ name: 'x' }));
      const chunks = parsePngChunks(await toBytes(out));
      expect(chunks.map(c => c.type)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);
    });

    it('保留原始的 PNG 签名', async () => {
      const out = await embedJSONToPNG(tinyPngBlob(), '{}');
      const bytes = await toBytes(out);
      expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    });

    it('tEXt 块的 length 字段与实际数据长度一致', async () => {
      const json = JSON.stringify({ a: 1 });
      const out = await embedJSONToPNG(tinyPngBlob(), json);
      const bytes = await toBytes(out);
      const textChunk = parsePngChunks(bytes).find(c => c.type === 'tEXt');
      // 数据为 'chara\0' + base64(json)
      const base64 = btoa(new TextEncoder().encode(json).reduce((s, b) => s + String.fromCharCode(b), ''));
      expect(textChunk.length).toBe(new TextEncoder().encode('chara\0' + base64).length);
    });

    it('tEXt 载荷符合 SillyTavern 规范（chara\\0 + base64）', async () => {
      const json = JSON.stringify({ name: '柳如烟' });
      const out = await embedJSONToPNG(tinyPngBlob(), json);
      const bytes = await toBytes(out);
      const textChunk = parsePngChunks(bytes).find(c => c.type === 'tEXt');
      const dataBytes = bytes.subarray(textChunk.offset + 8, textChunk.offset + 8 + textChunk.length);
      const text = new TextDecoder().decode(dataBytes);
      expect(text.startsWith('chara\0')).toBe(true);
      expect(text.startsWith('chara ')).toBe(false);
    });

    it('非 PNG 输入抛出明确错误', async () => {
      const notPng = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'application/octet-stream' });
      await expect(embedJSONToPNG(notPng, '{}')).rejects.toThrow('无效的 PNG 文件');
    });

    it('缺少 IHDR 的伪 PNG 抛出错误', async () => {
      // 仅签名 + 一个 IEND，没有 IHDR
      const bytes = new Uint8Array(20);
      bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
      bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0, 0, 0, 0], 8);
      await expect(embedJSONToPNG(new Blob([bytes]), '{}')).rejects.toThrow('未找到 IHDR 块');
    });

    it('重复嵌入时替换旧 tEXt 而不是叠加', async () => {
      const first = await embedJSONToPNG(tinyPngBlob(), JSON.stringify({ v: 1 }));
      const second = await embedJSONToPNG(first, JSON.stringify({ v: 2 }));
      const chunks = parsePngChunks(await toBytes(second));
      expect(chunks.filter(c => c.type === 'tEXt')).toHaveLength(1);
    });

    it('输出为 image/png 类型的 Blob', async () => {
      const out = await embedJSONToPNG(tinyPngBlob(), '{}');
      expect(out).toBeInstanceOf(Blob);
      expect(out.type).toBe('image/png');
    });
  });

  describe('extractJSONFromPNG', () => {
    it('往返读写保持一致', async () => {
      const payload = { name: '柳如烟', tags: ['测试', '日常'], nested: { n: 1 } };
      const embedded = await embedJSONToPNG(tinyPngBlob(), JSON.stringify(payload));
      expect(await extractJSONFromPNG(embedded)).toEqual(payload);
    });

    it('支持中文与多行字符串', async () => {
      const payload = { text: '第一行\n第二行\n带 emoji 🎭' };
      const embedded = await embedJSONToPNG(tinyPngBlob(), JSON.stringify(payload));
      expect(await extractJSONFromPNG(embedded)).toEqual(payload);
    });

    it('不含 tEXt 块的 PNG 返回 null', async () => {
      expect(await extractJSONFromPNG(tinyPngBlob())).toBeNull();
    });

    it('tEXt 内容不是合法 JSON 时返回 null 而不是抛错', async () => {
      const embedded = await embedJSONToPNG(tinyPngBlob(), '{ 这不是 JSON');
      expect(await extractJSONFromPNG(embedded)).toBeNull();
    });

    it('嵌套两次嵌入后仍能读到最新值', async () => {
      const first = await embedJSONToPNG(tinyPngBlob(), JSON.stringify({ v: 'first' }));
      const second = await embedJSONToPNG(first, JSON.stringify({ v: 'second' }));
      expect(await extractJSONFromPNG(second)).toEqual({ v: 'second' });
    });

    it('读取真实 SillyTavern 卡（chara\\0 + base64，独立构造）', async () => {
      const payload = { name: '真实 ST 卡', description: '来自 SillyTavern 导出' };
      const stPng = makeSTCharaPng(JSON.stringify(payload));
      expect(await extractJSONFromPNG(stPng)).toEqual(payload);
    });

    it('兼容历史格式 chara + 空格 + 原始 JSON', async () => {
      // 手工构造历史格式的 tEXt 数据，走独立解码路径验证向后兼容
      const legacy = await embedLegacyCharaPng({ legacy: true });
      expect(await extractJSONFromPNG(legacy)).toEqual({ legacy: true });
    });
  });
});

/**
 * 手工构造「历史格式」chara + 空格 + 原始 JSON 的 PNG（不经 embedJSONToPNG），
 * 用于验证提取器对旧文件的向后兼容。
 */
async function embedLegacyCharaPng(obj) {
  const base = tinyPngBlob();
  const baseBytes = new Uint8Array(await base.arrayBuffer());
  const textData = new TextEncoder().encode('chara ' + JSON.stringify(obj));

  const insertPos = 8 + 25; // IHDR 之后
  const chunkLen = 4 + 4 + textData.length + 4;
  const out = new Uint8Array(baseBytes.length + chunkLen);
  out.set(baseBytes.subarray(0, insertPos), 0);
  const view = new DataView(out.buffer);
  view.setUint32(insertPos, textData.length);
  out[insertPos + 4] = 't'.charCodeAt(0);
  out[insertPos + 5] = 'E'.charCodeAt(0);
  out[insertPos + 6] = 'X'.charCodeAt(0);
  out[insertPos + 7] = 't'.charCodeAt(0);
  out.set(textData, insertPos + 8);
  out.set(baseBytes.subarray(insertPos), insertPos + 8 + textData.length + 4);
  return new Blob([out], { type: 'image/png' });
}
