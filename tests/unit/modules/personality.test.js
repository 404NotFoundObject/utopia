/**
 * js/modules/personality 单元测试：autoQuantifyIfNeeded 的重掷保护（审计 C-4）。
 *
 * 背景：原生卡导入时自带 personalityParameters，但通常没有 lastQuantifiedAt。
 * 旧逻辑的跳过条件要求「有参数 && 有时间戳 && !force」，创建角色时 force=true，
 * 于是角色每往返一次性格就被重新掷一次；若 API 不可达，还会被默认值（全 50）抹平。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../js/core/api.js', () => ({
  sendChatRequest: vi.fn(),
}));
vi.mock('../../../js/modules/character.js', () => ({
  updateCharacter: vi.fn(),
}));
vi.mock('../../../js/ui/components/toast.js', () => ({
  showToast: vi.fn(),
}));

import { autoQuantifyIfNeeded } from '../../../js/modules/personality.js';
import { sendChatRequest } from '../../../js/core/api.js';
import { updateCharacter } from '../../../js/modules/character.js';

const CUSTOM_PARAMS = {
  neuroticism: 12,
  extraversion: 88,
  agreeableness: 30,
  openness: 77,
  conscientiousness: 45,
  expressiveness: 91,
};

function makeCharacter(overrides = {}) {
  return {
    id: 'char-1',
    name: '测试角色',
    description: '自带性格参数的角色',
    personalityParameters: CUSTOM_PARAMS,
    // 关键：原生卡通常没有 lastQuantifiedAt
    lastQuantifiedAt: null,
    ...overrides,
  };
}

describe('modules/personality · autoQuantifyIfNeeded（审计 C-4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // quantifyCharacter 重试间隔是 1s，共 3 次；压掉等待避免测试变慢
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('已有性格参数且未强制量化时跳过，不调用 AI', async () => {
    const char = makeCharacter();
    const result = await autoQuantifyIfNeeded(char, false);

    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(updateCharacter).not.toHaveBeenCalled();
    expect(result.personalityParameters).toEqual(CUSTOM_PARAMS);
  });

  it('关键场景：有参数但无 lastQuantifiedAt 时也不重掷（旧逻辑此处会重掷）', async () => {
    const char = makeCharacter(); // lastQuantifiedAt: null
    await autoQuantifyIfNeeded(char, !char.personalityParameters); // 模拟 createCharacter 的调用方式

    expect(sendChatRequest).not.toHaveBeenCalled();
  });

  it('无性格参数时才触发量化', async () => {
    const char = makeCharacter({ personalityParameters: null });
    sendChatRequest.mockResolvedValue({
      content: JSON.stringify({
        personality: CUSTOM_PARAMS,
        bodyProfile: {},
        emotionProfile: {},
      }),
    });

    await autoQuantifyIfNeeded(char, true);

    expect(sendChatRequest).toHaveBeenCalled();
  });

  it('量化失败且已有参数时保留原值，不写全 50 默认值', async () => {
    const char = makeCharacter();
    // 空内容 → quantifyCharacter 重试耗尽后回落默认值（标记 failed）
    sendChatRequest.mockResolvedValue({ content: '' });

    const result = await autoQuantifyIfNeeded(char, true);

    // 关键：不得落库，且返回值仍是角色原有参数
    expect(updateCharacter).not.toHaveBeenCalled();
    expect(result.personalityParameters).toEqual(CUSTOM_PARAMS);
    expect(result.personalityParameters.neuroticism).toBe(12); // 不是默认的 50
  });

  it('量化失败且已有参数时，API 抛错同样不覆盖原值', async () => {
    const char = makeCharacter();
    sendChatRequest.mockRejectedValue(new Error('API 不可达'));

    const result = await autoQuantifyIfNeeded(char, true);

    expect(updateCharacter).not.toHaveBeenCalled();
    expect(result.personalityParameters).toEqual(CUSTOM_PARAMS);
  });

  it('量化失败且无参数时才回退默认值', async () => {
    const char = makeCharacter({ personalityParameters: null });
    sendChatRequest.mockResolvedValue({ content: '' });

    const result = await autoQuantifyIfNeeded(char, true);

    expect(updateCharacter).toHaveBeenCalled();
    expect(result.personalityParameters.neuroticism).toBe(50);
  });
});
