/**
 * 「自选窗口」相关用例
 * ---------------------------------------------------------------------------
 * 口径：自选 = 食堂的一个**窗口**（菜天天换），不是「我自己挑的菜」。
 * 覆盖：
 *   - 抽签页有独立的「今日自选窗口」专区：一个窗口一张卡，菜色列在卡里
 *   - 点图片打开灯箱看大图，可翻页、可关闭
 *   - 点「抽这一层」直接抽到该饭堂+楼层
 *   - 浏览页「自选窗口」页签 + 窗口详情（按日期分组，隔天仍可查）
 *   - 窗口照片渲染在窗口卡片上
 */
import { assert, createEnvironment, createSuite, loadJsdom, q, qa, tick, DOCS } from './harness.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const JSDOM = await loadJsdom();
if (!JSDOM) {
  console.log('⚠️  跳过：未安装 jsdom');
  process.exit(0);
}

const suite = createSuite();
const { window } = await createEnvironment(JSDOM, 'index.html');
const { dateKey, shiftDate } = await import(pathToFileURL(join(DOCS, 'assets/js/core/date.js')).href);
const TODAY = dateKey();
const YESTERDAY = shiftDate(TODAY, -1);

// 预置：可写数据源 + 一个自选窗口（今天 2 道菜 + 昨天 1 道）+ 窗口照片
window.localStorage.setItem('tsc:datasource', JSON.stringify({ mode: 'mock' }));
window.localStorage.setItem('tsc:mock:contributions', JSON.stringify([
  {
    id: 'win-1', kind: 'stall', author: '我', createdAt: `${TODAY}T03:00:00.000Z`,
    payload: {
      canteenId: 'ting_tao_yuan', floor: '1F', name: '风味套餐', windowType: '自选',
      note: '每天中午 11 点出菜', image: 'assets/uploads/win-1.jpg',
    },
  },
  ...[
    ['today-1', '炸鸡腿+鸡胗', '¥15', TODAY, true],
    ['today-2', '香菇滑鸡', '¥13', TODAY, true],
    ['old-1', '昨天的红烧肉', '¥12', YESTERDAY, false],
  ].map(([id, name, priceText, date, withImage]) => ({
    id, kind: 'dish', author: '我', createdAt: `${date}T04:00:00.000Z`,
    payload: {
      canteenId: 'ting_tao_yuan', floor: '1F', stallName: '风味套餐', name, priceText,
      cuisines: [], spicyLevel: 0, tags: [], reviewLabel: '好评', reviewText: null,
      image: withImage ? `assets/uploads/${id}.jpg` : null, date,
    },
  })),
]));

await import(pathToFileURL(join(DOCS, 'assets/js/app.js')).href);
await tick(160);

suite.section('自选窗口（窗口为主）');

await suite.test('抽签页有「今日自选窗口」专区：一个窗口一张卡，菜色列在卡里', () => {
  const section = q(window, '.today-section');
  assert.ok(section && !section.hidden, '缺少今日自选窗口专区');
  assert.ok(section.textContent.includes('今日自选窗口'), `标题不对：${section.textContent.slice(0, 40)}`);

  const cards = qa(window, '.today-section .stall-dish-card');
  assert.equal(cards.length, 1, `窗口卡片数量不对：${cards.length}`);
  const card = cards[0];
  assert.ok(card.textContent.includes('风味套餐'), '没显示窗口名');
  assert.ok(card.textContent.includes('自选窗口'), '没标出这是自选窗口');
  assert.ok(card.textContent.includes('听涛园') && card.textContent.includes('一层'), '没显示饭堂/楼层');
  assert.ok(card.textContent.includes('每天中午 11 点出菜'), '没显示窗口备注');

  const rows = qa(window, '.today-section .stall-dish-row');
  assert.equal(rows.length, 2, `窗口下应列出今天 2 道菜，实际 ${rows.length}`);
  assert.ok(card.textContent.includes('炸鸡腿+鸡胗') && card.textContent.includes('香菇滑鸡'), '菜名缺失');
  assert.match(card.textContent, /15\s*元/, '没显示价格');
});

await suite.test('昨天的菜不在「今日」专区（但没丢）', () => {
  assert.ok(!q(window, '.today-section').textContent.includes('昨天的红烧肉'), '今日专区不该出现昨天的菜');
});

