// js/services/sttService.js - 语音识别服务（Web Speech API + HTTP Whisper）
//   - app.js 中 stopRecording 已同步适配 await
import { getAppState } from '../core/state.js';
import { showToast } from '../ui/components/toast.js';

// ============================================================
// 配置常量
// ============================================================
const STT_MAX_RETRIES = 3;
const STT_RETRY_DELAY_BASE = 500;

// ============================================================
// 状态管理
// ============================================================
let recognition = null;
let isListening = false;
let onResultCallback = null;
let onEndCallback = null;
let onErrorCallback = null;
let isFinal = false;
let interimTranscript = '';
let finalTranscript = '';
let restartTimeout = null;
let autoRestart = true;

let _httpStopResolver = null;

// HTTP API 专用状态
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let httpAbortController = null;
let isTranscribing = false;

// ============================================================
// 获取 STT 配置
// ============================================================
function getSTTConfig() {
  const settings = getAppState().get('settings') || {};
  const stt = settings.stt || {};
  return {
    provider: stt.provider || 'web-speech',
    language: stt.language || 'zh-CN',
    httpUrl: stt.httpUrl || '',
    httpApiKey: stt.httpApiKey || '',
    httpModel: stt.httpModel || 'whisper-1',
    httpTimeout: stt.httpTimeout || 30000,
  };
}

// ============================================================
// Web Speech API 实现
// ============================================================
function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.warn('[STT] 浏览器不支持 Web Speech API');
    return null;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();

  const settings = getAppState().get('settings') || {};
  const sttSettings = settings.stt || {};
  rec.lang = sttSettings.language || 'zh-CN';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec._retryCount = 0;

  rec.onresult = (event) => {
    let interim = '';
    let finalDelta = '';
    // ★ 从 event.resultIndex 开始，只读取本次新增的结果
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalDelta += transcript;
      } else {
        interim += transcript;
      }
    }
    interimTranscript = interim;
    if (finalDelta) {
      finalTranscript += finalDelta;   // 内部累积（供 getFinalTranscript 读取）
      isFinal = true;
      // ★ 只回调增量，避免连续识别时字幕重复
      if (onResultCallback) {
        onResultCallback(finalDelta, true);
      }
    } else if (interim && onResultCallback) {
      onResultCallback(interim, false);
    }
  };

  rec.onerror = (event) => {
    console.warn('[STT] 识别错误:', event.error);
    if (onErrorCallback) onErrorCallback(event.error, event);

    if (event.error === 'network') {
      if (rec._retryCount < STT_MAX_RETRIES) {
        rec._retryCount++;
        const delay = STT_RETRY_DELAY_BASE * Math.pow(2, rec._retryCount - 1);
        console.warn(`[STT] 网络错误，${delay}ms 后重试 (${rec._retryCount}/${STT_MAX_RETRIES})`);
        setTimeout(() => {
          if (!isListening && !rec._aborted) {
            try {
              rec.start();
              isListening = true;
              console.log('[STT] 重试启动成功');
            } catch (e) {
              console.error('[STT] 重试启动失败:', e);
            }
          }
        }, delay);
        return;
      } else {
        showToast('语音识别网络错误，请检查网络后重试', 'error');
      }
    } else if (event.error === 'no-speech' && autoRestart) {
      // 不重试，让引擎自然重启
    } else if (event.error === 'audio-capture') {
      showToast('无法访问麦克风，请检查权限设置', 'error');
    } else if (event.error === 'not-allowed') {
      showToast('麦克风权限被拒绝，请允许后重试', 'error');
    }

    if (autoRestart && event.error !== 'not-allowed' && event.error !== 'audio-capture') {
      restartRecognition();
    }
  };

  rec.onend = () => {
    isListening = false;
    if (onEndCallback) onEndCallback();
    if (autoRestart && !isListening) {
      if (restartTimeout) clearTimeout(restartTimeout);
      restartTimeout = setTimeout(() => {
        if (autoRestart && !isListening) {
          startListening();
        }
      }, 500);
    }
  };

  return rec;
}

function restartRecognition() {
  if (isListening) return;
  if (autoRestart && recognition) {
    try {
      recognition.start();
      isListening = true;
      console.log('[STT] 重启监听...');
    } catch (e) {
      console.warn('[STT] 重启失败:', e);
    }
  }
}

function startWebSpeech(options, language, continuous) {
  if (!recognition) {
    recognition = initSpeechRecognition();
    if (!recognition) {
      showToast('浏览器不支持语音识别，请使用 Chrome/Edge 等浏览器', 'error');
      return;
    }
  }

  recognition.lang = language;
  recognition.continuous = continuous;
  recognition._retryCount = 0;
  recognition._aborted = false;

  try {
    recognition.start();
    isListening = true;
    console.log('[STT] Web Speech 开始监听...');
  } catch (err) {
    console.error('[STT] 启动失败:', err);
    if (onErrorCallback) onErrorCallback(err.message, err);
    showToast('语音识别启动失败: ' + err.message, 'error');
  }
}

