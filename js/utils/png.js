// js/utils/png.js - PNG 文件操作工具（支持 tEXt 块嵌入）

/**
 * 将 JSON 字符串嵌入到 PNG 的 tEXt 块中
 *
 * 兼容 SillyTavern 规范：关键字 `chara\0`，载荷为 base64 编码的 JSON。
 *
 * @param {Blob} pngBlob - 原始 PNG 图片 Blob
 * @param {string} jsonString - 要嵌入的 JSON 字符串
 * @returns {Promise<Blob>} 新的 PNG Blob
 */
export async function embedJSONToPNG(pngBlob, jsonString) {
  const arrayBuffer = await pngBlob.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  
  // PNG 签名
  const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) {
      throw new Error('无效的 PNG 文件');
    }
  }
  
  // 构建 tEXt 块数据：SillyTavern 规范 = 'chara\0' + base64(JSON)
  const jsonBytes = new TextEncoder().encode(jsonString);
  const base64 = bytesToBase64(jsonBytes);
  const textData = 'chara\0' + base64;
  const textBytes = new TextEncoder().encode(textData);
  const dataLength = textBytes.length;

  // ★★★ tEXt 块结构：长度(4) + 'tEXt'(4) + 数据(N) + CRC(4) ★★★
  const tEXtChunk = new Uint8Array(4 + 4 + dataLength + 4);
  // 写入长度（大端）
  new DataView(tEXtChunk.buffer).setUint32(0, dataLength);
  // 写入类型 'tEXt'
  tEXtChunk[4] = 't'.charCodeAt(0);
  tEXtChunk[5] = 'E'.charCodeAt(0);
  tEXtChunk[6] = 'X'.charCodeAt(0);
  tEXtChunk[7] = 't'.charCodeAt(0);
  // 写入数据
  tEXtChunk.set(textBytes, 8);
  
  // 计算 CRC（包括类型和数据）
  const crcData = new Uint8Array(4 + dataLength);
  crcData.set(tEXtChunk.slice(4, 8), 0); // 类型
  crcData.set(textBytes, 4);             // 数据
  const crc = crc32(crcData);
  new DataView(tEXtChunk.buffer).setUint32(4 + 4 + dataLength, crc);
  
  // 解析原始 PNG 块
  let pos = 8; // 跳过签名
  let chunks = [];
  while (pos < data.length) {
    const length = new DataView(data.buffer, pos).getUint32(0);
    const type = String.fromCharCode(
      data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]
    );
    const chunkEnd = pos + 12 + length;
    chunks.push({
      start: pos,
      end: chunkEnd,
      type: type,
      data: data.slice(pos, chunkEnd)
    });
    if (type === 'IEND') break;
    pos = chunkEnd;
  }
  
  // 构建新 PNG
  const newDataLength = 8 + 4 + 4 + tEXtChunk.length + chunks.reduce((sum, c) => sum + c.data.length, 0);
  const newData = new Uint8Array(newDataLength);
  let offset = 0;
  // 签名
  newData.set(PNG_SIGNATURE, offset);
  offset += 8;
  
  // 复制 IHDR
  const ihdrChunk = chunks.find(c => c.type === 'IHDR');
  if (!ihdrChunk) throw new Error('未找到 IHDR 块');
  newData.set(ihdrChunk.data, offset);
  offset += ihdrChunk.data.length;
  
  // 插入 tEXt
  newData.set(tEXtChunk, offset);
  offset += tEXtChunk.length;
  
  // 复制其余块（跳过 IHDR 和已有的 tEXt 块）
  for (const chunk of chunks) {
    if (chunk.type === 'IHDR' || chunk.type === 'tEXt') continue;
    newData.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  
  return new Blob([newData], { type: 'image/png' });
}

/**
 * 从 PNG 中提取 tEXt 块中的 JSON 数据
 * @param {Blob} pngBlob - PNG 图片 Blob
 * @returns {Promise<Object|null>} 解析后的 JSON 对象，或 null
 */
export async function extractJSONFromPNG(pngBlob) {
  const arrayBuffer = await pngBlob.arrayBuffer();
  const text = extractTextChunk(arrayBuffer);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/**
 * 从 PNG 的 tEXt 块提取 JSON 字符串。
 *
 * ★ 全项目唯一实现（审计 A-1 / S-3）：此前 js/utils/png.js 与
 * js/modules/characterAdapter.js 各维护一份 tEXt 扫描与载荷解码，且已经漂移——
 * 前者只认 `chara\0` / `chara ` 两种前缀，后者还认 `chara` 直连载荷与裸 JSON。
 * 应用实际导入走的是 characterAdapter 那份，于是「改了一边、另一边没跟上」
 * 的漂移只会体现在测试里，问题被掩盖。现在两份合并成这一份，两边都调用它。
 *
 * @param {ArrayBuffer} buffer
 * @returns {string|null} JSON 字符串，或 null
 */
export function extractTextChunk(buffer) {
  const view = new DataView(buffer);
  let offset = 8;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    if (type === 'tEXt') {
      const data = new Uint8Array(buffer, offset + 8, length);
      const text = new TextDecoder('utf-8').decode(data);

      // 1. ST 官方：`chara\0{base64}`（null 分隔，载荷是 base64 编码的 JSON）
      if (text.startsWith('chara\0')) {
        return decodeCharaText(text.substring(6));
      }
      // 2. Utopia 历史自产：`chara {json}`（空格分隔，载荷是原始 JSON）
      if (text.startsWith('chara ')) {
        return decodeCharaText(text.substring(6));
      }
      // 3. 兼容：`chara` 后直接跟分隔符（\0 或空格）或 JSON
      if (text.startsWith('chara')) {
        return decodeCharaText(text.substring(5).replace(/^[\0 ]/, ''));
      }
      // 4. 裸 JSON（兜底）
      if (text.startsWith('{')) {
        return text;
      }
    }
    offset += 12 + length;
  }
  return null;
}

/**
 * 解析 chara 关键字后的载荷为 JSON 字符串。
 *
 * 写入端（embedJSONToPNG）写的是 `chara\0` + base64(JSON)；若这里不解码，
 * 上层 JSON.parse(base64) 会抛错，表现为「无法导入自己导出的 PNG 卡」。
 * 先尝试 base64 解码（返回解码后的 JSON 字符串），失败则视为原始 JSON 原文。
 *
 * @param {string} payload - chara 关键字之后的载荷
 * @returns {string} JSON 字符串（已解码）
 */
export function decodeCharaText(payload) {
  // base64 解码：若解码结果是合法的 JSON（以 { 开头），说明是 ST 规范编码，返回解码结果
  try {
    const decoded = base64ToUtf8(payload.trim());
    if (decoded.trim().startsWith('{')) {
      return decoded;
    }
  } catch (_) {
    // 不是 base64，落到原始 JSON 分支
  }
  // 原始 JSON（历史版本 / 其他工具直写明文）
  return payload;
}

// ---------- base64 编解码 ----------
// btoa / atob 在浏览器与 Node 16+ 均已全局可用，无需 polyfill。
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * 把 base64 字符串解码为 UTF-8 字符串。
 * atob 返回的是 binary string（每个字符对应一个字节），中文等多字节 UTF-8 字符
 * 必须再经 TextDecoder 才能正确还原，否则会出现乱码。
 */
function base64ToUtf8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// ---------- CRC-32 实现 ----------
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}