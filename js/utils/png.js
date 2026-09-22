// js/utils/png.js - PNG 文件操作工具（修复 tEXt 块嵌入）

/**
 * 将 JSON 字符串嵌入到 PNG 的 tEXt 块中
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
  
  // 构建 tEXt 块数据
  const textData = `chara ${jsonString}`;
  const textBytes = new TextEncoder().encode(textData);
  const dataLength = textBytes.length;

  // ★★★ 修复：正确构建 tEXt 块：长度(4) + 'tEXt'(4) + 数据(N) + CRC(4) ★★★
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
      if (text.startsWith('chara ')) {
        try {
          return JSON.parse(text.substring(6));
        } catch {
          return null;
        }
      }
    }
    pos += 12 + length;
  }
  return null;
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