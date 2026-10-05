import { describe, it, expect } from 'vitest';
import {
  resolveStatusField,
  listStatusFields,
  readStatusValue,
  parseStatusValue,
  buildStatusPatch,
  formatStatusValue,
} from '../../../js/modules/statusFields.js';

/**
 * /status 可写字段表的纯计算测试。
 *
 * 这里钉住四类容易出错的地方：
 *   1. 同名歧义（emotionState.energy vs bodyState.energy）
 *   2. 相对增减与夹取
 *   3. 深合并不能把兄弟字段冲掉
 *   4. lastUpdate 必须同步（否则下一 tick 会用陈旧基准把刚设的值冲掉）
 */

const makeCharacter = () => ({
  id: 'c1',
  name: '小测试',
  emotionState: {
    valence: 10,
    arousal: 0,
    dominance: 0,
    affection: 20,
    trust: 5,
    intimacy: 5,
    energy: 0,
    needs: { safety: 70, esteem: 60, belonging: 50, autonomy: 50, pleasure: 50 },
    lastUpdate: 111,
  },
  bodyState: {
    energy: 80,
    sleepiness: 30,
    health: 95,
    sleepDebtHours: 2,
    totalSleepHours: 0,
    sleepQuality: 1,
    illness: { type: null, severity: 0 },
    injury: { type: null, severity: 0 },
    lastUpdate: 222,
  },
});

describe('字段解析', () => {
  it('裸名 energy 归 body（体力），emotion.energy 才是情感能量', () => {
    expect(resolveStatusField('energy').path).toEqual(['bodyState', 'energy']);
    expect(resolveStatusField('emotion.energy').path).toEqual(['emotionState', 'energy']);
    expect(resolveStatusField('mood.energy').path).toEqual(['emotionState', 'energy']);
  });

  it('大小写与前后空白不敏感', () => {
    expect(resolveStatusField('  Health  ')).toBe(resolveStatusField('health'));
  });

  it('未知字段返回 null（白名单之外一律拒绝）', () => {
    expect(resolveStatusField('lastUpdate')).toBeNull();
    expect(resolveStatusField('id')).toBeNull();
    expect(resolveStatusField('sleepStatus')).toBeNull();
    expect(resolveStatusField('')).toBeNull();
  });

  it('字段表覆盖 body / emotion / needs 三组', () => {
    const all = listStatusFields();
    expect(all.some((f) => f.group === 'body')).toBe(true);
    expect(all.some((f) => f.group === 'emotion')).toBe(true);
    expect(all.some((f) => f.path.includes('needs'))).toBe(true);
    // 每个字段都要有值域与中文标签，否则 /status fields 会输出 undefined
    for (const f of all) {
      expect(typeof f.range.min, `${f.key} 缺 min`).toBe('number');
      expect(typeof f.range.max, `${f.key} 缺 max`).toBe('number');
      expect(f.label, `${f.key} 缺 label`).toBeTruthy();
    }
  });
});

describe('读取当前值', () => {
  it('能读到嵌套字段', () => {
    const char = makeCharacter();
    expect(readStatusValue(char, resolveStatusField('health'))).toBe(95);
    expect(readStatusValue(char, resolveStatusField('safety'))).toBe(70);
    expect(readStatusValue(char, resolveStatusField('illness'))).toBe(0);
  });

  it('字段缺失返回 null 而不是抛错', () => {
    expect(readStatusValue({}, resolveStatusField('health'))).toBeNull();
    expect(readStatusValue(null, resolveStatusField('health'))).toBeNull();
    // emotionState 存在但 needs 缺失
    expect(readStatusValue({ emotionState: {} }, resolveStatusField('safety'))).toBeNull();
  });
});

