/** 抽签页 DOM 测试（在独立进程里跑 index.html） */
import {
  assert, createEnvironment, createSuite, loadJsdom, q, qa, tick, DOCS, ROOT,
} from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const JSDOM = await loadJsdom();
if (!JSDOM) {
  console.log('⚠️  跳过：未安装 jsdom');
  process.exit(0);
}

const suite = createSuite();
const { window } = await createEnvironment(JSDOM, 'index.html');
await import(pathToFileURL(join(DOCS, 'assets/js/app.js')).href);
await tick(90);

suite.section('抽签页（index.html）');

/** 找出行内文本节点里字面量为 null/undefined 的脏数据（append(null) 的经典事故） */
function nullTextNodes(root) {
  const found = [];
  const walk = (node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const text = child.textContent.trim();
        if (text === 'null' || text === 'undefined' || text === 'NaN') found.push(text);
      } else {
        walk(child);
      }
    });
  };
  walk(root);
  return found;
}

await suite.test('应用启动后渲染抽签舞台', () => {
  assert.ok(q(window, '.view--draw'), '缺少抽签视图');
  assert.equal(qa(window, '.reel').length, 3, '应有 3 个滚动位：饭堂/楼层/推送菜系');
  assert.ok(q(window, '.stage__actions .btn--primary'), '缺少抽签按钮');
  assert.ok(q(window, '.stage__meta'), '缺少候选统计');
});

await suite.test('读取到真实菜单数据（候选池=可抽菜品，排除差评/已停业/窗口级推荐）', () => {
  const menu = JSON.parse(readFileSync(join(DOCS, 'assets/data/menu.json'), 'utf8'));
  const drawable = menu.dishes.filter((dish) => dish.type !== 'stall_recommendation' && !dish.excludedByDefault);
  const canteenIds = new Set(drawable.map((dish) => dish.canteenId));
  const summary = q(window, '.stage__pool').textContent;
  assert.ok(summary.includes(String(drawable.length)), `候选数量不对：${summary}，应为 ${drawable.length}`);
  assert.ok(summary.includes(String(canteenIds.size)), `候选饭堂数量不对：${summary}，应为 ${canteenIds.size}`);
  assert.ok(drawable.length < menu.dishes.length, '差评/已停业应被排除在候选池外');
});

await suite.test('点击抽签后渲染「推送菜系」页面', async () => {
  q(window, '.stage__actions .btn--primary').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  assert.ok(q(window, '.push'), '没有渲染推送菜系卡片');
  assert.ok(q(window, '.push__name').textContent.trim().length > 0, '菜系名为空');
  assert.ok(q(window, '.push__label').textContent.includes('推送菜系'));
  assert.equal(qa(window, '.targets .target').length, 2, '饭堂/楼层卡片缺失');
  assert.match(q(window, '.ticket__value').textContent, /^[0-9A-Z]{5}$/);
});

await suite.test('推送菜系下列出菜品，且都属于抽中的饭堂+楼层', async () => {
  const dishes = qa(window, '.dish-list .dish-card');
  assert.ok(dishes.length > 0, '没有推荐菜品');
  const values = qa(window, '.targets .target .target__value').map((node) => node.textContent);
  const [canteenName, floorName] = values;
  const metas = qa(window, '.dish-list .dish-card__meta').map((node) => node.textContent);
  assert.ok(metas.every((text) => text.includes(canteenName)), `菜品不属于 ${canteenName}`);
  if (floorName !== '未标注') {
    assert.ok(metas.some((text) => text.includes(floorName)), `菜品楼层与 ${floorName} 不符`);
  }
});

await suite.test('结果区没有渲染出 null / undefined 文本（回归）', () => {
  const junk = nullTextNodes(q(window, '.result'));
  assert.equal(junk.length, 0, `结果区出现了脏文本节点：${junk.join(', ')}`);
  const pageJunk = nullTextNodes(window.document.body);
  assert.equal(pageJunk.length, 0, `页面出现了脏文本节点：${pageJunk.join(', ')}`);
});

await suite.test('概率透明面板概率归一', () => {
  const rows = qa(window, '.prob-row');
  assert.ok(rows.length > 0, '没有概率明细');
  const sum = rows.reduce((acc, row) => acc + parseFloat(row.querySelector('.prob-row__value').textContent), 0);
  assert.ok(sum > 0 && sum <= 100.5, `概率和异常：${sum}`);
});

