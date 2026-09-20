/**
 * 前端 core 层测试（Node 直接跑，不需要浏览器）
 * ---------------------------------------------------------------------------
 * 运行： node tools/test_site_core.mjs
 * 只用内置能力：node:assert + node:fs，无第三方依赖。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildMenu, validateContribution, filterDishes, auditMenu, parsePriceText, stallsOf,
} from '../docs/assets/js/core/menu.js';
import { draw, preview, redrawCuisine, plan, resolveSeed } from '../docs/assets/js/core/lottery.js';
import { dateKey, daysAgo, shiftDate } from '../docs/assets/js/core/date.js';
import { encodeShare, decodeShare, optionsFromHash, buildShareText } from '../docs/assets/js/core/share.js';
import { createRng, hashSeed, pickWeightedMany, poolWeights, ticketOf } from '../docs/assets/js/core/rng.js';
import { uploadPathFor } from '../docs/assets/js/data/contract.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = JSON.parse(readFileSync(join(ROOT, 'docs/assets/data/menu.json'), 'utf8'));

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}\n      ${error.message.split('\n')[0]}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------ rng 基础 */
section('rng');
test('hashSeed 稳定且为 uint32', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.ok(hashSeed('abc') >= 0 && hashSeed('abc') <= 0xffffffff);
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
});
test('createRng 可复现且分布大致均匀', () => {
  const a = createRng(123);
  const b = createRng(123);
  const values = Array.from({ length: 1000 }, () => a());
  values.forEach((v, i) => assert.equal(v, b()));
  assert.ok(values.every((v) => v >= 0 && v < 1));
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05, `mean=${mean}`);
});
test('ticketOf 生成 5 位签号', () => {
  assert.match(ticketOf(123456), /^[0-9A-Z]{5}$/);
});
test('pickWeightedMany 不放回且按权重排序', () => {
  const items = [{ id: 'a', w: 10 }, { id: 'b', w: 1 }, { id: 'c', w: 1 }, { id: 'd', w: 0.1 }];
  const picked = pickWeightedMany(items, createRng(7), (x) => x.w, 3);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked.map((x) => x.id)).size, 3, '不应重复');
});
test('poolWeights 概率和为 1', () => {
  const { rows } = poolWeights([{ w: 1 }, { w: 3 }], (x) => x.w);
  assert.equal(rows.reduce((s, r) => s + r.probability, 0).toFixed(10), '1.0000000000');
});

/* --------------------------------------------------------- 数据装配层 */
section('menu 装配');
const menu = buildMenu(base, []);
test('合成基础菜单', () => {
  assert.equal(menu.dishes.length, base.dishes.length);
  assert.equal(menu.canteens.length, base.canteens.length);
  assert.equal(menu.cuisines.length, base.taxonomy.cuisines.length);
});
test('auditMenu 无问题', () => {
  const audit = auditMenu(menu);
  assert.ok(audit.ok, audit.problems.join('; '));
});
test('索引覆盖所有菜品', () => {
  const indexed = Object.values(menu.indexes.byCanteen).flat();
  assert.equal(indexed.length, menu.dishes.length);
});
test('parsePriceText 处理各种徽章', () => {
  assert.deepEqual(
    [parsePriceText('¥20-30').min, parsePriceText('¥20-30').max],
    [20, 30],
  );
  assert.equal(parsePriceText('¥20+，因为是自选').openEnded, true);
  assert.equal(parsePriceText('¥10元以下').min, null);
  assert.equal(parsePriceText('¥10元以下').max, 10);
  assert.equal(parsePriceText('大概6r?').uncertain, true);
  assert.equal(parsePriceText('小碗8 大碗10').note, '小碗 / 大碗');
});