await suite.test('点图片打开灯箱看大图，可翻页、可关闭', async () => {
  const rows = qa(window, '.today-section .stall-dish-row__thumb');
  assert.ok(rows.length >= 1, '菜色行里没有缩略图');
  rows[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);

  const box = q(window, '.lightbox');
  assert.ok(box, '点图片没有打开灯箱');
  assert.equal(q(window, '.lightbox__img').getAttribute('src'), 'assets/uploads/today-1.jpg');
  assert.ok(q(window, '.lightbox__title').textContent.includes('炸鸡腿+鸡胗'), '灯箱标题不对');
  assert.match(q(window, '.lightbox__counter').textContent, /^\d+ \/ \d+$/, '缺少张数指示');
  assert.ok(q(window, '.lightbox__nav--next'), '缺少下一张按钮');

  const before = q(window, '.lightbox__img').getAttribute('src');
  q(window, '.lightbox__nav--next').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(40);
  assert.notEqual(q(window, '.lightbox__img').getAttribute('src'), before, '翻页没生效');

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(260);
  assert.ok(!q(window, '.lightbox'), 'Esc 没有关闭灯箱');
  assert.ok(!window.document.body.classList.contains('is-locked'), '关闭后应恢复滚动');
});

await suite.test('窗口封面也能点开（灯箱显示窗口照片）', async () => {
  q(window, '.today-section .stall-dish-card__media img').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  assert.equal(q(window, '.lightbox__img').getAttribute('src'), 'assets/uploads/win-1.jpg');
  assert.ok(q(window, '.lightbox__title').textContent.includes('风味套餐'));
  q(window, '.lightbox__close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(240);
  assert.ok(!q(window, '.lightbox'), '关闭按钮没生效');
});

await suite.test('点「抽这一层」直接抽到这个饭堂+楼层', async () => {
  const button = qa(window, '.today-section .btn').find((node) => node.textContent.includes('抽这一层'));
  assert.ok(button, '缺少「抽这一层」按钮');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(160);
  const values = qa(window, '.targets .target .target__value').map((node) => node.textContent);
  assert.equal(values[0], '听涛园', `应抽到听涛园，实际 ${values[0]}`);
  assert.equal(values[1], '一层', `应抽到一层，实际 ${values[1]}`);
  assert.ok(q(window, '.push__name').textContent.trim().length > 0, '没有推送菜系');
});

await suite.test('浏览页「自选窗口」页签 → 窗口详情按日期分组', async () => {
  qa(window, '.tabbar__item').find((node) => node.textContent.includes('逛一逛'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  qa(window, '.segmented__item').find((node) => node.textContent.includes('自选窗口'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);

  const text = q(window, '.view--browse').textContent;
  assert.ok(text.includes('风味套餐'), '窗口没列出来');
  assert.ok(text.includes('共 3 道'), `窗口卡片没显示总数：${text.slice(0, 80)}`);

  qa(window, '.view--browse .btn').find((node) => node.textContent.includes('看全部日期'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  const detail = q(window, '.view--browse').textContent;
  assert.ok(detail.includes('今天') && detail.includes('昨天'), '窗口详情缺少日期分组');
  assert.ok(detail.includes('炸鸡腿+鸡胗') && detail.includes('昨天的红烧肉'), '窗口详情菜品不全');
  assert.equal(qa(window, '.view--browse .dish-card img.zoomable').length, 2, '两张有图的菜应渲染成可点图片');
});

await suite.test('饭堂详情里能看到窗口照片', async () => {
  qa(window, '.segmented__item').find((node) => node.textContent.includes('按饭堂'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  qa(window, '.canteen-card').find((node) => node.textContent.includes('听涛园'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  assert.ok(q(window, '.detail__title').textContent.includes('听涛园'));
  const stallImg = q(window, '.stall-section .stall-card__media img');
  assert.ok(stallImg, '窗口横滑卡片没有照片');
  assert.equal(stallImg.getAttribute('src'), 'assets/uploads/win-1.jpg');
  assert.ok(stallImg.classList.contains('zoomable'), '窗口照片也应可点开');
});

suite.finish();