// ============================================================
// HTTP Whisper API 实现
// ============================================================

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/wav',
  ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {}
  }
  return '';
}

function mimeToExtension(mimeType) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

function stopMediaStream() {
  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach(track => track.stop());
    } catch (e) {
      console.warn('[STT] 停止麦克风轨道失败:', e);
    }
    mediaStream = null;
  }
}

async function transcribeAudio() {
  const config = getSTTConfig();
  const mimeType = audioChunks[0]?.type || 'audio/webm';
  const audioBlob = new Blob(audioChunks, { type: mimeType });
  audioChunks = [];

  if (audioBlob.size === 0) {
    console.warn('[STT] 音频数据为空');
    isTranscribing = false;
    if (onEndCallback) onEndCallback();
    return;
  }

  console.log(`[STT] 上传音频: ${audioBlob.size} 字节, 类型: ${mimeType}`);

  const formData = new FormData();
  const ext = mimeToExtension(mimeType);
  formData.append('file', audioBlob, `audio.${ext}`);
  formData.append('model', config.httpModel);
  formData.append('language', config.language.split('-')[0]);
  formData.append('response_format', 'json');

  let url = config.httpUrl;
  if (!url.match(/\/(audio\/)?transcriptions\/?$/)) {
    url = url.replace(/\/+$/, '') + '/v1/audio/transcriptions';
  }

  const headers = {};
  if (config.httpApiKey) {
    headers['Authorization'] = `Bearer ${config.httpApiKey}`;
  }

  httpAbortController = new AbortController();
  const timer = setTimeout(() => httpAbortController.abort(), config.httpTimeout);

  isTranscribing = true;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      signal: httpAbortController.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`STT 请求失败 (${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = (data.text || data.transcript || data.result || '').trim();

    if (text) {
      finalTranscript = text;
      isFinal = true;
      if (onResultCallback) onResultCallback(text, true);
    } else {
      console.warn('[STT] 返回结果为空');
    }
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.warn('[STT] 请求超时或已取消');
    } else {
      console.error('[STT] 转录失败:', err);
      if (onErrorCallback) onErrorCallback(err.message, err);
      showToast('语音识别失败: ' + err.message, 'error');
    }
  } finally {
    httpAbortController = null;
    isTranscribing = false;
    if (onEndCallback) onEndCallback();
  }
}

async function startHttpRecording() {
  const config = getSTTConfig();

  if (!config.httpUrl) {
    const msg = 'HTTP STT 服务地址未配置';
    if (onErrorCallback) onErrorCallback(msg, new Error(msg));
    showToast(msg, 'error');
    return;
  }

  if (typeof MediaRecorder === 'undefined') {
    const msg = '浏览器不支持 MediaRecorder';
    if (onErrorCallback) onErrorCallback(msg, new Error(msg));
    showToast(msg, 'error');
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('[STT] 无法访问麦克风:', err);
    let errorMsg = '无法访问麦克风';
    if (err.name === 'NotAllowedError') errorMsg = '麦克风权限被拒绝，请允许后重试';
    else if (err.name === 'NotFoundError') errorMsg = '未找到麦克风设备';
    if (onErrorCallback) onErrorCallback(errorMsg, err);
    showToast(errorMsg, 'error');
    return;
  }

  audioChunks = [];
  const mimeType = pickMimeType();
  const mediaRecorderOptions = mimeType ? { mimeType } : {};

  try {
    mediaRecorder = new MediaRecorder(mediaStream, mediaRecorderOptions);
  } catch (err) {
    console.error('[STT] 创建 MediaRecorder 失败:', err);
    stopMediaStream();
    if (onErrorCallback) onErrorCallback(err.message, err);
    showToast('无法创建录音器: ' + err.message, 'error');
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      audioChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = async () => {
    isListening = false;
    stopMediaStream();
    await transcribeAudio();
    // ★ 转录完成（或失败）后 resolve 外部 await
    if (_httpStopResolver) {
      const r = _httpStopResolver;
      _httpStopResolver = null;
      r();
    }
  };

  mediaRecorder.onerror = (e) => {
    console.error('[STT] MediaRecorder 错误:', e.error);
    if (onErrorCallback) onErrorCallback(e.error?.message || 'MediaRecorder 错误', e.error);
    if (_httpStopResolver) {
      const r = _httpStopResolver;
      _httpStopResolver = null;
      r();
    }
  };

  try {
    mediaRecorder.start();
    isListening = true;
    console.log('[STT] HTTP 模式：开始录音');
  } catch (err) {
    console.error('[STT] 启动录音失败:', err);
    stopMediaStream();
    if (onErrorCallback) onErrorCallback(err.message, err);
    showToast('启动录音失败: ' + err.message, 'error');
  }
}

// ============================================================
// 统一入口
// ============================================================

/**
 * 启动语音识别
 */
export function startListening(options = {}) {
  if (isListening) {
    console.warn('[STT] 已经在监听中');
    return;
  }

  finalTranscript = '';
  interimTranscript = '';
  isFinal = false;

  const config = getSTTConfig();
  const language = options.language || config.language;
  onResultCallback = options.onResult || null;
  onEndCallback = options.onEnd || null;
  onErrorCallback = options.onError || null;
  const continuous = options.continuous !== undefined ? options.continuous : true;
  autoRestart = options.autoRestart !== undefined ? options.autoRestart : true;

  if (config.provider === 'whisper-http') {
    startHttpRecording();
  } else {
    startWebSpeech(options, language, continuous);
  }
}

/**
 * 停止语音识别
 *
 * @param {boolean} [keepFinal=true]
 * @returns {Promise<void>}
 */
export function stopListening(keepFinal = true) {
  const config = getSTTConfig();

  if (httpAbortController) {
    try { httpAbortController.abort(); } catch {}
    httpAbortController = null;
  }

  if (config.provider === 'whisper-http') {
    return new Promise((resolve) => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        _httpStopResolver = resolve;
        try {
          mediaRecorder.stop();
        } catch (e) {
          console.warn('[STT] 停止录音失败:', e);
          _httpStopResolver = null;
          resolve();
        }
      } else {
        resolve();
      }
      isListening = false;
      if (!keepFinal) {
        finalTranscript = '';
        interimTranscript = '';
        audioChunks = [];
      }
    });
  }

  // Web Speech 模式：同步 resolve
  if (!isListening) return Promise.resolve();
  autoRestart = false;
  if (recognition) {
    recognition._aborted = true;
    try {
      recognition.stop();
    } catch (e) {}
  }
  isListening = false;
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  console.log('[STT] 停止监听');
  if (!keepFinal) {
    finalTranscript = '';
    interimTranscript = '';
  }
  return Promise.resolve();
}

export function resetTranscript() {
  finalTranscript = '';
  interimTranscript = '';
  isFinal = false;
  audioChunks = [];
}

export function getFinalTranscript() {
  return finalTranscript;
}

export function getInterimTranscript() {
  return interimTranscript;
}

export function isCurrentlyListening() {
  return isListening;
}

export function isCurrentlyTranscribing() {
  return isTranscribing;
}

export function setLanguage(lang) {
  if (recognition) {
    recognition.lang = lang;
  }
}

// ============================================================
// 直接转录接口
// ============================================================

export async function transcribeWithWhisper(audioBlob, options = {}) {
  const config = getSTTConfig();
  if (!config.httpUrl) {
    throw new Error('HTTP STT 服务地址未配置');
  }

  const formData = new FormData();
  const ext = mimeToExtension(audioBlob.type);
  formData.append('file', audioBlob, `audio.${ext}`);
  formData.append('model', options.model || config.httpModel);
  formData.append('language', (options.language || config.language).split('-')[0]);
  formData.append('response_format', 'json');

  let url = config.httpUrl;
  if (!url.match(/\/(audio\/)?transcriptions\/?$/)) {
    url = url.replace(/\/+$/, '') + '/v1/audio/transcriptions';
  }

  const headers = {};
  if (config.httpApiKey) {
    headers['Authorization'] = `Bearer ${config.httpApiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`STT 请求失败 (${response.status}): ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.text || data.transcript || data.result || '';
}

export async function testHttpSttConnection() {
  const config = getSTTConfig();
  if (!config.httpUrl) {
    return { ok: false, error: '未配置服务地址' };
  }

  let url = config.httpUrl;
  if (!url.match(/\/(audio\/)?transcriptions\/?$/)) {
    url = url.replace(/\/+$/, '') + '/v1/audio/transcriptions';
  }

  try {
    const silentWav = createSilentWav(0.1);
    const formData = new FormData();
    formData.append('file', silentWav, 'test.wav');
    formData.append('model', config.httpModel);
    formData.append('language', 'zh');

    const headers = {};
    if (config.httpApiKey) {
      headers['Authorization'] = `Bearer ${config.httpApiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      return { ok: true };
    }
    const errText = await response.text();
    return { ok: false, error: `HTTP ${response.status}: ${errText.slice(0, 100)}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, error: '请求超时' };
    }
    return { ok: false, error: err.message };
  }
}

function createSilentWav(durationSeconds = 0.1) {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// ============================================================
// 能力检测
// ============================================================
const isSpeechSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const isMediaRecorderSupported = typeof MediaRecorder !== 'undefined';

export { isSpeechSupported, isMediaRecorderSupported };

console.log(`[STT] Web Speech API ${isSpeechSupported ? '✅' : '❌'}`);
console.log(`[STT] MediaRecorder ${isMediaRecorderSupported ? '✅' : '❌'}`);
console.log('[STT] STT 服务已加载');