/* ------------------------------------------------------------- 抽签 */
section('抽签');
test('同种子结果完全一致（可复现）', () => {
  const a = draw(menu, { seed: 20260920, avoidRecent: false });
  const b = draw(menu, { seed: 20260920, avoidRecent: false });
  assert.equal(a.ticket, b.ticket);
  assert.equal(a.canteen.id, b.canteen.id);
  assert.equal(a.floor, b.floor);
  assert.equal(a.cuisine?.id, b.cuisine?.id);
  assert.deepEqual(a.dishes.map((d) => d.id), b.dishes.map((d) => d.id));
});
test('结果包含饭堂 + 楼层 + 推送菜系 + 菜品', () => {
  const r = draw(menu, { seed: 5, avoidRecent: false });
  assert.ok(r.ok);
  assert.ok(r.canteen?.name);
  assert.ok(r.cuisine?.name);
  assert.ok(r.dishes.length > 0);
  assert.ok(r.dishes.every((d) => d.cuisines.includes(r.cuisine.id)));
});
test('推送菜系下的菜都属于抽中的饭堂+楼层', () => {
  for (let seed = 0; seed < 40; seed += 1) {
    const r = draw(menu, { seed, avoidRecent: false });
    assert.ok(r.dishes.every((d) => d.canteenId === r.canteen.id), `seed=${seed} 菜品饭堂不一致`);
    if (r.floor) assert.ok(r.dishes.every((d) => d.floor === r.floor), `seed=${seed} 菜品楼层不一致`);
  }
});
test('拒绝窗口级推荐进池', () => {
  const r = draw(menu, { seed: 11, avoidRecent: false });
  assert.ok(r.dishes.every((d) => d.type !== 'stall_recommendation'));
});
test('概率权重归一化', () => {
  const r = draw(menu, { seed: 3, avoidRecent: false });
  for (const key of ['canteens', 'floors', 'cuisines']) {
    const sum = r.weights[key].reduce((s, x) => s + x.probability, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${key} 概率和 ${sum}`);
  }
});
test('不同种子会抽到不同结果（分布合理）', () => {
  const canteens = new Set();
  const cuisines = new Set();
  for (let seed = 0; seed < 200; seed += 1) {
    const r = draw(menu, { seed, avoidRecent: false });
    canteens.add(r.canteen.id);
    cuisines.add(r.cuisine?.id);
  }
  assert.ok(canteens.size >= 10, `只抽到 ${canteens.size} 个饭堂`);
  assert.ok(cuisines.size >= 8, `只抽到 ${cuisines.size} 个菜系`);
});
test('辣度 / 预算筛选生效', () => {
  for (let seed = 0; seed < 60; seed += 1) {
    const r = draw(menu, { seed, maxSpicyLevel: 0, maxPrice: 20, avoidRecent: false });
    if (!r.ok) continue;
    assert.ok(r.dishes.every((d) => d.spicyLevel === 0), '辣度越界');
    assert.ok(r.dishes.every((d) => d.price?.min == null || d.price.min <= 20), '预算越界');
  }
});
test('指定菜系时只会推送该菜系', () => {
  for (let seed = 0; seed < 30; seed += 1) {
    const r = draw(menu, { seed, cuisines: ['sichuan', 'hotpot'], avoidRecent: false });
    if (!r.ok) continue;
    assert.ok(['sichuan', 'hotpot'].includes(r.cuisine.id));
  }
});
test('冷却：最近吃过的不再出现', () => {
  const first = draw(menu, { seed: 99, avoidRecent: false });
  const eaten = first.dishes.map((d) => d.id);
  const second = draw(menu, { seed: 99, avoidRecent: true, recentDishIds: eaten });
  if (second.ok) {
    assert.ok(second.dishes.every((d) => !eaten.includes(d.id)), '冷却失效');
  }
});
test('整个池子都被冷却时自动放宽并给出提示', () => {
  const all = menu.dishes.filter((d) => d.type !== 'stall_recommendation' && !d.excludedByDefault).map((d) => d.id);
  const r = draw(menu, { seed: 1, avoidRecent: true, recentDishIds: all });
  assert.ok(r.ok);
  assert.ok(r.warnings.some((w) => w.includes('放宽冷却')));
});
test('空池给出可操作的提示而不是报错', () => {
  const r = draw(menu, { seed: 1, keyword: '不存在的菜名xyz' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty_pool');
  assert.ok(r.hint.length > 0);
});
test('饭堂均衡：连续抽签不会一直同一个饭堂', () => {
  const recentCanteenIds = [];
  const sequence = [];
  for (let i = 0; i < 12; i += 1) {
    const r = draw(menu, { seed: 1000 + i, recentCanteenIds: recentCanteenIds.slice(-5), avoidRecent: false });
    sequence.push(r.canteen.id);
    recentCanteenIds.push(r.canteen.id);
  }
  assert.ok(new Set(sequence).size >= 5, `12 次只出现 ${new Set(sequence).size} 个饭堂`);
});
test('经验频率贴近理论概率（公平性抽查）', () => {
  const p = preview(menu, { avoidRecent: false }, { now: 0 });
  const predicted = new Map(p.canteenWeights.map((row) => [row.canteenId, row.probability]));
  const counts = new Map();
  const runs = 3000;
  for (let seed = 0; seed < runs; seed += 1) {
    const r = draw(menu, { seed, avoidRecent: false });
    counts.set(r.canteen.id, (counts.get(r.canteen.id) || 0) + 1);
  }
  for (const [id, probability] of predicted) {
    const observed = (counts.get(id) || 0) / runs;
    const tolerance = Math.max(0.015, probability * 0.35);
    assert.ok(Math.abs(observed - probability) < tolerance,
      `${id}: 理论 ${probability.toFixed(3)} vs 实测 ${observed.toFixed(3)}`);
  }
});
test('换个菜系：饭堂与楼层不变（含「楼层未标注」的情况）', () => {
  let checkedNullFloor = false;
  for (let seed = 0; seed < 30; seed += 1) {
    const first = draw(menu, { seed, avoidRecent: false });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const next = redrawCuisine(menu, first, { avoidRecent: false });
      assert.equal(next.canteen.id, first.canteen.id, `seed=${seed} 饭堂被改动`);
      assert.equal(next.floor, first.floor, `seed=${seed} 楼层被改动：${first.floor} -> ${next.floor}`);
      assert.ok(next.dishes.length > 0, '换菜系后没有菜');
      assert.ok(next.dishes.every((d) => d.floor === first.floor || !first.floor), '换菜系后菜品楼层不一致');
    }
    if (first.floor === null) checkedNullFloor = true;
  }
  assert.ok(checkedNullFloor, '样本里没有覆盖到「楼层未标注」的情况');
});
test('daily 种子：按本地日期，同一天稳定、跨天变化', () => {
  // 用本地时间构造：早上 9 点与晚上 21 点必须是同一天
  const morning = new Date(2026, 8, 20, 9, 0, 0).getTime();
  const evening = new Date(2026, 8, 20, 21, 0, 0).getTime();
  const nextDay = new Date(2026, 8, 21, 9, 0, 0).getTime();

  const day1 = resolveSeed({ daily: true }, morning);
  const day1b = resolveSeed({ daily: true }, evening);
  const day2 = resolveSeed({ daily: true }, nextDay);

  assert.equal(day1.seed, day1b.seed, '本地同一天应得到同一个签');
  assert.notEqual(day1.seed, day2.seed, '跨天应换签');
  assert.equal(day1.dateKey, dateKey(morning), 'dateKey 应为本地日期');
});
test('plan 不消费随机数（预览可重复计算）', () => {
  const a = plan(menu, { seed: 1, avoidRecent: false });
  const b = plan(menu, { seed: 1, avoidRecent: false });
  assert.equal(a.pool.length, b.pool.length);
  assert.deepEqual(a.canteenWeights, b.canteenWeights);
});

/* ------------------------------------------------------------- 分享 */
section('分享码 / 深链接');
test('分享码可往返', () => {
  const r = draw(menu, { seed: 123456, maxSpicyLevel: 2, maxPrice: 25, cuisines: ['sichuan'], avoidRecent: false });
  const code = encodeShare(r);
  assert.match(code, /^v1\./);
  const decoded = decodeShare(code);
  assert.equal(decoded.seed, r.seed);
  assert.deepEqual(decoded.cuisines, ['sichuan']);
  assert.equal(decoded.maxSpicyLevel, 2);
  assert.equal(decoded.maxPrice, 25);
});
test('别人打开链接能抽到同一份', () => {
  const r = draw(menu, { seed: 777, maxSpicyLevel: 1, avoidRecent: false });
  const options = optionsFromHash(`#/r?k=${encodeURIComponent(encodeShare(r))}`);
  const again = draw(menu, { ...options, avoidRecent: false });
  assert.equal(again.ticket, r.ticket);
  assert.equal(again.canteen.id, r.canteen.id);
  assert.equal(again.cuisine.id, r.cuisine.id);
});
test('非法分享码返回 null', () => {
  assert.equal(decodeShare('v9.zzz'), null);
  assert.equal(decodeShare('garbage'), null);
  assert.equal(optionsFromHash('#/draw'), null);
});
test('分享文案包含关键信息', () => {
  const r = draw(menu, { seed: 5, avoidRecent: false });
  const text = buildShareText(r, { url: 'https://example.com/#/r?k=x' });
  assert.ok(text.includes(r.canteen.name));
  assert.ok(text.includes(r.ticket));
  assert.ok(text.includes('https://example.com'));
});

/* --------------------------------------------- 自选窗口 / 自选菜（按天） */
section('自选窗口与自选菜');

const TODAY = dateKey();
const YESTERDAY = shiftDate(TODAY, -1);

function dailyContribution(id, { name, date = TODAY, stallName = '自选窗口', canteenId = 'lan_yuan', floor = '1F', image = null } = {}) {
  return {
    id,
    kind: 'dish',
    createdAt: `${date}T04:00:00.000Z`,
    author: '测试',
    payload: {
      canteenId, floor, stallName, name, priceText: '¥12',
      cuisines: ['homestyle'], spicyLevel: 0, tags: [], reviewLabel: '好评',
      reviewText: '今天刚出锅', image, date,
    },
  };
}

const todayMenu = buildMenu(base, [
  { id: 'w-1', kind: 'stall', author: '测试', createdAt: `${TODAY}T03:00:00.000Z`,
    payload: { canteenId: 'lan_yuan', floor: '1F', name: '自选窗口', windowType: '自选', note: '天天换菜', image: 'assets/uploads/win.jpg' } },
  dailyContribution('d-1', { name: '红烧肉' }),
  dailyContribution('d-2', { name: '清炒时蔬' }),
  dailyContribution('d-3', { name: '昨天的土豆丝', date: YESTERDAY }),
]);

test('窗口成为一等实体（可从菜品派生 + 贡献内容补充）', () => {
  const stall = todayMenu.stalls.find((s) => s.name === '自选窗口');
  assert.ok(stall, '没有派生出「自选窗口」');
  assert.equal(stall.windowType, '自选');
  assert.equal(stall.floor, '1F');
  assert.equal(stall.note, '天天换菜');
  assert.equal(stall.image, 'assets/uploads/win.jpg');
  assert.equal(stall.todayDishCount, 2, `今日菜数不对：${stall.todayDishCount}`);
  assert.equal(stall.dailyDishCount, 3);
  // 截图数据里的窗口也应被派生出来
  assert.ok(todayMenu.stalls.some((s) => s.name === '蜜雪冰城'), '截图数据里的窗口没有派生');
});

test('stallsOf 支持按饭堂/楼层筛选', () => {
  // 澜园 1F 既有截图数据里的窗口（椒麻鸡的「一楼米饭自选」），也有新上传的自选窗口
  const list = stallsOf(todayMenu, { canteenId: 'lan_yuan', floor: '1F' });
  assert.deepEqual(list.map((s) => s.name).sort(), ['一楼米饭自选', '自选窗口']);
  assert.ok(list.every((s) => s.canteenId === 'lan_yuan' && s.floor === '1F'));

  const onlyStall = stallsOf(todayMenu, { canteenId: 'lan_yuan', floor: '1F' })
    .find((s) => s.windowType === '自选');
  assert.equal(onlyStall.todayDishCount, 2);

  // 不传楼层则列出该饭堂全部窗口
  assert.ok(stallsOf(todayMenu, { canteenId: 'lan_yuan' }).length > list.length);
});

test('自选菜只在当天进池，第二天自动退场', () => {
  const todayPool = filterDishes(todayMenu, { canteenId: 'lan_yuan', today: TODAY });
  assert.equal(todayPool.filter((d) => d.daily).length, 2, '今天应包含 2 道自选菜');

  const tomorrowPool = filterDishes(todayMenu, { canteenId: 'lan_yuan', today: shiftDate(TODAY, 1) });
  assert.equal(tomorrowPool.filter((d) => d.daily).length, 0, '第二天自选菜应全部退场');

  const withPast = filterDishes(todayMenu, { canteenId: 'lan_yuan', today: shiftDate(TODAY, 1), includePastDaily: true });
  assert.equal(withPast.filter((d) => d.daily).length, 3, '显式要求时才包含往日自选');
});

test('抽签池默认只用今天的自选菜', () => {
  const result = draw(todayMenu, { canteenId: 'lan_yuan', floor: '1F', seed: 1, avoidRecent: false });
  assert.ok(result.ok);
  assert.ok(result.dishes.every((d) => !d.date || d.date === TODAY), '抽签不应抽到往日的自选菜');
});

test('同日同窗口同名自选菜自动去重（重拍不会放大权重）', () => {
  const menu = buildMenu(base, [
    dailyContribution('dup-1', { name: '红烧肉', image: 'a.jpg' }),
    dailyContribution('dup-2', { name: '清炒时蔬' }),
    dailyContribution('dup-3', { name: '红烧肉', image: 'b.jpg' }),
  ]);
  const names = menu.dishes.filter((d) => d.date === TODAY).map((d) => d.name);
  assert.deepEqual(names.sort(), ['清炒时蔬', '红烧肉'], `去重结果不对：${names.join(', ')}`);
  const kept = menu.dishes.find((d) => d.date === TODAY && d.name === '红烧肉');
  assert.equal(kept.image, 'b.jpg', '应保留最后上传的那条');
  assert.equal(menu.meta.stats.dedupedDailyCount, 1);
});

test('不同窗口/不同日期同名菜不会被误删', () => {
  const menu = buildMenu(base, [
    dailyContribution('k-1', { name: '红烧肉', stallName: '自选窗口' }),
    dailyContribution('k-2', { name: '红烧肉', stallName: '另一个窗口' }),
    dailyContribution('k-3', { name: '红烧肉', date: YESTERDAY }),
  ]);
  assert.equal(menu.dishes.filter((d) => d.name === '红烧肉').length, 3);
  assert.equal(menu.meta.stats.dedupedDailyCount, 0);
});

test('窗口贡献内容校验（类型/楼层/菜名）', () => {
  const ok = validateContribution({
    id: 'w-ok', kind: 'stall',
    payload: { canteenId: 'lan_yuan', floor: '2F', name: '自选窗口', windowType: '自选' },
  }, menu);
  assert.ok(ok.ok, ok.errors.join('; '));

  const bad = validateContribution({
    id: 'w-bad', kind: 'stall',
    payload: { canteenId: 'nope', floor: '9F', name: '', windowType: '随便' },
  }, menu);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 4, bad.errors.join('; '));
});

test('自选菜的 date 格式校验', () => {
  const ok = validateContribution(dailyContribution('dt-ok', { name: '青菜' }), menu);
  assert.ok(ok.ok, ok.errors.join('; '));
  assert.equal(ok.value.payload.date, TODAY);

  const bad = validateContribution({
    id: 'dt-bad', kind: 'dish',
    payload: { canteenId: 'lan_yuan', name: '青菜', cuisines: ['homestyle'], date: '2026/09/20' },
  }, menu);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('YYYY-MM-DD')));
});

