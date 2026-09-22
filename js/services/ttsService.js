// js/services/ttsService.js - 统一 TTS 服务（支持 Web Speech API / Kokoro）
// 增强版：添加重试机制、音色分组、有效性检查

import { getAppState } from '../core/state.js';
import { showToast } from '../ui/components/toast.js';

// ---------- 配置 ----------
const TTS_MAX_RETRIES = 3;
const TTS_RETRY_DELAY_BASE = 300; // 毫秒

// ---------- 音色缓存 ----------
let voiceCache = [];
let voiceCacheLoaded = false;

// ---------- 当前播放状态 ----------
let currentUtterance = null;
let currentAudioContext = null;
let currentAudioSource = null;
let isPlaying = false;
let onEndCallbacks = [];

// ============================================================
// 1. 音色列表获取（含性别推断、分组）
// ============================================================

function inferGender(name) {
    const lower = name.toLowerCase();
    // 中文常见女声
    if (lower.includes('xiaoxiao') || lower.includes('xiaoyi') || lower.includes('yating') ||
        lower.includes('huihui') || lower.includes('yaoyao') || lower.includes('mei') ||
        lower.includes('samantha') || lower.includes('zira') || lower.includes('jenny') ||
        lower.includes('serena') || lower.includes('angela') || lower.includes('ava') ||
        lower.includes('emma') || lower.includes('mia') || lower.includes('zoe') ||
        lower.includes('sara') || lower.includes('nora') || lower.includes('luna')) {
        return 'female';
    }
    if (lower.includes('yunxi') || lower.includes('yunjian') || lower.includes('kangkang') ||
        lower.includes('guy') || lower.includes('davis') || lower.includes('mark') ||
        lower.includes('brian') || lower.includes('jason') || lower.includes('ryan') ||
        lower.includes('liam') || lower.includes('noah')) {
        return 'male';
    }
    return 'unknown';
}

function filterVoices(voices, language, gender) {
    let result = voices;
    if (language) {
        result = result.filter(v => v.lang.startsWith(language));
    }
    if (gender) {
        result = result.filter(v => v.gender === gender);
    }
    return result;
}

export function getVoices(language = null, gender = null) {
    return new Promise((resolve) => {
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
                voiceCache = voices.map(v => ({
                    name: v.name,
                    lang: v.lang,
                    voiceURI: v.voiceURI,
                    localService: v.localService,
                    default: v.default,
                    gender: inferGender(v.name),
                }));
                voiceCacheLoaded = true;
                resolve(filterVoices(voiceCache, language, gender));
            } else {
                window.speechSynthesis.onvoiceschanged = () => {
                    const voices2 = window.speechSynthesis.getVoices();
                    voiceCache = voices2.map(v => ({
                        name: v.name,
                        lang: v.lang,
                        voiceURI: v.voiceURI,
                        localService: v.localService,
                        default: v.default,
                        gender: inferGender(v.name),
                    }));
                    voiceCacheLoaded = true;
                    window.speechSynthesis.onvoiceschanged = null;
                    resolve(filterVoices(voiceCache, language, gender));
                };
                // 超时兜底
                setTimeout(() => {
                    if (!voiceCacheLoaded) {
                        const retry = window.speechSynthesis.getVoices();
                        if (retry.length > 0) {
                            voiceCache = retry.map(v => ({
                                name: v.name,
                                lang: v.lang,
                                voiceURI: v.voiceURI,
                                localService: v.localService,
                                default: v.default,
                                gender: inferGender(v.name),
                            }));
                            voiceCacheLoaded = true;
                            resolve(filterVoices(voiceCache, language, gender));
                        } else {
                            resolve([]);
                        }
                    }
                }, 3000);
            }
        };

        if (window.speechSynthesis && window.speechSynthesis.getVoices) {
            loadVoices();
        } else {
            resolve([]);
        }
    });
}

