/**
 * @module ui/screens/settingsUI/sections/user
 * @description 用户信息 section（用户名 + 头像）
 *
 */

const AVATAR_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'80\' height=\'80\' viewBox=\'0 0 80 80\'%3E%3Ccircle cx=\'40\' cy=\'40\' r=\'40\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'40\' y=\'48\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'24\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';

/**
 * 渲染用户信息 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderUserSection(settings, ctx) {
  const avatarSrc = settings.user?.avatar || '';

  return `
    <!-- 用户信息 -->
    <div class="settings-section">
      <h3>👤 用户信息</h3>
      <div class="setting-row">
        <label>用户名</label>
        <input type="text" id="settingsUserName" value="${ctx.escapeHtml(settings.user?.name || '')}" />
      </div>
      <div class="setting-row">
        <label>头像</label>
        <div class="file-upload-wrapper">
          <input type="file" id="settingsUserAvatarInput" accept="image/*">
          <label class="file-upload-label" for="settingsUserAvatarInput">
            <i class="fas fa-cloud-upload-alt"></i>
            <span>选择头像</span>
            <span class="file-name" id="settingsAvatarFileName">未选择文件</span>
          </label>
        </div>
        <img id="settingsAvatarPreview" class="avatar-preview" src="${ctx.escapeHtml(avatarSrc || AVATAR_PLACEHOLDER)}" alt="头像预览">
        <span class="help-text">选择图片上传，将自动转换为Base64存储</span>
      </div>
    </div>
  `;
}

/**
 * 绑定用户信息 section 的事件
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 */
export function bindUserSection(modalContent, ctx) {
  const avatarInput = modalContent.querySelector('#settingsUserAvatarInput');
  const avatarPreview = modalContent.querySelector('#settingsAvatarPreview');
  const avatarFileName = modalContent.querySelector('#settingsAvatarFileName');

  if (avatarInput && avatarPreview) {
    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        avatarFileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => { avatarPreview.src = ev.target.result; };
        reader.readAsDataURL(file);
      } else {
        avatarFileName.textContent = '未选择文件';
      }
    });
  }
}