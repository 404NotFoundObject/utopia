// js/ui/screens/characterExportUI.js - 角色导出为 PNG 卡（布局修复）
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { embedJSONToPNG } from '../../utils/png.js';
import { escapeHtml } from '../../core/utils.js';

// 背景模板列表（图片路径）
const BACKGROUND_TEMPLATES = [
  { id: 'black_gold', name: '黑色鎏金', path: '/lib/characterBackground/black_gold.png' },
  { id: 'anime_1', name: '动漫风格 1', path: '/lib/characterBackground/anime_1.png' },
  { id: 'anime_2', name: '动漫风格 2', path: '/lib/characterBackground/anime_2.png' },
  { id: 'anime_3', name: '动漫风格 3', path: '/lib/characterBackground/anime_3.png' },
];

/**
 * 打开 PNG 导出界面
 * @param {Object} character - 角色对象
 */
export function openPNGExport(character) {
  // ★ XSS 修复：character.name / character.description 转义
  const safeName = escapeHtml(character.name);
  const safeDesc = escapeHtml(character.description || '');

  const html = `
    <button class="modal-close">&times;</button>
    <h2 class="modal-title"><i class="fas fa-image"></i> 导出为 PNG 卡</h2>
    <div class="png-export">
      <div class="form-group">
        <label>角色名</label>
        <input type="text" id="pngExportName" value="${safeName}" />
      </div>
      <div class="form-group">
        <label>简介</label>
        <textarea id="pngExportDesc" rows="2">${safeDesc}</textarea>
      </div>
      <div class="form-group">
        <label>背景模板</label>
        <div id="pngBgTemplates" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.5rem 0;">
          ${BACKGROUND_TEMPLATES.map((tpl, idx) => `
            <label style="display:flex;flex-direction:column;align-items:center;cursor:pointer;border:2px solid ${idx === 0 ? 'var(--color-primary)' : 'transparent'};border-radius:8px;padding:4px;transition:border-color 0.2s;">
              <img src="${tpl.path}" style="width:80px;height:120px;object-fit:cover;border-radius:4px;" />
              <span style="font-size:0.7rem;margin-top:2px;">${tpl.name}</span>
              <input type="radio" name="pngBgTemplate" value="${tpl.id}" ${idx === 0 ? 'checked' : ''} style="display:none;" />
            </label>
          `).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>导出格式</label>
        <select id="pngExportFormat">
          <option value="utopia-v3.1">Utopia v3.1</option>
          <option value="st-v3">SillyTavern v3</option>
          <option value="st-v2">SilkyTavern v2</option>
        </select>
      </div>
      <div style="display:flex;gap:1rem;justify-content:flex-end;margin-top:1rem;">
        <button class="btn btn-secondary" id="pngExportCancel">取消</button>
        <button class="btn btn-primary" id="pngExportGenerate">生成并导出</button>
      </div>
    </div>
  `;

  openModal(html);

  // 背景模板点击切换
  const templateLabels = document.querySelectorAll('#pngBgTemplates label');
  templateLabels.forEach((label, idx) => {
    label.addEventListener('click', () => {
      templateLabels.forEach(l => l.style.borderColor = 'transparent');
      label.style.borderColor = 'var(--color-primary)';
      label.querySelector('input[type="radio"]').checked = true;
    });
  });

  document.getElementById('pngExportCancel').addEventListener('click', closeModal);

  document.getElementById('pngExportGenerate').addEventListener('click', async () => {
    const name = document.getElementById('pngExportName').value.trim();
    const desc = document.getElementById('pngExportDesc').value.trim();
    const format = document.getElementById('pngExportFormat').value;
    const selectedBg = document.querySelector('input[name="pngBgTemplate"]:checked');
    const bgId = selectedBg ? selectedBg.value : BACKGROUND_TEMPLATES[0].id;
    const bgTemplate = BACKGROUND_TEMPLATES.find(t => t.id === bgId);

    if (!name) {
      showToast('请输入角色名', 'warning');
      return;
    }

    try {
      // 生成角色卡图片
      const pngBlob = await generateCharacterCard(character, {
        name,
        description: desc,
        bgPath: bgTemplate.path,
        format: format,
      });

      const { exportCharacter } = await import('../../modules/character.js');
      const jsonStr = await exportCharacter(character.id, format);

      // 嵌入 JSON 到 PNG
      const finalBlob = await embedJSONToPNG(pngBlob, jsonStr);

      // 下载
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}_card.png`;
      a.click();
      URL.revokeObjectURL(url);
      closeModal();
      showToast('导出成功', 'success');
    } catch (err) {
      console.error(err);
      showToast('导出失败: ' + err.message, 'error');
    }
  });
}

/**
 * 生成角色卡图片（Canvas 绘制）
 */
async function generateCharacterCard(character, options) {
  const { name, description, bgPath, format } = options;

  // 加载背景图片
  const bgImage = await loadImage(bgPath);

  // 加载角色头像
  let avatarImage = null;
  if (character.avatar) {
    avatarImage = await loadImage(character.avatar);
  }

  // Canvas 尺寸（2:3 比例，基础宽度 600px）
  const width = 600;
  const height = 900;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 绘制背景
  ctx.drawImage(bgImage, 0, 0, width, height);

  // 提取背景主色调
  const dominantColor = getDominantColor(ctx, bgImage, width, height);
  const textColor = isLight(dominantColor) ? '#1a1a2e' : '#f0f0f0';
  const subColor = isLight(dominantColor) ? '#4a4a6a' : '#b0b0d0';
  const bgAlpha = isLight(dominantColor) ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';

  const avatarSize = 150;
  const avatarX = (width - avatarSize) / 2;
  const avatarY = 80;

  // 绘制圆形头像
  ctx.save();
  ctx.beginPath();
  ctx.arc(width / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (avatarImage) {
    ctx.drawImage(avatarImage, avatarX, avatarY, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = '#e0e0e6';
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = '#8a8aaa';
    ctx.font = '60px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', width / 2, avatarY + avatarSize / 2);
  }
  ctx.restore();

  // 头像边框
  ctx.beginPath();
  ctx.arc(width / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.strokeStyle = textColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  // ---- 名称 ----
  const textStartY = avatarY + avatarSize + 30;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = textColor;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(name, width / 2, textStartY);

  // ---- 简介：自动换行，每行最多25字符，最多20行，带半透明背景框 ----
  const descLines = splitDescription(description, 25, 20);
  const lineHeight = 22;
  const descStartY = textStartY + 40;
  const descMaxWidth = width - 80;
  const totalHeight = descLines.length * lineHeight + 20;
  const descBoxX = 40;
  const descBoxY = descStartY - 10;
  const descBoxWidth = descMaxWidth;
  const descBoxHeight = totalHeight;

  // 绘制半透明背景框
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = bgAlpha;
  ctx.beginPath();
  ctx.roundRect(descBoxX, descBoxY, descBoxWidth, descBoxHeight, 8);
  ctx.fill();
  ctx.restore();

  // 绘制文本
  ctx.fillStyle = subColor;
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  descLines.forEach((line, idx) => {
    const y = descStartY + idx * lineHeight;
    ctx.fillText(line, width / 2, y);
  });

  // ---- 底部标识：更大更粗 ----
  const footerY = height - 40;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = subColor;
  ctx.font = 'bold 20px sans-serif';

  let label = '';
  if (format === 'utopia-v3.1') label = 'Utopia v3.1';
  else if (format === 'st-v3') label = 'SillyTavern v3';
  else if (format === 'st-v2') label = 'SillyTavern v2';
  else label = 'Utopia';
  ctx.fillText(label, width - 20, footerY);

  // 返回 Blob
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

// ---------- 辅助函数 ----------

/**
 * 按每行 maxChars 字符切割，最多 maxLines 行，超出截断加省略号
 */
function splitDescription(text, maxChars = 25, maxLines = 20) {
  if (!text) return ['暂无简介'];
  const paragraphs = text.split('\n');
  const result = [];
  for (let p of paragraphs) {
    if (p.trim() === '') continue;
    let remaining = p;
    while (remaining.length > 0 && result.length < maxLines) {
      if (remaining.length <= maxChars) {
        result.push(remaining);
        break;
      } else {
        let cut = maxChars;
        const spaceIdx = remaining.lastIndexOf(' ', maxChars);
        const chIdx = remaining.lastIndexOf('，', maxChars);
        const periodIdx = remaining.lastIndexOf('。', maxChars);
        const punctIdx = Math.max(spaceIdx, chIdx, periodIdx);
        if (punctIdx > maxChars / 2) {
          cut = punctIdx + 1;
        } else {
          cut = maxChars;
        }
        result.push(remaining.substring(0, cut).trim());
        remaining = remaining.substring(cut).trim();
        if (result.length >= maxLines) break;
      }
    }
    if (result.length >= maxLines) break;
  }
  if (result.length > maxLines) {
    result = result.slice(0, maxLines);
    const last = result[result.length - 1];
    if (!last.endsWith('...') && !last.endsWith('。') && !last.endsWith('！') && !last.endsWith('？')) {
      if (last.length > 3) {
        result[result.length - 1] = last.slice(0, -3) + '...';
      } else {
        result[result.length - 1] = last + '...';
      }
    }
  }
  if (result.length === 0) return ['暂无简介'];
  return result;
}

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (r > w/2) r = w/2;
    if (r > h/2) r = h/2;
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    return this;
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('加载图片失败: ' + src));
    img.src = src;
  });
}

function getDominantColor(ctx, image, width, height) {
  const sampleSize = 20;
  const x = Math.floor(width / 2 - sampleSize / 2);
  const y = Math.floor(height / 2 - sampleSize / 2);
  try {
    const imageData = ctx.getImageData(x, y, sampleSize, sampleSize);
    const data = imageData.data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i+1];
      b += data[i+2];
    }
    const count = data.length / 4;
    return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
  } catch {
    return { r: 100, g: 100, b: 100 };
  }
}

function isLight(color) {
  const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
  return brightness > 128;
}