export async function getVoicesGroupedByLanguage() {
    const voices = await getVoices();
    const groups = {};
    for (const v of voices) {
        const lang = v.lang.split('-')[0];
        if (!groups[lang]) groups[lang] = [];
        groups[lang].push(v);
    }
    // 对每个语言组按性别排序（female, male, unknown）
    for (const key of Object.keys(groups)) {
        groups[key].sort((a, b) => {
            const order = { female: 0, male: 1, unknown: 2 };
            return (order[a.gender] || 2) - (order[b.gender] || 2);
        });
    }
    // 按语言代码排序
    return Object.keys(groups)
        .sort()
        .reduce((acc, key) => {
            acc[key] = groups[key];
            return acc;
        }, {});
}

// ---------- 音色有效性检查 ----------
export function getValidVoice(voiceName) {
    if (!voiceName) return null;
    const voices = window.speechSynthesis.getVoices();
    const matched = voices.find(v => v.name === voiceName || v.voiceURI === voiceName);
    if (matched) return matched;
    // 模糊匹配
    const fuzzy = voices.find(v => v.name.toLowerCase().includes(voiceName.toLowerCase()));
    return fuzzy || null;
}

// ============================================================
// 2. 核心 TTS 合成与播放（含重试）
// ============================================================

function getTTSConfig(character) {
    const settings = getAppState().get('settings') || {};
    const ttsSettings = settings.tts || {};
    
    const voice = character?.ttsVoice || ttsSettings.defaultVoice || null;
    const speed = character?.ttsSpeed ?? ttsSettings.defaultSpeed ?? 1.0;
    const pitch = character?.ttsPitch ?? ttsSettings.defaultPitch ?? 1.0;
    const provider = ttsSettings.provider || 'web-speech';
    const kokoroUrl = ttsSettings.kokoroUrl || 'http://localhost:8880/v1/audio/speech';
    const kokoroModel = ttsSettings.kokoroModel || 'kokoro-v0.19';

    return { voice, speed, pitch, provider, kokoroUrl, kokoroModel };
}

export async function speak(text, character = null, options = {}) {
    if (!text || text.trim().length === 0) return;

    stop();

    const config = getTTSConfig(character);
    const provider = config.provider;

    if (provider === 'kokoro' || provider === 'custom') {
        return speakWithKokoro(text, config, options);
    } else {
        return speakWithWebSpeech(text, config, options);
    }
}

// ---------- 2.1 Web Speech API (Edge TTS) 带重试 ----------
function speakWithWebSpeech(text, config, options) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const trySpeak = () => {
            if (!window.speechSynthesis) {
                reject(new Error('浏览器不支持 Speech Synthesis API'));
                return;
            }

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = Math.max(0.1, Math.min(10, config.speed));
            utterance.pitch = Math.max(0, Math.min(2, config.pitch));

            // 匹配音色（增加容错）
            if (config.voice) {
                const validVoice = getValidVoice(config.voice);
                if (validVoice) utterance.voice = validVoice;
                // 否则不设置，使用默认
            }

            let finished = false;
            const cleanup = () => {
                if (utterance.onstart) utterance.onstart = null;
                if (utterance.onend) utterance.onend = null;
                if (utterance.onerror) utterance.onerror = null;
            };

            utterance.onstart = () => {
                isPlaying = true;
                currentUtterance = utterance;
                if (options.onStart) options.onStart();
            };

            utterance.onend = () => {
                isPlaying = false;
                currentUtterance = null;
                cleanup();
                if (!finished) {
                    finished = true;
                    if (options.onEnd) options.onEnd();
                    resolve();
                }
            };

            utterance.onerror = (e) => {
                isPlaying = false;
                currentUtterance = null;
                cleanup();

                // 用户主动取消，不重试
                if (e.error === 'interrupted') {
                    if (!finished) {
                        finished = true;
                        if (options.onEnd) options.onEnd();
                        resolve();
                    }
                    return;
                }

                // 可重试的错误类型
                const retryable = ['synthesis-failed', 'network', 'audio-busy'];
                if (retryable.includes(e.error) && attempts < TTS_MAX_RETRIES) {
                    attempts++;
                    const delay = TTS_RETRY_DELAY_BASE * Math.pow(2, attempts - 1);
                    console.warn(`[TTS] 错误 "${e.error}"，${delay}ms 后重试 (${attempts}/${TTS_MAX_RETRIES})`);
                    setTimeout(trySpeak, delay);
                    return;
                }

                // 不可重试或超过次数
                console.warn('[TTS] Web Speech 错误:', e);
                if (!finished) {
                    finished = true;
                    if (options.onError) options.onError(e);
                    reject(e);
                }
            };

            // 如果语音列表尚未加载，等待加载完成
            if (window.speechSynthesis.getVoices().length === 0) {
                window.speechSynthesis.onvoiceschanged = () => {
                    window.speechSynthesis.onvoiceschanged = null;
                    window.speechSynthesis.speak(utterance);
                };
                // 超时保护：3秒后仍无语音则直接尝试
                setTimeout(() => {
                    if (window.speechSynthesis.onvoiceschanged) {
                        window.speechSynthesis.onvoiceschanged = null;
                        window.speechSynthesis.speak(utterance);
                    }
                }, 3000);
            } else {
                window.speechSynthesis.speak(utterance);
            }
        };

        trySpeak();
    });
}