test('dateKey / daysAgo 按本地日期计算', () => {
  const morning = new Date(2026, 8, 20, 0, 30, 0).getTime();
  const night = new Date(2026, 8, 20, 23, 30, 0).getTime();
  assert.equal(dateKey(morning), '2026-09-20');
  assert.equal(dateKey(night), '2026-09-20');
  assert.equal(daysAgo('2026-09-19', '2026-09-20'), 1);
  assert.equal(shiftDate('2026-09-01', -1), '2026-08-31');
});

/* --------------------------------------------------- 在线上传内容合并 */
section('贡献内容（在线上传）');
test('合法贡献通过校验', () => {
  const result = validateContribution({
    id: 'c-1', kind: 'dish',
    payload: {
      canteenId: 'lan_yuan', floor: '3F', name: '测试菜', priceText: '¥18-25左右',
      cuisines: ['hotpot'], spicyLevel: 1, tags: [], reviewLabel: '好评', reviewText: '好吃',
    },
  }, menu);
  assert.ok(result.ok, result.errors.join('; '));
});
test('非法贡献给出具体错误', () => {
  const result = validateContribution({
    id: 'x', kind: 'dish',
    payload: { name: '', canteenId: 'nope', cuisines: ['nope'], spicyLevel: 9 },
  }, menu);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 4);
});
test('合成贡献菜品并标记来源', () => {
  const merged = buildMenu(base, [{
    id: 'c-2', kind: 'dish', author: '小明', createdAt: '2026-09-20T00:00:00Z',
    payload: {
      canteenId: 'lan_yuan', floor: '3F', stallName: '锅仔', name: '社区·牛肉锅仔',
      priceText: '¥20', cuisines: ['hotpot'], spicyLevel: 1, tags: ['必点'],
      reviewLabel: '好评', reviewText: '肉多',
    },
  }]);
  const dish = merged.dishes.find((d) => d.id === 'x-c-2');
  assert.ok(dish, '未合成社区菜品');
  assert.equal(dish.origin, 'community');
  assert.equal(dish.price.min, 20);
  assert.equal(merged.meta.stats.communityDishCount, 1);
  assert.equal(merged.canteens.find((c) => c.id === 'lan_yuan').drawableDishCount, 8);
});
test('被拒绝的贡献进入 rejected 而不是让页面崩溃', () => {
  const merged = buildMenu(base, [{ id: 'bad-1', kind: 'dish', payload: { name: '', canteenId: 'nope' } }]);
  assert.equal(merged.rejected.length, 1);
  assert.equal(merged.dishes.length, base.dishes.length);
});
test('补充说明挂到目标菜上', () => {
  const merged = buildMenu(base, [{
    id: 'c-3', kind: 'note', payload: { targetDishId: 'lan_yuan-04', text: '现在涨价到 20 了' },
  }]);
  const dish = merged.dishes.find((d) => d.id === 'lan_yuan-04');
  assert.equal(dish.communityNotes.length, 1);
  assert.ok(dish.communityNotes[0].text.includes('20'));
});
test('新增饭堂后其楼层声明生效', () => {
  const merged = buildMenu(base, [{
    id: 'c-4', kind: 'canteen', payload: { id: 'new_hall', name: '新食堂', category: '食堂', floors: ['1F', '2F'] },
  }]);
  const canteen = merged.canteens.find((c) => c.id === 'new_hall');
  assert.equal(canteen.name, '新食堂');
  assert.deepEqual(canteen.floors.map((f) => f.floor), ['1F', '2F']);
  const r = draw(merged, { seed: 1, canteenId: 'new_hall', avoidRecent: false });
  assert.equal(r.ok, false, '空饭堂不应抽得出菜');
});
test('以 _ 开头的文件被忽略', () => {
  const merged = buildMenu(base, [{ id: '_example', kind: 'dish', payload: { name: 'x' } }]);
  assert.equal(merged.rejected.length, 0);
  assert.equal(merged.contributions.length, 0);
});

/* --------------------------------------------------- 上传路径约定 */
section('上传路径约定');
test('uploadPathFor 生成稳定、URL 安全的路径', () => {
  assert.equal(uploadPathFor({ name: '123-abc.jpg' }), 'assets/uploads/123-abc.jpg');
  assert.equal(uploadPathFor({ name: '照片 1.JPG' }), 'assets/uploads/___1.JPG');
  assert.equal(uploadPathFor({}), 'assets/uploads/photo.jpg');
});

/* ------------------------------------------------------------- 结果 */
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n失败详情:');
  failures.forEach((f) => console.log(`\n[${f.name}]\n${f.error.stack}`));
  process.exit(1);
}
