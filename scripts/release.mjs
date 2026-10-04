#!/usr/bin/env node
/**
 * 发布脚本：一处输入版本号，同步所有「版本号副本」。
 *
 * 用法：
 *   node scripts/release.mjs 3.9.5
 *   node scripts/release.mjs 3.9.5 --no-date        // 不刷新 version.json 的 build 时间
 *
 * 为什么需要它：
 *   版本号此前散落在 app.js / package.json / README，更新后又新增了 version.json。
 *   手工改必然漏改某处 —— SW 缓存名陈旧（用户加载不到新版本）与「设置页显示的版本
 *   与实际不符」都源于此。这里一次改全，并提示剩下的文档动作。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const noDate = args.includes('--no-date');

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail('请提供语义化版本号，例如：node scripts/release.mjs 3.9.5');
}

function read(rel) {
  if (!existsSync(resolve(root, rel))) fail(`找不到文件：${rel}`);
  return readFileSync(resolve(root, rel), 'utf8');
}

function write(rel, content) {
  writeFileSync(resolve(root, rel), content, 'utf8');
}

/** 替换并检查确实替换成功（模式没匹配上时不能静默跳过） */
function replaceOnce(content, pattern, replacement, label) {
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  if (!re.test(content)) fail(`${label}：未在文件中找到待替换的模式，请检查文件内容是否已变更`);
  return content.replace(re, replacement);
}

// ---- 1. js/core/appMeta.js（运行期唯一真源） ----
const appMetaPath = 'js/core/appMeta.js';
let appMeta = read(appMetaPath);
appMeta = replaceOnce(
  appMeta,
  /export const APP_VERSION = '[^']*';/,
  `export const APP_VERSION = '${version}';`,
  'appMeta.js 的 APP_VERSION'
);
write(appMetaPath, appMeta);

// ---- 2. package.json ----
const pkgPath = 'package.json';
let pkg = read(pkgPath);
pkg = replaceOnce(pkg, /"version":\s*"[^"]*"/, `"version": "${version}"`, 'package.json 的 version');
write(pkgPath, pkg);

// ---- 3. version.json（更新探测通道 + SW 缓存名来源） ----
const versionJsonPath = 'version.json';
let versionJson = read(versionJsonPath);
const build = noDate
  ? (JSON.parse(versionJson).build ?? new Date().toISOString())
  : new Date().toISOString();
write(
  versionJsonPath,
  `${JSON.stringify({ version, build, channel: 'stable' }, null, 2)}\n`
);

// ---- 4. README 版本徽章 ----
const readmePath = 'README.md';
let readme = read(readmePath);
readme = replaceOnce(
  readme,
  /badge\/version-[^-]*-/,
  `badge/version-${version}-`,
  'README.md 的版本徽章'
);
write(readmePath, readme);

console.log(`✅ 版本号已更新至 ${version}`);
console.log('   - js/core/appMeta.js（运行期真源）');
console.log('   - package.json');
console.log(`   - version.json（build: ${build}）`);
console.log('   - README.md 徽章');
console.log('\n⚠️  还需手动：');
console.log('   1. CHANGELOG.md 新增 [x.y.z] 条目');
console.log('   2. README.md 更新记录新增 vX.Y.Z 小节');
console.log('   3. git commit + git tag vX.Y.Z（sw.js 缓存名会自动随 version.json 变化）');