// ---------- 2.2 Kokoro API ----------
async function speakWithKokoro(text, config, options) {
    try {
        const response = await fetch(config.kokoroUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.kokoroApiKey ? { 'Authorization': `Bearer ${config.kokoroApiKey}` } : {}),
            },
            body: JSON.stringify({
                model: config.kokoroModel,
                input: text,
                voice: config.voice || 'af_bella',
                speed: config.speed,
                response_format: 'mp3',
            }),
        });

        if (!response.ok) {
            throw new Error(`Kokoro API 请求失败: ${response.status} ${response.statusText}`);
        }

        const audioData = await response.arrayBuffer();

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        currentAudioContext = audioContext;

        const audioBuffer = await audioContext.decodeAudioData(audioData);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        currentAudioSource = source;

        if (options.onStart) options.onStart();

        source.onended = () => {
            isPlaying = false;
            currentAudioSource = null;
            currentAudioContext = null;
            if (options.onEnd) options.onEnd();
        };

        source.start();
        isPlaying = true;

        return new Promise((resolve) => {
            const origOnEnd = options.onEnd;
            options.onEnd = () => {
                if (origOnEnd) origOnEnd();
                resolve();
            };
            // 轮询兜底
            const checkEnd = () => {
                if (!isPlaying) {
                    resolve();
                } else {
                    setTimeout(checkEnd, 200);
                }
            };
            setTimeout(checkEnd, 500);
        });

    } catch (error) {
        console.error('[TTS] Kokoro 合成失败:', error);
        if (options.onError) options.onError(error);
        // 降级到 Web Speech
        console.log('[TTS] 降级到 Web Speech API');
        return speakWithWebSpeech(text, config, options);
    }
}

// ============================================================
// 3. 控制函数（停止、暂停、恢复）
// ============================================================

export function stop() {
    if (currentUtterance) {
        window.speechSynthesis?.cancel();
        currentUtterance = null;
    }
    if (currentAudioSource) {
        try {
            currentAudioSource.stop();
        } catch (_) {}
        currentAudioSource = null;
    }
    if (currentAudioContext && currentAudioContext.state !== 'closed') {
        try {
            currentAudioContext.close();
        } catch (_) {}
        currentAudioContext = null;
    }
    isPlaying = false;
}

export function pause() {
    if (currentUtterance && window.speechSynthesis) {
        window.speechSynthesis.pause();
    }
}

export function resume() {
    if (currentUtterance && window.speechSynthesis) {
        window.speechSynthesis.resume();
    }
}

export function isSpeaking() {
    return isPlaying || (window.speechSynthesis && window.speechSynthesis.speaking);
}

// ============================================================
// 4. 测试音色
// ============================================================

export async function testVoice(voiceName, text = '你好，世界！这是一次测试。') {
    const config = getTTSConfig(null);
    config.voice = voiceName;
    return speak(text, null, { 
        onStart: () => console.log('[TTS] 测试开始'),
        onEnd: () => console.log('[TTS] 测试结束'),
    });
}

// ============================================================
// 5. 自动初始化
// ============================================================

setTimeout(() => {
    getVoices().then(voices => {
        console.log(`[TTS] 预加载音色完成，共 ${voices.length} 个音色`);
    }).catch(() => {});
}, 2000);

console.log('[TTS] TTS 服务已加载');