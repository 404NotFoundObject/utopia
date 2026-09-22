// js/ui/screens/importUI.js - 导入角色界面（支持 JSON / PNG）
import { importCharacter } from '../../modules/character.js';
import { showToast } from '../components/toast.js';
import { showBanner } from '../components/banner.js';
import { openModal, closeModal } from '../components/modal.js';
import { renderCharacterList } from './characterListUI.js';

export function renderImportModal() {
  openModal(`
    <button class="modal-close">&times;</button>
    <h2 class="modal-title"><i class="fas fa-file-import"></i> 导入角色</h2>
    <div class="form-group">
      <label>选择角色卡文件</label>
      <div class="file-upload-wrapper">
        <input type="file" id="importFileInput" accept=".json,.png">
        <label class="file-upload-label" for="importFileInput">
          <i class="fas fa-cloud-upload-alt"></i>
          <span>选择文件</span>
          <span class="file-name" id="importFileName">未选择文件</span>
        </label>
      </div>
      <span class="help-text">支持 Utopia (v3/v3.1)、SillyTavern (v2/v3)、PNG 卡、Character.AI、通用格式</span>
    </div>
    <div class="form-group">
      <button class="btn btn-primary btn-block" id="doImportBtn">导入</button>
    </div>
  `);

  const fileInput = document.getElementById('importFileInput');
  const fileNameSpan = document.getElementById('importFileName');

  fileInput.addEventListener('change', function(e) {
    const file = this.files[0];
    if (file) {
      fileNameSpan.textContent = file.name;
    } else {
      fileNameSpan.textContent = '未选择文件';
    }
  });

  document.getElementById('doImportBtn').addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) {
      showToast('请选择文件', 'warning');
      return;
    }
    try {
      const result = await importCharacter(file, file.name);
      renderCharacterList();
      closeModal();

      // ★ 检测 API 连通性并给出提示
      //   使用 false（非强制刷新），复用 5 分钟内的连通性缓存，
      //   避免导入操作本身触发额外的网络请求。
      let isConnected = false;
      try {
        const { testApiConnection } = await import('../../core/api.js');
        isConnected = await testApiConnection(false);
      } catch (e) {
        console.warn('[Import] API 连通性检测失败:', e);
        isConnected = false;
      }

      if (isConnected) {
        showToast('角色导入成功', 'success');
      } else {
        // 用 banner 显示详细说明，避免 toast 时长太短用户读不完
        const charName = (result && result.name) ? result.name : '该角色';
        showBanner(
          `⚠️ 已导入「${charName}」\n` +
          `当前未检测到可用的 API 连接，以下功能将使用默认值：\n` +
          `· 性格量化：6 维参数将使用默认值（均为 50），可能导致性格漂移或 OOC\n` +
          `· 动态开场白：使用预设文本，而非根据场景动态生成\n` +
          `建议：配置 API 后，打开角色编辑表单点击「重新量化性格」`,
          10000,
          'warning'
        );
      }
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    }
  });
}