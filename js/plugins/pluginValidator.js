/**
 * @module plugins/pluginValidator
 * @description 插件清单（manifest.json）校验器
 *
 * 校验内容：
 *   - 必填字段
 *   - ID 格式（反向域名）
 *   - 版本号语义化格式
 *   - 路径安全性
 *   - 权限数组
 *   - Utopia 版本兼容性
 */

// ============================================================
// 常量
// ============================================================

// 插件 API 版本（与 pluginApi.js 保持一致）
const API_VERSION = '1.0.0';

// Utopia 应用版本
const UTOPIA_VERSION = '3.2.0';

// 插件 ID：反向域名格式
const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/i;

// 语义化版本
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/i;

// ============================================================
// 主校验函数
// ============================================================

/**
 * 校验清单，失败抛异常
 * @param {Object} manifest
 * @returns {boolean}
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest.json 必须是 JSON 对象');
  }

  // ---- 必填字段 ----
  const required = ['id', 'name', 'version', 'main'];
  for (const field of required) {
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      throw new Error(`manifest.json 缺少必填字段或字段无效: ${field}`);
    }
  }

  // ---- ID 格式 ----
  if (!ID_PATTERN.test(manifest.id)) {
    throw new Error(
      `插件 ID 格式错误: "${manifest.id}"\n` +
      `正确格式：com.author.plugin-name（反向域名）`
    );
  }

  // ---- 版本格式 ----
  if (!VERSION_PATTERN.test(manifest.version)) {
    throw new Error(
      `版本号格式错误: "${manifest.version}"\n` +
      `正确格式：x.y.z 或 x.y.z-tag（如 1.0.0、2.1.0-beta）`
    );
  }

  // ---- 入口文件路径安全 ----
  validatePath(manifest.main, 'main');
  if (manifest.ui) validatePath(manifest.ui, 'ui');

  // ---- 权限必须是数组 ----
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      throw new Error('permissions 必须是数组');
    }
    for (const p of manifest.permissions) {
      if (typeof p !== 'string') {
        throw new Error(`权限项必须是字符串: ${JSON.stringify(p)}`);
      }
    }
  }

  // ---- 兼容性检查 ----
  if (manifest.utopia) {
    checkCompatibility(manifest.utopia);
  }

  return true;
}

// ============================================================
// 路径校验
// ============================================================

function validatePath(p, label) {
  if (typeof p !== 'string' || !p) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  if (p.includes('..')) {
    throw new Error(`${label} 路径不安全（包含 ..）: ${p}`);
  }
  if (p.startsWith('/') || /^[a-z]:/i.test(p)) {
    throw new Error(`${label} 路径不安全（绝对路径）: ${p}`);
  }
  if (p.includes('\\')) {
    throw new Error(`${label} 路径不能包含反斜杠: ${p}`);
  }
}

// ============================================================
// 兼容性检查
// ============================================================

/**
 * 检查插件与当前 API 版本兼容性
 * @param {Object} utopiaField - manifest.utopia 字段
 */
export function checkCompatibility(utopiaField) {
  if (!utopiaField || typeof utopiaField !== 'object') return true;

  const { minVersion, maxVersion } = utopiaField;

  if (minVersion) {
    if (!VERSION_PATTERN.test(minVersion)) {
      throw new Error(`utopia.minVersion 格式错误: ${minVersion}`);
    }
    if (compareVersions(API_VERSION, minVersion) < 0) {
      throw new Error(
        `插件要求 UtopiaPlugin ≥ ${minVersion}，当前版本 ${API_VERSION}`
      );
    }
  }

  if (maxVersion) {
    if (!VERSION_PATTERN.test(maxVersion)) {
      throw new Error(`utopia.maxVersion 格式错误: ${maxVersion}`);
    }
    if (compareVersions(API_VERSION, maxVersion) > 0) {
      throw new Error(
        `插件仅支持到 UtopiaPlugin ≤ ${maxVersion}，当前版本 ${API_VERSION}`
      );
    }
  }

  return true;
}

// ============================================================
// 版本比较
// ============================================================

/**
 * 语义化版本比较
 * @param {string} a
 * @param {string} b
 * @returns {number} -1 / 0 / 1
 */
export function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ============================================================
// 导出常量
// ============================================================

export { API_VERSION, UTOPIA_VERSION };