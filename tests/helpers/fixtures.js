/**
 * 测试夹具：最小可用 PNG 与角色卡数据。
 */

/**
 * 1x1 像素的合法 PNG（含签名 + IHDR + IDAT + IEND，共 4 个块）。
 * 用于 js/utils/png.js 的 tEXt 块往返测试。
 */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * 解码出上述 PNG 的 ArrayBuffer。
 * @returns {ArrayBuffer}
 */
export function tinyPngArrayBuffer() {
  const binary = atob(TINY_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 构造一个 PNG Blob。
 * 注意：必须传入「拷回来的独立 buffer」，直接复用 tinyPngArrayBuffer() 的返回值
 * 会让多次调用共享同一块内存，png.js 的就地写入会串味。
 * @returns {Blob}
 */
export function tinyPngBlob() {
  return new Blob([tinyPngArrayBuffer()], { type: 'image/png' });
}

/**
 * 构造一个「SillyTavern 规范」的 chara tEXt 块数据（不经过 embedJSONToPNG），
 * 用于交叉验证提取器能读真实 ST 卡：'chara\0' + base64(UTF-8 JSON)。
 * @param {string} jsonString
 * @returns {Uint8Array} tEXt 块的数据部分（不含 length/type/CRC 头）
 */
export function makeCharaTextData(jsonString) {
  const jsonBytes = new TextEncoder().encode(jsonString);
  // 手动 base64（浏览器/Node 均可用 btoa）
  let binary = '';
  for (let i = 0; i < jsonBytes.length; i++) {
    binary += String.fromCharCode(jsonBytes[i]);
  }
  const base64 = btoa(binary);
  return new TextEncoder().encode('chara\0' + base64);
}

/**
 * 构造一个包含 ST 规范 chara tEXt 块的完整 PNG Blob（独立于 embedJSONToPNG）。
 * 在 IHDR 之后插入 tEXt，供提取器交叉验证。
 * @param {string} jsonString
 * @returns {Blob}
 */
export function makeSTCharaPng(jsonString) {
  const base = tinyPngArrayBuffer();
  const baseBytes = new Uint8Array(base);
  const textData = makeCharaTextData(jsonString);

  // 定位 IHDR 块结束位置（IHDR 固定 13 字节数据）
  // 块结构：len(4) + type(4) + data(13) + crc(4) = 25 字节，从偏移 8 开始
  const insertPos = 8 + 25;

  const chunkLen = 4 + 4 + textData.length + 4;
  const out = new Uint8Array(baseBytes.length + chunkLen);
  out.set(baseBytes.subarray(0, insertPos), 0);

  const view = new DataView(out.buffer);
  view.setUint32(insertPos, textData.length); // length（大端）
  out[insertPos + 4] = 't'.charCodeAt(0);
  out[insertPos + 5] = 'E'.charCodeAt(0);
  out[insertPos + 6] = 'X'.charCodeAt(0);
  out[insertPos + 7] = 't'.charCodeAt(0);
  out.set(textData, insertPos + 8);
  // CRC 留空（提取器不校验 CRC）
  out.set(baseBytes.subarray(insertPos), insertPos + 8 + textData.length + 4);

  return new Blob([out], { type: 'image/png' });
}

/**
 * 解析 PNG 的块结构（仅读头部，不校验 CRC）。
 * @param {Uint8Array} bytes
 * @returns {Array<{type: string, length: number, offset: number}>}
 */
export function parsePngChunks(bytes) {
  const chunks = [];
  let pos = 8; // 跳过 8 字节签名
  while (pos + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + pos);
    const length = view.getUint32(0);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    chunks.push({ type, length, offset: pos });
    if (type === 'IEND') break;
    pos += 12 + length;
  }
  return chunks;
}

/**
 * 一份完整的 SillyTavern V2 角色卡，用于 characterAdapter 映射测试。
 * 字段命名刻意使用 ST 的 snake_case。
 * @returns {Object}
 */
export function makeSTV2Card() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '柳如烟',
      description: '性格迷糊的少女。',
      personality: '温柔、健忘、爱笑',
      scenario: '在咖啡馆打工。',
      first_mes: '欢迎光临～',
      mes_example: '<START>\n{{user}}: 你好\n{{char}}: 你好呀～',
      creator_notes: '测试用角色卡',
      system_prompt: '你是一个角色扮演助手。',
      post_history_instructions: '保持人设一致。',
      tags: ['测试', '日常'],
      creator: 'test-suite',
      character_version: '1.0',
      extensions: {},
    },
  };
}

/**
 * 一份 Utopia 自有格式的角色卡。
 * @returns {Object}
 */
export function makeUtopiaCard() {
  return {
    schema: 'utopia-character/v3.1',
    id: 'char-test-0001',
    name: '凌川',
    description: '毒舌但心软的少年。',
    personality: {
      openness: 70,
      conscientiousness: 40,
      extraversion: 30,
      agreeableness: 20,
      neuroticism: 60,
      expressiveness: 80,
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}