describe('数值解析与夹取', () => {
  const health = resolveStatusField('health');

  it('绝对值与相对增减', () => {
    expect(parseStatusValue('90', 95, health).value).toBe(90);
    expect(parseStatusValue('+5', 95, health).value).toBe(100);
    expect(parseStatusValue('-20', 95, health).value).toBe(75);
    expect(parseStatusValue('+5', 95, health).relative).toBe(true);
  });

  it('超出值域夹取并标记 clamped', () => {
    const over = parseStatusValue('150', 95, health);
    expect(over.value).toBe(100);
    expect(over.clamped).toBe(true);

    const under = parseStatusValue('-30', 10, health);
    expect(under.value).toBe(0);
    expect(under.clamped).toBe(true);

    // 范围内不应误标
    expect(parseStatusValue('50', 10, health).clamped).toBe(false);
  });

  it('负号默认是相对减，绝对值负数要用 = 前缀', () => {
    const affection = resolveStatusField('affection');
    // -50 → 在 20 基础上减 50；=-50 → 直接设为 -50（消歧的关键）
    expect(parseStatusValue('-50', 20, affection).value).toBe(-30);
    expect(parseStatusValue('=-50', 20, affection).value).toBe(-50);
    expect(parseStatusValue('=-50', 20, affection).relative).toBe(false);
    expect(parseStatusValue('-999', 20, affection).value).toBe(-100);
  });

  it('+= / -= 与 + / - 等价', () => {
    const health = resolveStatusField('health');
    expect(parseStatusValue('+=5', 10, health).value).toBe(15);
    expect(parseStatusValue('-=5', 10, health).value).toBe(5);
    expect(parseStatusValue('=90', 10, health).value).toBe(90);
  });

  it('非数值与空值报错', () => {
    expect(parseStatusValue('abc', 50, health).ok).toBe(false);
    expect(parseStatusValue('', 50, health).ok).toBe(false);
    expect(parseStatusValue('abc', 50, health).error).toBeTruthy();
  });

  it('当前值缺失时相对增减以 0 为基准', () => {
    expect(parseStatusValue('+5', null, health).value).toBe(5);
  });
});

describe('生成写回 patch', () => {
  it('深合并：不能把兄弟字段冲掉', () => {
    const char = makeCharacter();
    const patch = buildStatusPatch(char, resolveStatusField('health'), 50);

    expect(patch.bodyState.health).toBe(50);
    // 同组其它字段必须原样保留
    expect(patch.bodyState.energy).toBe(80);
    expect(patch.bodyState.sleepiness).toBe(30);
    expect(patch.bodyState.illness).toEqual({ type: null, severity: 0 });
    // 不带 emotionState，避免浅合并误伤
    expect(patch.emotionState).toBeUndefined();
  });

  it('嵌套字段只改目标层，其余保留', () => {
    const char = makeCharacter();
    const patch = buildStatusPatch(char, resolveStatusField('safety'), 33);

    expect(patch.emotionState.needs.safety).toBe(33);
    expect(patch.emotionState.needs.esteem).toBe(60);
    expect(patch.emotionState.valence).toBe(10);
    expect(patch.bodyState).toBeUndefined();
  });

  it('必须同步 lastUpdate，否则下一 tick 会用陈旧基准冲掉新值', () => {
    const char = makeCharacter();
    const before = char.bodyState.lastUpdate;
    const patch = buildStatusPatch(char, resolveStatusField('health'), 50);
    expect(patch.bodyState.lastUpdate).not.toBe(before);
    expect(typeof patch.bodyState.lastUpdate).toBe('number');

    const ePatch = buildStatusPatch(char, resolveStatusField('valence'), 0);
    expect(ePatch.emotionState.lastUpdate).not.toBe(char.emotionState.lastUpdate);
  });

  it('不修改传入的原对象', () => {
    const char = makeCharacter();
    buildStatusPatch(char, resolveStatusField('health'), 1);
    expect(char.bodyState.health).toBe(95);
    buildStatusPatch(char, resolveStatusField('safety'), 1);
    expect(char.emotionState.needs.safety).toBe(70);
  });

  it('子对象缺失时也能建 patch（不抛错）', () => {
    const patch = buildStatusPatch({ id: 'x' }, resolveStatusField('health'), 50);
    expect(patch.bodyState.health).toBe(50);
    const nPatch = buildStatusPatch({ id: 'x' }, resolveStatusField('safety'), 50);
    expect(nPatch.emotionState.needs.safety).toBe(50);
  });
});

describe('展示格式', () => {
  it('整数不带小数，小数保留一位', () => {
    expect(formatStatusValue(100)).toBe('100');
    expect(formatStatusValue(3.25)).toBe('3.3');
    expect(formatStatusValue(null)).toBe('—');
  });
});
