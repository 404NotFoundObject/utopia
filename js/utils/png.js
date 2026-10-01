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
  const data = new Uint8Array(arrayBuffer);
  
  let pos = 8;
  while (pos < data.length) {
    const length = new DataView(data.buffer, pos).getUint32(0);
    const type = String.fromCharCode(
      data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]
    );
    if (type === 'tEXt') {
      const textData = data.slice(pos + 8, pos + 8 + length);
      const text = new TextDecoder().decode(textData);
      // 兼容三种关键字约定：
      //   'chara\0' + base64(JSON)  —— SillyTavern 规范（本库写入即此格式）
      //   'chara '  + 原始 JSON      —— 历史版本
      //   'chara\0' + 原始 JSON      —— 其他工具的变体
      if (text.startsWith('chara\0')) {
        const payload = text.substring(6);
        return decodeCharaPayload(payload);
      }
      if (text.startsWith('chara ')) {
        const payload = text.substring(6);
        return decodeCharaPayload(payload);
      }
    }
    pos += 12 + length;
  }
  return null;
}

/**
 * 解析 chara 关键字后的载荷：优先按 base64 解码，失败则按原始 UTF-8 JSON 解析。
 * @param {string} payload
 * @returns {Object|null}
 */
function decodeCharaPayload(payload) {
  // base64（SillyTavern 规范）
  try {
    const bytes = base64ToBytes(payload);
    const jsonStr = new TextDecoder().decode(bytes);
    return JSON.parse(jsonStr);
  } catch (_) {
    // 历史/其他工具的原始 JSON
    try {
      return JSON.parse(payload);
    } catch (_) {
      return null;
    }
  }
}

// ---------- base64 编解码（跨环境安全：Node 无 btoa/atob） ----------
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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