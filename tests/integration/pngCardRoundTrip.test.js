/**
 * PNG 角色卡端到端往返（审计 S-3）。
 *
 * 此前 PNG 相关测试全部建立在「手搓夹具」上：fixtures.js 自己拼 tEXt 块字节，
 * 直接喂给 extractTextChunk / extractJSONFromPNG。这条链路绕开了应用真正走的
 * 路径——写入端是 png.js 的 embedJSONToPNG，读取端是 characterAdapter 的
 * parsePNG（FileReader → extractTextChunk → JSON.parse）。两边各有一份解码实现
 * 且已经漂移，而夹具测试恰好把它们分别覆盖，漂移因此长期无人发现。
 *
 * 本文件改为：真实写入 → 真实读取 → 真实格式识别 → 真实转换 → 真实落库，
 * 全程不碰手搓的 tEXt 字节。
 */
import { describe, it, expect } from 'vitest';
import { embedJSONToPNG, extractJSONFromPNG, extractTextChunk } from '../../js/utils/png.js';
import {
  parsePNG,
  detectFormat,
  convertToUtopia,
  convertFromUtopia,
} from '../../js/modules/characterAdapter.js';
import { importCharacter } from '../../js/modules/character.js';
// createCharacter 会 fire-and-forget 地动态 import('./personality.js')。提前把它
// 拉进模块图，避免这个后台导入在测试环境关闭后才求值、冒出 unhandled rejection。
import '../../js/modules/personality.js';
import { getStores } from '../../js/core/db.js';
import { tinyPngBlob } from '../helpers/fixtures.js';

/** 用应用真实的写入端把对象嵌进 PNG，再包成 File（模拟 <input type=file> 的产物） */
async function toPngFile(obj, fileName = '角色卡.png') {
  const blob = await embedJSONToPNG(tinyPngBlob(), JSON.stringify(obj));
  return new File([blob], fileName, { type: 'image/png' });
}

describe('PNG 角色卡 · 真实读写往返（写入端 embedJSONToPNG → 读取端 parsePNG）', () => {
  it('ST v2 卡经真实嵌入后能被 parsePNG 原样读回', async () => {
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '柳如烟',
        description: '性格迷糊的少女，在咖啡馆打工。',
        personality: '温柔、健忘、爱笑',
        first_mes: '欢迎光临～',
        scenario: '午后的咖啡馆',
      },
    };

    const file = await toPngFile(card);
    const parsed = await parsePNG(file);

    expect(parsed).toEqual(card);
  });

  it('中文、换行与 emoji 经 base64 往返不乱码', async () => {
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: '凌川',
        description: '第一行\n第二行\n带 emoji 🎭',
        personality: '毒舌但心软',
      },
    };

    const file = await toPngFile(card);
    const parsed = await parsePNG(file);

    expect(parsed.data.description).toBe(card.data.description);
    expect(parsed.data.name).toBe('凌川');
  });

  it('Utopia 原生卡 PNG 往返：识别为 utopia-v3.1 且字段保真', async () => {
    const card = {
      schema: 'utopia-character/v3.1',
      name: '凌川',
      description: '毒舌但心软的少年。',
      personality: '外冷内热',
      characterBook: { entries: [{ keys: ['过去'], content: '曾在雨里等过一个人' }] },
    };

    const file = await toPngFile(card);
    const parsed = await parsePNG(file);

    expect(detectFormat(parsed)).toBe('utopia-v3.1');
    const converted = convertToUtopia(parsed, detectFormat(parsed));
    expect(converted.name).toBe('凌川');
    expect(converted.characterBook).toEqual(card.characterBook);
  });

  it('ST v2 导入 → Utopia → 导出 → 嵌入 PNG → 再解析，世界书不丢', async () => {
    const stCard = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '小兰',
        description: '描述',
        personality: '温柔',
        first_mes: '你好',
        character_book: { entries: [{ keys: ['武器'], content: '长剑' }] },
        alternate_greetings: ['另一种开场白'],
      },
    };

    // 真实导入转换 → 真实导出转换 → 真实嵌入 → 真实解析
    const utopia = convertToUtopia(stCard, 'st-v2');
    const exported = convertFromUtopia(utopia, 'st-v2');
    const file = await toPngFile(exported);
    const reparsed = await parsePNG(file);

    expect(detectFormat(reparsed)).toBe('st-v2');
    const back = convertToUtopia(reparsed, 'st-v2');
    expect(back.name).toBe('小兰');
    expect(back.characterBook).toEqual(stCard.data.character_book);
    expect(back.alternateGreetings).toEqual(['另一种开场白']);
  });

  it('两个解码入口对同一份 PNG 结果一致（防两份实现漂移）', async () => {
    const card = { spec: 'chara_card_v2', data: { name: '漂移守卫' } };
    const blob = await embedJSONToPNG(tinyPngBlob(), JSON.stringify(card));

    // 入口 A：png.js 的 Blob 级接口
    const viaPng = await extractJSONFromPNG(blob);
    // 入口 B：characterAdapter 实际使用的字节级接口
    const viaAdapter = JSON.parse(extractTextChunk(await blob.arrayBuffer()));

    expect(viaPng).toEqual(card);
    expect(viaAdapter).toEqual(viaPng);
  });

  it('characterAdapter 与 png.js 导出的是同一个函数（结构性防重复）', async () => {
    const pngModule = await import('../../js/utils/png.js');
    const adapterModule = await import('../../js/modules/characterAdapter.js');
    // 若有人把实现抄回 characterAdapter，这个引用相等就会失败——
    // 两份拷贝迟早会在关键字覆盖上漂移，这正是本次问题的成因。
    expect(adapterModule.extractTextChunk).toBe(pngModule.extractTextChunk);
  });
});

describe('PNG 角色卡 · 真实导入链路 importCharacter', () => {
  it('PNG 卡经 importCharacter 落库后字段正确，头像回写为图片', async () => {
    const stores = await getStores();
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'PNG导入测试',
        description: '来自真实 PNG 卡',
        personality: '认真',
        first_mes: '你好',
      },
    };

    const file = await toPngFile(card);
    const created = await importCharacter(file, 'PNG导入测试.png');

    expect(created.name).toBe('PNG导入测试');
    expect(created.personality).toBe('认真');
    // ST v2 的 data 分支：头像应被回写成图片 DataURL
    expect(created.avatar.startsWith('data:image/png')).toBe(true);

    const stored = await stores.characters.get(created.id);
    expect(stored.name).toBe('PNG导入测试');
  });
});
