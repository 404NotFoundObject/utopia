/* 功能层冒烟：角色 / 群组 / 世界书 / 朋友圈 / 导入导出 / 会话，走真实 UI 与模块 API
 *
 * 用法：
 *   node tools/smoke-crud.mjs                       # 默认 http://127.0.0.1:8080/
 *   node tools/smoke-crud.mjs --url https://xxx     # 校验部署后的站点
 *
 * 说明：createCharacter 对未配置 API 的实例有门禁（设计如此），本脚本会先验证该门禁，
 *       再注入一份模拟 API 配置（拦截 /models 接口）以便走通完整表单路径。
 *
 * 退出码：0 = 全部通过；1 = 存在失败项或非外部噪声的控制台错误
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const URL = urlArg >= 0 && args[urlArg + 1] ? args[urlArg + 1] : 'http://127.0.0.1:8080/';
const results = [];
const errors = [];
const EXTERNAL = /cdnjs|jsdelivr|googleapis|gstatic|fonts\.|ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION)/i;

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !EXTERNAL.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

/**
 * 启动应用并就绪。冷启动偶尔会因浏览器资源争抢超出就绪等待，
 * 因此带有限次重试；连续失败才视为真实故障。
 */
async function boot(page, url, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => Boolean(window.__utopiaReady), null, { timeout: 60000 });
      return;
    } catch (e) {
      lastErr = e;
      console.log(`  启动第 ${i}/${tries} 次未就绪：${String(e.message).split('\n')[0]}，重试…`);
      await page.waitForTimeout(1500);
    }
  }
  throw lastErr;
}

await boot(page, URL);
await page.waitForTimeout(600);

// ---------- 0. 未配置 API 时的创建门禁（设计如此） ----------
const gate = await page.evaluate(async () => {
  const { createCharacter } = await import('/js/modules/character.js');
  const { getStores } = await import('/js/core/db.js');
  const stores = await getStores();
  const cur = (await stores.settings.get('app_settings')) || {};
  try {
    await createCharacter({ name: '门禁测试' });
    return { threw: false, hadKey: !!cur.apiKey };
  } catch (e) {
    return { threw: true, message: e.message, hadKey: !!cur.apiKey };
  }
});
check(
  '角色：未配置 API 时创建被拦下并提示',
  gate.hadKey ? true : gate.threw && /API/.test(gate.message || ''),
  JSON.stringify(gate)
);

