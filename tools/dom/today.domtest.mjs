/**
 * 「上传的菜找得到、图片能显示」用例
 * ---------------------------------------------------------------------------
 * 复刻真实场景：往 mock 数据源里放一条「今天上传的自选菜」+ 一个带照片的窗口，
 * 然后打开抽签页与浏览页，确认：
 *   - 抽签页有独立的「今日自选」专区，大图 + 饭堂/楼层/窗口 + 价格
 *   - 点「抽这一层」会抽到这个饭堂+楼层
 *   - 浏览页「上传的菜」页签按日期列出，隔天也还找得到
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

// 预置：可写数据源 + 一条今天的自选菜（带图）+ 一条昨天的 + 一个带照片的窗口
window.localStorage.setItem('tsc:datasource', JSON.stringify({ mode: 'mock' }));
window.localStorage.setItem('tsc:mock:contributions', JSON.stringify([
  {
    id: 'today-1', kind: 'dish', author: '我', createdAt: `${TODAY}T04:00:00.000Z`,
    payload: {
      canteenId: 'ting_tao_yuan', floor: '1F', stallName: '风味套餐', name: '炸鸡腿+鸡胗',
      priceText: '¥15', cuisines: [], spicyLevel: 0, tags: [], reviewLabel: '好评',
      reviewText: null, image: 'assets/uploads/today-1.jpg', date: TODAY,
    },
  },
  {
    id: 'old-1', kind: 'dish', author: '我', createdAt: `${shiftDate(TODAY, -1)}T04:00:00.000Z`,
    payload: {
      canteenId: 'ting_tao_yuan', floor: '1F', stallName: '风味套餐', name: '昨天的红烧肉',
      priceText: '¥12', cuisines: [], spicyLevel: 0, tags: [], reviewLabel: '好评',
      reviewText: null, image: 'assets/uploads/old-1.jpg', date: shiftDate(TODAY, -1),
    },
  },
  {
    id: 'win-1', kind: 'stall', author: '我', createdAt: `${TODAY}T03:00:00.000Z`,
    payload: { canteenId: 'ting_tao_yuan', floor: '1F', name: '风味套餐', windowType: '自选', image: 'assets/uploads/win-1.jpg' },
  },
]));

await import(pathToFileURL(join(DOCS, 'assets/js/app.js')).href);
await tick(150);

suite.section('上传的菜找得到 / 图片能显示');

await suite.test('抽签页有独立的「今日自选」专区（不用抽签就能看到）', () => {
  const section = q(window, '.today-section');
  assert.ok(section && !section.hidden, '缺少今日自选专区');
  assert.ok(section.textContent.includes('今日自选'), '专区标题不对');
  const cards = qa(window, '.today-section .today-card');
  assert.equal(cards.length, 1, `今日卡片数量不对：${cards.length}`);
  assert.ok(cards[0].textContent.includes('炸鸡腿+鸡胗'), '没显示菜名');
  assert.match(cards[0].textContent, /15\s*元|¥15/, '没显示价格');
  assert.ok(cards[0].textContent.includes('听涛园'), '没显示饭堂');
  assert.ok(cards[0].textContent.includes('一层'), '没显示楼层');
  assert.ok(cards[0].textContent.includes('风味套餐'), '没显示窗口');
});

await suite.test('图片以 <img> 真渲染出来（大图卡片）', () => {
  const img = q(window, '.today-section .today-card__media img');
  assert.ok(img, '今日自选卡片里没有图片');
  assert.equal(img.getAttribute('src'), 'assets/uploads/today-1.jpg');
  const box = q(window, '.today-section .today-card__media');
  assert.ok(box, '缺少图片容器');
});

await suite.test('昨天的菜不在「今日」专区（但没丢）', () => {
  assert.ok(!q(window, '.today-section').textContent.includes('昨天的红烧肉'), '今日专区不该出现昨天的菜');
});

await suite.test('点「抽这一层」直接抽到这个饭堂+楼层', async () => {
  const button = qa(window, '.today-section .btn').find((node) => node.textContent.includes('抽这一层'));
  assert.ok(button, '缺少「抽这一层」按钮');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(150);
  const values = qa(window, '.targets .target .target__value').map((node) => node.textContent);
  assert.equal(values[0], '听涛园', `应抽到听涛园，实际 ${values[0]}`);
  assert.equal(values[1], '一层', `应抽到一层，实际 ${values[1]}`);
  assert.ok(q(window, '.push__name').textContent.trim().length > 0, '没有推送菜系');
});

await suite.test('浏览页「上传的菜」页签：今天的 + 昨天的都能找到', async () => {
  qa(window, '.tabbar__item').find((node) => node.textContent.includes('逛一逛'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  qa(window, '.segmented__item').find((node) => node.textContent.includes('上传的菜'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);

  const text = q(window, '.view--browse').textContent;
  assert.ok(text.includes('炸鸡腿+鸡胗'), '今天的菜没列出来');
  assert.ok(text.includes('昨天的红烧肉'), '昨天的菜应仍可查（带日期分组）');
  assert.ok(text.includes('今天') && text.includes('昨天'), '缺少日期分组标题');
  assert.equal(qa(window, '.view--browse .today-card img').length, 2, '两张上传的图片都应渲染');
});

await suite.test('饭堂详情里能看到窗口照片', async () => {
  qa(window, '.segmented__item').find((node) => node.textContent.includes('按饭堂'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  const card = qa(window, '.canteen-card').find((node) => node.textContent.includes('听涛园'));
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  const stallImg = q(window, '.stall-section .stall-card__media img');
  assert.ok(stallImg, '窗口卡片没有照片');
  assert.equal(stallImg.getAttribute('src'), 'assets/uploads/win-1.jpg');
  assert.ok(q(window, '.detail__title').textContent.includes('听涛园'));
});

suite.finish();
