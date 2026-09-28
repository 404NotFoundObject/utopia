import { describe, it, expect } from 'vitest';
import { embedJSONToPNG, extractJSONFromPNG } from '../../../js/utils/png.js';
import { tinyPngBlob, parsePngChunks } from '../../helpers/fixtures.js';

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
      // 数据为 'chara ' + json
      expect(textChunk.length).toBe(new TextEncoder().encode('chara ' + json).length);
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
  });
});