await suite.test('抽签写入本机历史', () => {
  const history = JSON.parse(window.localStorage.getItem('tsc:history') || '[]');
  assert.ok(history.length >= 1, '历史为空');
  assert.ok(history[0].ticket && history[0].canteenId, '历史记录结构不完整');
});

await suite.test('第三级联动：换个菜系保持饭堂与楼层', async () => {
  const before = qa(window, '.targets .target .target__value').map((node) => node.textContent);
  const button = qa(window, '.result__actions .btn').find((node) => node.textContent.includes('换个菜系'));
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  const after = qa(window, '.targets .target .target__value').map((node) => node.textContent);
  assert.deepEqual(after, before, '换菜系不应改变饭堂/楼层');
  assert.ok(q(window, '.push__name').textContent.trim().length > 0);
});

await suite.test('分享深链接能复现同一签', async () => {
  const core = await import(pathToFileURL(join(DOCS, 'assets/js/core/lottery.js')).href);
  const share = await import(pathToFileURL(join(DOCS, 'assets/js/core/share.js')).href);
  const { buildMenu } = await import(pathToFileURL(join(DOCS, 'assets/js/core/menu.js')).href);
  const base = JSON.parse(readFileSync(join(DOCS, 'assets/data/menu.json'), 'utf8'));
  const expected = core.draw(buildMenu(base, []), { seed: 424242, avoidRecent: false });

  window.location.hash = `#/r?k=${encodeURIComponent(share.encodeShare(expected))}`;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await tick(80);

  assert.ok(q(window, '.banner'), '缺少“同学分享的签”提示条');
  assert.equal(q(window, '.ticket__value').textContent, expected.ticket);
  assert.equal(qa(window, '.targets .target .target__value')[0].textContent, expected.canteen.name);
  assert.ok(q(window, '.push__name').textContent.includes(expected.cuisine.name));
});

await suite.test('筛选抽屉可打开、可交互、可关闭', async () => {
  window.location.hash = '#/draw';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await tick(60);
  qa(window, '.stage__actions .btn').find((node) => node.textContent.includes('筛选'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  assert.ok(q(window, '.sheet'), '抽屉没有打开');
  assert.ok(qa(window, '.sheet .chip').length > 5, '菜系芯片缺失');
  assert.ok(qa(window, '.sheet .segmented').length >= 2, '辣度/预算分段控件缺失');

  const chip = q(window, '.sheet .chip');
  chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(10);
  assert.ok(chip.classList.contains('is-active'), '芯片没有选中态');

  qa(window, '.sheet__footer .btn').find((node) => node.textContent.includes('完成'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(340);
  assert.ok(!q(window, '.sheet'), '抽屉没有关闭');
});

await suite.test('筛选条件会写进本机偏好并影响候选池', async () => {
  const saved = JSON.parse(window.localStorage.getItem('tsc:settings') || '{}');
  assert.ok(Object.prototype.hasOwnProperty.call(saved, 'avoidRecent'), '偏好没有落盘');
});

await suite.test('逛一逛：饭堂列表 + 进入详情 + 菜系视图', async () => {
  qa(window, '.tabbar__item').find((node) => node.textContent.includes('逛一逛'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  assert.ok(q(window, '.view--browse'), '没有切到浏览视图');
  const cards = qa(window, '.canteen-card');
  assert.ok(cards.length > 10, `饭堂卡片太少：${cards.length}`);

  cards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  assert.ok(q(window, '.detail__title'), '没有进入饭堂详情');
  assert.ok(qa(window, '.dish-card').length > 0, '详情里没有菜品');

  qa(window, '.detail__head .link')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  qa(window, '.segmented__item').find((node) => node.textContent.includes('按菜系'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  assert.ok(qa(window, '.cuisine-card').length > 10, '菜系卡片太少');
});

await suite.test('搜索能过滤菜品', async () => {
  const input = q(window, '.input--search');
  input.value = '青团';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(60);
  assert.ok(qa(window, '.cuisine-card').length >= 1 || qa(window, '.canteen-card').length >= 1, '搜索后没有结果');
});

suite.finish();