// ---------- 准备：模拟「API 已配置」环境 ----------
// createCharacter 对未配置 API 的实例有门禁，冒烟需在已配置环境下走完整表单路径：
// 预置 apiKey 并拦截 models 接口，其余请求透传。
const seeded = await page.evaluate(async () => {
  const { getStores } = await import('/js/core/db.js');
  const stores = await getStores();
  const cur = (await stores.settings.get('app_settings')) || {};
  await stores.settings.update('app_settings', {
    ...cur,
    apiProvider: cur.apiProvider || 'openai',
    apiBaseUrl: cur.apiBaseUrl || 'https://api.openai.com/v1',
    apiKey: 'sk-smoke-test-key',
  });
  window.__origFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (/\/models(\?|$)/.test(String(url))) {
      return new Response(JSON.stringify({ data: [{ id: 'smoke-mock-model' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return window.__origFetch(url, opts);
  };
  const back = await stores.settings.get('app_settings');
  return { keySet: back?.apiKey === 'sk-smoke-test-key' };
});
check('准备：已注入可用的 API 配置（模拟）', seeded.keySet, JSON.stringify(seeded));

// ---------- 1. 角色：表单创建 → 编辑 → 列表 → 删除 ----------
const charFlow = await page.evaluate(async () => {
  const { renderCharacterForm } = await import('/js/ui/screens/characterFormUI.js');
  const { renderCharacterList } = await import('/js/ui/screens/characterListUI.js');
  const { getAppState } = await import('/js/core/state.js');
  const out = {};

  const baseCount = (getAppState().get('characters') || []).length;

  renderCharacterForm();
  await new Promise((r) => setTimeout(r, 500));
  document.getElementById('charNameInput').value = '冒烟新角色';
  document.getElementById('charDescInput').value = '由冒烟脚本创建';
  document.getElementById('submitCharBtn').click();
  await new Promise((r) => setTimeout(r, 1500));

  const chars = getAppState().get('characters') || [];
  out.created = chars.length === baseCount + 1;
  const created = chars.find((c) => c.name === '冒烟新角色');
  out.createdId = created?.id || null;

  if (created) {
    renderCharacterForm(created);
    await new Promise((r) => setTimeout(r, 500));
    document.getElementById('charNameInput').value = '冒烟改名后';
    document.getElementById('submitCharBtn').click();
    await new Promise((r) => setTimeout(r, 1200));
    out.renamed = (getAppState().get('characters') || []).some(
      (c) => c.id === created.id && c.name === '冒烟改名后'
    );
  }

  renderCharacterList();
  await new Promise((r) => setTimeout(r, 500));
  out.listRendered =
    document.querySelectorAll('#characterList .character-item:not(.group-item)').length >= 1;

  if (created) {
    const { deleteCharacter } = await import('/js/modules/character.js');
    await deleteCharacter(created.id);
    await new Promise((r) => setTimeout(r, 800));
    out.deleted = !(getAppState().get('characters') || []).some((c) => c.id === created.id);
  }
  out.finalCount = (getAppState().get('characters') || []).length;
  out.baseCount = baseCount;
  return out;
});
check('角色：表单创建成功', charFlow.created, JSON.stringify(charFlow));
check('角色：编辑改名成功', charFlow.renamed);
check('角色：列表渲染正常', charFlow.listRendered);
check('角色：删除生效', charFlow.deleted, `最终角色数 ${charFlow.finalCount}`);

// ---------- 2. 群组：创建 + 成员 + 列表 ----------
const groupFlow = await page.evaluate(async () => {
  const { createGroup, addGroupMember, getGroupsByUser, getGroupMembers, getGroup, disbandGroup } =
    await import('/js/modules/groupChat.js');
  const { createCharacter, deleteCharacter } = await import('/js/modules/character.js');
  const out = {};

  // 先造两个角色作为群成员（冒烟环境无需真实 API）
  const seeded = [];
  for (const name of ['群员甲', '群员乙']) {
    seeded.push(await createCharacter({ name, description: '冒烟群成员' }, { skipApiCheck: true }));
  }

  const g = await createGroup('冒烟群', 'user', '', '');
  out.groupId = g.id;
  out.ownerAdded = (await getGroupMembers(g.id)).some((m) => m.memberId === 'user');

  for (const c of seeded) await addGroupMember(g.id, c.id, 'character', 'member');
  const members = await getGroupMembers(g.id);
  out.expected = seeded.length + 1;
  out.memberCount = members.length;
  out.allCharsPresent = seeded.every((c) =>
    members.some((m) => m.memberId === c.id && m.memberType === 'character')
  );

  const groups = await getGroupsByUser('user');
  out.created = groups.some((x) => x.id === g.id);

  const back = await getGroup(g.id);
  out.name = back?.name;

  // 群列表 UI
  try {
    const { getAppState } = await import('/js/core/state.js');
    getAppState().set('currentGroupId', g.id);
    const { renderGroupList } = await import('/js/ui/screens/groupListUI.js');
    await renderGroupList();
    await new Promise((r) => setTimeout(r, 600));
    out.listRendered = document.querySelectorAll('#characterList .group-item').length >= 1;
  } catch (e) {
    out.listRendered = 'ERR: ' + e.message;
  }

  // 清理：解散测试群 + 删除测试角色
  try {
    await disbandGroup(g.id);
    out.disbanded = !(await getGroupsByUser('user')).some((x) => x.id === g.id);
    for (const c of seeded) await deleteCharacter(c.id);
    out.cleanup = true;
  } catch (e) {
    out.disbanded = 'ERR: ' + e.message;
  }
  return out;
});
check('群组：创建成功并可查回', groupFlow.created && groupFlow.name === '冒烟群', JSON.stringify(groupFlow));
check('群组：创建者自动入群', groupFlow.ownerAdded);
check('群组：成员添加正确', groupFlow.memberCount === groupFlow.expected && groupFlow.allCharsPresent && groupFlow.expected >= 3,
  `预期 ${groupFlow.expected} 实际 ${groupFlow.memberCount}`);
check('群组：群列表渲染', groupFlow.listRendered === true, String(groupFlow.listRendered));
check('群组：解散生效', groupFlow.disbanded === true, String(groupFlow.disbanded));

// ---------- 3. 世界书：分组 + 规则 CRUD ----------
const wbFlow = await page.evaluate(async () => {
  const wb = await import('/js/modules/worldbook.js');
  const out = {};

  const group = await wb.addGroup({ name: '冒烟组', enabled: true });
  out.groupCreated = !!(await wb.getGroup(group.id));
  out.groupListed = (await wb.getAllGroups()).some((g) => g.id === group.id);

  const rule = await wb.addRule({
    name: '冒烟规则',
    content: '这是一条冒烟规则',
    enabled: true,
    scope: 'global',
  });
  out.ruleCreated = !!(await wb.getRule(rule.id));

  await wb.addRuleToGroup(group.id, rule.id);
  out.associated = (await wb.getRulesByGroup(group.id)).some((r) => r.id === rule.id);
  out.groupIdSynced = (await wb.getRule(rule.id))?.groupId === group.id;

  await wb.updateRule(rule.id, { content: '内容已更新' });
  out.updated = (await wb.getRule(rule.id))?.content === '内容已更新';

  const before = (await wb.getRule(rule.id))?.enabled;
  await wb.toggleRule(rule.id);
  const after = (await wb.getRule(rule.id))?.enabled;
  out.toggled = before !== after;

  out.enabledListed = Array.isArray(await wb.getEnabledRules());
  out.ruleCount = (await wb.getAllRules()).length;

  await wb.deleteRule(rule.id);
  out.deleted = !(await wb.getRule(rule.id));

  await wb.deleteGroup(group.id);
  out.groupDeleted = !(await wb.getGroup(group.id));
  return out;
});
check('世界书：分组创建与列表', wbFlow.groupCreated && wbFlow.groupListed, JSON.stringify(wbFlow));
check('世界书：规则创建', wbFlow.ruleCreated);
check('世界书：规则加入分组并回读', wbFlow.associated && wbFlow.groupIdSynced);
check('世界书：规则更新', wbFlow.updated);
check('世界书：规则开关切换', wbFlow.toggled);
check('世界书：启用规则列表可读', wbFlow.enabledListed);
check('世界书：规则删除', wbFlow.deleted);
check('世界书：分组删除', wbFlow.groupDeleted);

// ---------- 4. 朋友圈：发布 / 评论 / 删除 + UI ----------
const socialFlow = await page.evaluate(async () => {
  const s = await import('/js/modules/social.js');
  const user = { id: 'user', name: '我', avatar: '' };
  const post = await s.publishPostByUser(user, '冒烟动态内容');
  const all = await s.getAllPosts();
  const created = all.some((p) => p.id === post.id);

  let commented = false;
  let comments = 0;
  try {
    await s.userCommentPost(post.id, '冒烟评论');
    const p2 = (await s.getAllPosts()).find((p) => p.id === post.id);
    comments = (p2?.comments || []).length;
    commented = comments >= 1;
  } catch (e) {
    commented = 'ERR: ' + e.message;
  }

  await s.deletePost(post.id);
  const afterDelete = await s.getAllPosts();
  return { created, commented, comments, deleted: !afterDelete.some((p) => p.id === post.id) };
});
check('朋友圈：发布成功', socialFlow.created, JSON.stringify(socialFlow));
check('朋友圈：评论成功', socialFlow.commented === true, `评论数 ${socialFlow.comments}`);
check('朋友圈：删除成功', socialFlow.deleted);

const socialUi = await page.evaluate(async () => {
  document.getElementById('socialBtn').click();
  await new Promise((r) => setTimeout(r, 1200));
  const feed = document.querySelector('.social-feed');
  const posts = document.querySelectorAll('.social-post').length;
  const ok = !!feed && feed.innerHTML.length > 50;
  const { closeModal } = await import('/js/ui/components/modal.js');
  closeModal();
  await new Promise((r) => setTimeout(r, 400));
  return { ok, len: feed ? feed.innerHTML.length : 0, posts };
});
check('朋友圈：界面可渲染', socialUi.ok, `内容长度 ${socialUi.len}，动态卡 ${socialUi.posts}`);

// ---------- 5. 导入 / 导出 ----------
const importFlow = await page.evaluate(async () => {
  const { renderImportModal } = await import('/js/ui/screens/importUI.js');
  renderImportModal();
  await new Promise((r) => setTimeout(r, 600));
  const input = document.getElementById('importFileInput');
  const btn = document.getElementById('doImportBtn');
  const hasInput = !!input && !!btn;

  const card = {
    name: '导入冒烟角色',
    description: '来自 JSON 卡',
    personality: '平静',
    first_mes: '你好',
    data: { name: '导入冒烟角色', description: '来自 JSON 卡' },
    spec: 'chara_card_v2',
    spec_version: '2.0',
  };
  const file = new File([JSON.stringify(card)], 'char.json', { type: 'application/json' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const fileNameShown = document.getElementById('importFileName')?.textContent || '';
  btn.click();
  await new Promise((r) => setTimeout(r, 2000));
  const { getAppState } = await import('/js/core/state.js');
  const imported = (getAppState().get('characters') || []).some((c) => c.name === '导入冒烟角色');
  const { closeModal } = await import('/js/ui/components/modal.js');
  await closeModal();
  await new Promise((r) => setTimeout(r, 300));
  return { hasInput, fileNameShown, imported };
});
check('导入：文件选择与导入按钮可用', importFlow.hasInput, JSON.stringify(importFlow));
check('导入：文件名回显', String(importFlow.fileNameShown).includes('char.json'), importFlow.fileNameShown);
check('导入：角色卡导入成功', importFlow.imported);

const exportFlow = await page.evaluate(async () => {
  const { getAppState } = await import('/js/core/state.js');
  const chars = getAppState().get('characters') || [];
  if (!chars.length) return { ok: false, len: 0, reason: '无角色可导出' };
  const m = await import('/js/ui/screens/characterExportUI.js');
  const { closeModal } = await import('/js/ui/components/modal.js');
  m.openPNGExport(chars[0]);
  await new Promise((r) => setTimeout(r, 1000));
  const len = document.getElementById('modalContent')?.innerHTML.length || 0;
  await closeModal();
  await new Promise((r) => setTimeout(r, 300));
  return { len, ok: len > 100 };
});
check('导出：PNG 导出界面可打开', exportFlow.ok, `内容长度 ${exportFlow.len}`);

// ---------- 6. 会话与上下文 ----------
const convFlow = await page.evaluate(async () => {
  const { getAppState } = await import('/js/core/state.js');
  const convMod = await import('/js/modules/conversation.js');
  const st = getAppState();
  const chars = st.get('characters') || [];
  if (!chars.length) return { skipped: true };
  st.set('currentCharacterId', chars[0].id);

  const conv = await convMod.ensureConversation(chars[0].id);
  const before = (conv?.messages || []).length;
  const loaded = await convMod.getCurrentConversation();

  let cleared = null;
  try {
    await convMod.clearConversation(conv.id);
    cleared = true;
  } catch (e) {
    cleared = 'ERR: ' + e.message;
  }
  const afterClear = await convMod.getCurrentConversation();
  return {
    convId: conv?.id,
    hasConvModule: !!conv,
    messageCountBefore: before,
    currentMatched: loaded?.id === conv?.id,
    cleared,
    afterCount: (afterClear?.messages || []).length,
  };
});
check('会话：ensureConversation 可用', convFlow.hasConvModule, JSON.stringify(convFlow));
check('会话：当前会话可读', convFlow.currentMatched === true);
check('会话：清空后消息归零', convFlow.cleared === true && convFlow.afterCount === 0,
  `清空前 ${convFlow.messageCountBefore} 条，清空后 ${convFlow.afterCount} 条`);

// ---------- 7. 多轮重复开关各面板（稳定性） ----------
const repeatFlow = await page.evaluate(async () => {
  const { closeModal } = await import('/js/ui/components/modal.js');
  const seq = ['worldbookBtn', 'pluginBtn', 'settingsBtn', 'socialBtn'];
  const ok = [];
  for (let round = 0; round < 2; round++) {
    for (const id of seq) {
      document.getElementById(id).click();
      await new Promise((r) => setTimeout(r, 600));
      const len = document.getElementById('modalContent')?.innerHTML.length || 0;
      ok.push(`${id}:${len > 20 ? 'ok' : '空'}`);
      await closeModal();
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  return ok;
});
check('多轮重复开关各面板稳定', repeatFlow.every((r) => r.endsWith('ok')), repeatFlow.join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log('\n================ 功能层冒烟 ================');
for (const r of results) console.log(`${r.ok ? '  ✔' : '  ✘'} ${r.name}${r.detail ? `  ${r.detail}` : ''}`);
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
const real = [...new Set(errors.filter((e) => !EXTERNAL.test(e)))];
console.log(`\n控制台错误 ${real.length} 条：`);
for (const e of real.slice(0, 20)) console.log('   ! ' + e.slice(0, 200));
process.exit(failed.length || real.length ? 1 : 0);
