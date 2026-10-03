/**
 * 角色更新串行锁去重（审计 P3-5）。
 *
 * 原缺陷：character.js 的 _withCharacterLock 与 db.js 的 withKeyLock 实现逐行相同。
 * 现 updateCharacter 统一复用 withKeyLock('character', id, ...)。
 *
 * 本测试通过并发写入来锁定「串行语义」：若锁被移除或失效，
 * 两个并发的读-改-写会互相覆盖，必然丢失其中一个字段。
 */
import { describe, it, expect } from 'vitest';
import { getStores } from '../../js/core/db.js';
import { getAppState } from '../../js/core/state.js';
import { updateCharacter } from '../../js/modules/character.js';

describe('modules/character#updateCharacter 串行锁（P3-5 去重后仍生效）', () => {
  it('并发的读-改-写不会互相覆盖（锁有效）', async () => {
    const stores = await getStores();
    const cid = `lock-${Math.random().toString(36).slice(2)}`;
    const base = { id: cid, name: '锁测试', a: 0, b: 0, c: 0 };

    await stores.characters.add(base);
    // 预置进 appState.characters，使 skipReload 分支走局部更新，
    // 避免触发 loadCharacters() 的完整初始化副作用。
    getAppState().set('characters', [base]);

    await Promise.all([
      updateCharacter(cid, { a: 1 }, { skipReload: true }),
      updateCharacter(cid, { b: 2 }, { skipReload: true }),
      updateCharacter(cid, { c: 3 }, { skipReload: true }),
    ]);

    const after = await stores.characters.get(cid);
    expect(after.a).toBe(1);
    expect(after.b).toBe(2);
    expect(after.c).toBe(3);
  });

  it('对不同角色的更新互不阻塞（namespace + key 隔离）', async () => {
    const stores = await getStores();
    const id1 = `lock1-${Math.random().toString(36).slice(2)}`;
    const id2 = `lock2-${Math.random().toString(36).slice(2)}`;

    await stores.characters.add({ id: id1, name: '甲', v: 0 });
    await stores.characters.add({ id: id2, name: '乙', v: 0 });
    getAppState().set('characters', [
      { id: id1, name: '甲', v: 0 },
      { id: id2, name: '乙', v: 0 },
    ]);

    await Promise.all([
      updateCharacter(id1, { v: 10 }, { skipReload: true }),
      updateCharacter(id2, { v: 20 }, { skipReload: true }),
    ]);

    expect((await stores.characters.get(id1)).v).toBe(10);
    expect((await stores.characters.get(id2)).v).toBe(20);
  });
});
