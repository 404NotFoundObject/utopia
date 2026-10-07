#!/usr/bin/env node
/**
 * 一键下载语义模型到 lib/models/，使语义检索在「服务器侧」真正可用。
 *
 * 背景：
 *   - lib/models/ 整个目录被 .gitignore 忽略，全新克隆里只有 README.md，没有 onnx。
 *   - checkLocalModel 通过 HEAD 探测 /lib/models/<model>/onnx/<dtype 文件>，
 *     全新克隆里必然 404，语义引擎永远起不来。
 *   - 浏览器端 downloadModel 下载到浏览器 Cache，但 initSemanticEngine
 *     强制 allowLocalModels=true + localModelPath='/lib/models/'，二者无法打通。
 *
 * 本脚本把模型文件（onnx / config.json / tokenizer.json / tokenizer_config.json）
 * 真实落到 lib/models/<model-id>/ 下，让 checkLocalModel 的 HEAD 探测通过，
 * 语义层得以激活。文件仍被 .gitignore 忽略，不会误入库。
 *
 * 用法：
 *   node tools/fetch-model.mjs                          # 下载两个默认支持模型（q8）
 *   node tools/fetch-model.mjs Xenova/all-MiniLM-L6-v2  # 只下载指定模型
 *
 * 可选环境变量：
 *   MODEL_DTYPE=q8|fp32|fp16|q4  # 下载的量化精度（默认 q8）
 *   MODEL_DIR=lib/models          # 目标目录（默认 lib/models）
 */

import { mkdir, writeFile, access, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SUPPORTED_MODELS = [
  'Xenova/all-MiniLM-L6-v2',
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
];

// dtype -> onnx 文件名（与 DTYPE_FILE_MAP 一致）
const DTYPE_FILE_MAP = {
  fp32: 'model.onnx',
  fp16: 'model_fp16.onnx',
  q8: 'model_quantized.onnx',
  int8: 'model_int8.onnx',
  uint8: 'model_uint8.onnx',
  q4: 'model_q4.onnx',
  q4f16: 'model_q4f16.onnx',
  bnb4: 'model_bnb4.onnx',
};

// 模型目录内需要的文件（onnx 之外）
const AUX_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json'];

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function download(url, dest, label) {
  if (await fileExists(dest)) {
    console.log(`  ✓ 已存在，跳过 ${label}`);
    return;
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`下载 ${label} 失败：HTTP ${res.status} ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  const mb = (buf.length / 1024 / 1024).toFixed(1);
  console.log(`  ✓ 下载完成 ${label}（${mb} MB）`);
}

async function fetchModel(modelId, dtype, modelDir) {
  const modelName = modelId.split('/')[1] || modelId;
  const baseUrl = `https://huggingface.co/${modelId}/resolve/main`;
  const onnxFile = DTYPE_FILE_MAP[dtype] || DTYPE_FILE_MAP.q8;
  const outDir = join(ROOT, modelDir, modelName);
  const onnxDir = join(outDir, 'onnx');

  console.log(`\n▶ 下载模型 ${modelId}（dtype=${dtype}）`);
  try {
    // onnx 主文件（可能位于 onnx/ 子目录）
    const onnxUrl = `${baseUrl}/onnx/${onnxFile}`;
    const onnxDest = join(onnxDir, onnxFile);
    try {
      await download(onnxUrl, onnxDest, `${onnxFile}`);
    } catch (e) {
      // 部分旧模型把 onnx 放在根目录
      await download(`${baseUrl}/${onnxFile}`, join(outDir, onnxFile), `${onnxFile}（根目录）`);
    }

    for (const f of AUX_FILES) {
      await download(`${baseUrl}/${f}`, join(outDir, f), f);
    }
    console.log(`  ✅ ${modelName} 已就绪：${outDir}`);
  } catch (e) {
    console.error(`  ❌ ${modelName} 下载失败：${e.message}`);
    throw e;
  }
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const dtype = process.env.MODEL_DTYPE || 'q8';
  const modelDir = process.env.MODEL_DIR || 'lib/models';

  if (!DTYPE_FILE_MAP[dtype]) {
    console.error(`未知 dtype "${dtype}"，可用：${Object.keys(DTYPE_FILE_MAP).join(', ')}`);
    process.exit(1);
  }

  const targets = args.length ? args : SUPPORTED_MODELS;
  let failed = false;
  for (const id of targets) {
    try {
      await fetchModel(id, dtype, modelDir);
    } catch {
      failed = true;
    }
  }

  if (failed) {
    console.error('\n部分模型下载失败，请检查网络（可能需要代理访问 huggingface.co）。');
    process.exit(1);
  }
  console.log('\n全部完成。现在重启服务后，语义检索即可激活。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
