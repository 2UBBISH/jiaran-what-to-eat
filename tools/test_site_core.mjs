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
import { UNCATEGORIZED } from '../docs/assets/js/core/lottery.js';
import { recordDraw, recentContext, clearHistory } from '../docs/assets/js/userData.js';
import { encodeShare, decodeShare, optionsFromHash, buildShareText } from '../docs/assets/js/core/share.js';
import { createRng, hashSeed, pickWeightedMany, poolWeights, ticketOf } from '../docs/assets/js/core/rng.js';
import { uploadPathFor } from '../docs/assets/js/data/contract.js';
import { normalizeIntake, normalizeIntakeBatch, INTAKE_SPEC } from '../docs/assets/js/core/intake.js';

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

test('舞台数字稳定：池子/饭堂数不受冷却影响（回归）', () => {
  // 只统计真正可抽的菜（窗口级推荐、差评本来就不在池子里）
  const canteenDishes = filterDishes(menu, { canteenId: 'lan_yuan' }).map((dish) => dish.id);
  const before = preview(menu, { recentDishIds: [] });
  const after = preview(menu, { recentDishIds: canteenDishes, recentCanteenIds: ['lan_yuan'] });

  assert.equal(after.poolSize, before.poolSize, '池子数应保持不变（稳定口径）');
  assert.equal(after.canteenCount, before.canteenCount, '饭堂数应保持不变（稳定口径）');
  assert.equal(after.avoidedCount, canteenDishes.length, '应单独报出被冷却的菜数');
  assert.equal(after.activePoolSize, before.poolSize - canteenDishes.length, '实际可抽池子应变小');
});

test('只有一道菜的饭堂被冷却时会临时退出，但显示值不变', () => {
  const only = menu.dishes.find((dish) => dish.canteenId === 'zhi_lan_yuan');
  assert.ok(only, '样本里应有单菜饭堂');
  const base = preview(menu, {});
  const cooled = preview(menu, { recentDishIds: [only.id] });
  assert.equal(cooled.canteenCount, base.canteenCount, '显示的饭堂数不变');
  assert.equal(cooled.activeCanteenCount, base.canteenCount - 1, '实际可抽饭堂少一个');
  assert.equal(cooled.avoidedCount, 1);
});

test('冷却只记主推菜，不把整页推荐都算成「吃过」', () => {
  clearHistory();
  recordDraw({
    ok: true, seed: 1, ticket: 'AAAAA',
    canteen: { id: 'lan_yuan', name: '澜园' }, floor: '1F',
    cuisine: { id: 'sichuan', name: '川菜' },
    dishes: [{ id: 'd1', name: '一' }, { id: 'd2', name: '二' }, { id: 'd3', name: '三' }],
  });
  const ctx = recentContext();
  assert.deepEqual(ctx.recentDishIds, ['d1'], '只应记主推菜');
  assert.deepEqual(ctx.recentCanteenIds, ['lan_yuan']);
  assert.equal(ctx.recent.length, 1);
  clearHistory();
});

test('连续抽签：显示值恒定，冷却数封顶在窗口大小', () => {
  let recentDishIds = [];
  let recentCanteenIds = [];
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    const p = preview(menu, { recentDishIds, recentCanteenIds });
    seen.push([p.poolSize, p.canteenCount, p.avoidedCount]);
    const r = draw(menu, { seed: 100 + i, recentDishIds, recentCanteenIds });
    if (r.ok) {
      recentDishIds = [r.dishes[0].id, ...recentDishIds].slice(0, 5);
      recentCanteenIds = [r.canteen.id, ...recentCanteenIds].slice(0, 5);
    }
  }
  assert.equal(new Set(seen.map(([pool]) => pool)).size, 1, '池子数应始终一致');
  assert.equal(new Set(seen.map(([, canteens]) => canteens)).size, 1, '饭堂数应始终一致');
  assert.equal(Math.max(...seen.map(([, , avoided]) => avoided)), 5, '冷却数不应超过窗口大小');
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

/* ------------------------------------- 对外上传接口（图片+饭堂+楼层+窗口+价格） */
section('上传接口 normalizeIntake');

const MINIMAL = {
  image: 'assets/uploads/20260920-abc.jpg',
  canteen: '澜园',
  floor: '一楼',
  window: '自选窗口',
  price: '12',
};

test('只给五个必填项就能生成合法记录', () => {
  const result = normalizeIntake(MINIMAL, menu, { today: '2026-09-20' });
  assert.ok(result.ok, result.errors.join('; '));
  const { payload } = result.record;
  assert.equal(payload.canteenId, 'lan_yuan', '中文饭堂名应解析成 id');
  assert.equal(payload.floor, '1F', '「一楼」应规范成 1F');
  assert.equal(payload.stallName, '自选窗口');
  assert.equal(payload.priceText, '12');
  assert.equal(payload.image, 'assets/uploads/20260920-abc.jpg');
  assert.equal(payload.name, '窗口菜色', '没给菜名时用默认名');
  assert.equal(payload.unnamed, true);
  assert.equal(payload.date, '2026-09-20', '默认今天');
  assert.deepEqual(payload.cuisines, [], '菜系可留空');
  assert.ok(result.record.id, '应自动生成 id');
  // 产出的记录必须能通过系统校验
  assert.ok(validateContribution(result.record, menu).ok);
});

test('字段名别名都认（canteenName / stall / price / photo）', () => {
  const result = normalizeIntake({
    photo: 'x.jpg', canteenName: 'lan_yuan', floor: '2F', stall: '面食窗口', price: 8,
  }, menu);
  assert.ok(result.ok, result.errors.join('; '));
  assert.equal(result.record.payload.image, 'assets/uploads/x.jpg', '裸文件名应补成约定路径');
  assert.equal(result.record.payload.priceText, '¥8', '数字价格应格式化成 ¥8');
  assert.equal(result.record.payload.stallName, '面食窗口');
});

test('饭堂可以用 id、中文名，无法识别时报错并列出可选值', () => {
  assert.ok(normalizeIntake({ ...MINIMAL, canteen: 'lan_yuan' }, menu).ok);
  assert.ok(normalizeIntake({ ...MINIMAL, canteen: '澜园' }, menu).ok);
  const bad = normalizeIntake({ ...MINIMAL, canteen: '不存在的食堂' }, menu);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors[0].includes('饭堂无法识别'));
  assert.ok(bad.errors[0].includes('澜园'), '错误信息里应列出可用饭堂');
});

test('楼层别名：1F/一层/一楼/1 都能收，未知楼层报错', () => {
  ['1F', '一层', '一楼', '1', 'f1'].forEach((floor) => {
    const result = normalizeIntake({ ...MINIMAL, floor }, menu);
    assert.ok(result.ok, `${floor} 应该被接受：${result.errors.join('; ')}`);
    assert.equal(result.record.payload.floor, '1F');
  });
  const none = normalizeIntake({ ...MINIMAL, floor: '' }, menu);
  assert.ok(none.ok);
  assert.equal(none.record.payload.floor, null, '空楼层 = 未标注');
  const bad = normalizeIntake({ ...MINIMAL, floor: '9F' }, menu);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors[0].includes('楼层无法识别'));
});

test('价格接受多种写法，没有数字则报错', () => {
  [12, '12', '¥12', '12-15', '10元以下', '按重量约20'].forEach((price) => {
    const result = normalizeIntake({ ...MINIMAL, price }, menu);
    assert.ok(result.ok, `${price} 应该被接受：${result.errors.join('; ')}`);
  });
  const bad = normalizeIntake({ ...MINIMAL, price: '很便宜' }, menu);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('价格里没有数字')));
  const missing = normalizeIntake({ image: MINIMAL.image, canteen: '澜园', floor: '1F', window: '自选' }, menu);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes('缺少价格')));
});

test('图片接受约定路径 / 外链 / 裸文件名 / base64 / 对象', () => {
  assert.equal(normalizeIntake({ ...MINIMAL, image: 'assets/uploads/a.jpg' }, menu).record.payload.image, 'assets/uploads/a.jpg');
  assert.equal(normalizeIntake({ ...MINIMAL, image: 'https://cdn.example.com/a.jpg' }, menu).record.payload.image, 'https://cdn.example.com/a.jpg');
  assert.equal(normalizeIntake({ ...MINIMAL, image: 'a.jpg' }, menu).record.payload.image, 'assets/uploads/a.jpg');

  const dataUrl = normalizeIntake({ ...MINIMAL, image: 'data:image/jpeg;base64,QUJD' }, menu);
  assert.ok(dataUrl.ok, dataUrl.errors.join('; '));
  assert.equal(dataUrl.assets.length, 1, 'dataURL 会作为待提交图片返回');
  assert.equal(dataUrl.assets[0].base64, 'QUJD');

  const obj = normalizeIntake({ ...MINIMAL, image: { name: 'p.jpg', base64: 'QUJD' } }, menu);
  assert.ok(obj.ok);
  assert.equal(obj.record.payload.image, 'assets/uploads/p.jpg');
  assert.equal(obj.assets[0].name, 'p.jpg');

  const bad = normalizeIntake({ ...MINIMAL, image: 'ftp://x/a.bmp' }, menu);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('图片地址无法识别')));
});

test('菜系可用中文名，辣度可用标签', () => {
  const result = normalizeIntake({ ...MINIMAL, cuisines: ['川菜'], spicyLevel: '微辣' }, menu);
  assert.ok(result.ok, result.errors.join('; '));
  assert.deepEqual(result.record.payload.cuisines, ['sichuan']);
  assert.equal(result.record.payload.spicyLevel, 1);

  const ambiguous = normalizeIntake({ ...MINIMAL, cuisines: ['菜'] }, menu);
  assert.equal(ambiguous.ok, false);
  assert.ok(ambiguous.errors.some((e) => e.includes('歧义')));

  const bad = normalizeIntake({ ...MINIMAL, spicyLevel: '超辣' }, menu);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('辣度无法识别')));
});

test('批量上传：一条坏不影响其他', () => {
  const batch = normalizeIntakeBatch([
    { ...MINIMAL, price: '12' },
    { ...MINIMAL, canteen: '不存在', price: '12' },
    { ...MINIMAL, price: '15', window: '另一个窗口' },
  ], menu);
  assert.equal(batch.records.length, 2);
  assert.equal(batch.failed.length, 1);
  assert.equal(batch.failed[0].index, 1, '应指出第几条失败');
  assert.ok(batch.failed[0].errors[0].includes('饭堂'));
});

test('接口说明里列出的必填项就是那五个', () => {
  assert.deepEqual(INTAKE_SPEC.required, ['image', 'canteen', 'floor', 'window', 'price']);
  assert.equal(INTAKE_SPEC.version, 'v1');
});

test('对外 JSON Schema 与代码常量保持一致（防止文档漂移）', () => {
  const schema = JSON.parse(readFileSync(join(ROOT, 'docs/assets/data/intake-schema.json'), 'utf8'));
  const item = schema.$defs.intakeItem;
  assert.deepEqual(item.required, INTAKE_SPEC.required, 'schema 的必填项应与 INTAKE_SPEC.required 一致');
  assert.equal(schema['x-interface-version'], INTAKE_SPEC.version, 'schema 版本号应与 INTAKE_SPEC.version 一致');
  INTAKE_SPEC.required.concat(INTAKE_SPEC.optional).forEach((field) => {
    assert.ok(item.properties[field], `schema 里缺少字段：${field}`);
  });
  // 别名表也要与 schema 描述对得上（至少保证别名在文档里有出现）
  Object.entries(INTAKE_SPEC.aliases).forEach(([field, aliases]) => {
    if (!item.properties[field]) return;
    const description = item.properties[field].description || '';
    aliases.slice(1).forEach((alias) => {
      assert.ok(description.includes(alias), `${field} 的别名 ${alias} 没写进 schema 描述`);
    });
  });
});

test('没标菜系的菜照样能被抽签推送（未标菜系桶）', () => {
  // 用一个截图数据里没有菜的楼层，保证池子里只有这两道「未标菜系」的菜
  const menu2 = buildMenu(base, [
    { id: 'u-1', kind: 'dish', payload: { canteenId: 'zhi_lan_yuan', floor: '3F', stallName: '自选窗口', name: '红烧肉', priceText: '¥12', cuisines: [], date: TODAY } },
    { id: 'u-2', kind: 'dish', payload: { canteenId: 'zhi_lan_yuan', floor: '3F', stallName: '自选窗口', name: '青菜', priceText: '¥6', cuisines: [], date: TODAY } },
  ]);
  const result = draw(menu2, { canteenId: 'zhi_lan_yuan', floor: '3F', seed: 3, avoidRecent: false });
  assert.ok(result.ok);
  assert.equal(result.cuisine.id, UNCATEGORIZED.id, '应推送「未标菜系」');
  assert.equal(result.dishes.length, 2);
  assert.ok(result.dishes.every((d) => d.cuisines.length === 0));

  // 混着有菜系的菜时，「未标菜系」也应出现在候选里
  const mixed = buildMenu(base, [
    { id: 'u-3', kind: 'dish', payload: { canteenId: 'zhi_lan_yuan', floor: '3F', stallName: '自选窗口', name: '红烧肉', priceText: '¥12', cuisines: [], date: TODAY } },
    { id: 'u-4', kind: 'dish', payload: { canteenId: 'zhi_lan_yuan', floor: '3F', stallName: '自选窗口', name: '回锅肉', priceText: '¥14', cuisines: ['sichuan'], date: TODAY } },
  ]);
  const seen = new Set();
  for (let seed = 0; seed < 20; seed += 1) {
    const r = draw(mixed, { canteenId: 'zhi_lan_yuan', floor: '3F', seed, avoidRecent: false });
    if (r.ok) seen.add(r.cuisine.id);
  }
  assert.ok(seen.has(UNCATEGORIZED.id) && seen.has('sichuan'), `两种菜系都应能被推到：${[...seen].join(', ')}`);
});

test('未命名多张照片不会被去重合并；同图重复上传会合并', () => {
  const unnamed = (id, image) => ({
    id, kind: 'dish',
    payload: { canteenId: 'lan_yuan', floor: '1F', stallName: '自选窗口', priceText: '¥10', cuisines: [], date: TODAY, image, unnamed: true },
  });
  const menu2 = buildMenu(base, [unnamed('n-1', 'assets/uploads/a.jpg'), unnamed('n-2', 'assets/uploads/b.jpg')]);
  assert.equal(menu2.dishes.filter((d) => d.unnamed).length, 2, '不同照片应各自保留');
  assert.equal(menu2.meta.stats.dedupedDailyCount, 0);

  const menu3 = buildMenu(base, [unnamed('n-3', 'assets/uploads/a.jpg'), unnamed('n-4', 'assets/uploads/a.jpg')]);
  assert.equal(menu3.dishes.filter((d) => d.unnamed).length, 1, '同一张图重复上传应合并');
  assert.equal(menu3.meta.stats.dedupedDailyCount, 1);
});

test('README 里的接口示例都是合法 JSON 且能通过规范化', () => {
  const readme = readFileSync(join(ROOT, 'docs/README.md'), 'utf8');
  const blocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 4, `README 里的 JSON 示例太少：${blocks.length}`);

  const REQUIRED = INTAKE_SPEC.required;
  let checked = 0;
  blocks.forEach((block, index) => {
    let parsed;
    try {
      parsed = JSON.parse(block);
    } catch (error) {
      throw new Error(`README 第 ${index + 1} 个 JSON 示例不是合法 JSON：${error.message}`);
    }

    const isItem = REQUIRED.every((key) => Object.prototype.hasOwnProperty.call(parsed, key));
    if (isItem) {
      const result = normalizeIntake(parsed, menu);
      assert.ok(result.ok, `README 最小请求示例没通过规范化：${result.errors.join('; ')}`);
      checked += 1;
    }

    if (Array.isArray(parsed.records)
      && parsed.records.length
      && parsed.records.every((item) => REQUIRED.every((key) => key in item))) {
      const batch = normalizeIntakeBatch(parsed, menu);
      assert.equal(batch.failed.length, 0, `README 批量示例有失败项：${JSON.stringify(batch.failed)}`);
      assert.equal(batch.records.length, parsed.records.length);
      checked += 1;
    }
  });
  assert.ok(checked >= 2, `至少应校验「最小请求」与「批量」两个示例，实际校验了 ${checked}`);
});

test('裸接口格式的 JSON 文件也能直接收（不需要包 payload）', () => {
  const raw = { image: 'assets/uploads/a.jpg', canteen: '澜园', floor: '一楼', window: '自选窗口', price: '12' };
  const menuA = buildMenu(base, [raw]);
  const menuB = buildMenu(base, [raw]);
  const dishA = menuA.dishes.find((d) => d.origin === 'community');
  const dishB = menuB.dishes.find((d) => d.origin === 'community');

  assert.ok(dishA, '裸接口格式的文件应被接受');
  assert.equal(dishA.payload ? '' : dishA.canteenId, 'lan_yuan');
  assert.equal(dishA.floor, '1F', '「一楼」应规范化');
  assert.equal(dishA.name, '窗口菜色');
  assert.equal(dishA.price.min, 12);
  assert.equal(dishA.date, TODAY, '默认今天');
  assert.equal(dishA.id, dishB.id, 'id 必须稳定（否则收藏/历史会指错）');
  assert.equal(menuA.meta.stats.rejectedCount, 0);
  assert.ok(menuA.stalls.some((stall) => stall.name === '自选窗口'), '窗口应自动派生');
});

test('裸接口格式可以引用同一批上传的新饭堂', () => {
  const merged = buildMenu(base, [
    { ...{ image: 'assets/uploads/a.jpg', canteen: '新食堂', floor: '1F', window: '自选窗口', price: '12' } },
    { id: 'newhall-1', kind: 'canteen', payload: { id: 'new_hall', name: '新食堂', floors: ['1F'] } },
  ]);
  assert.equal(merged.meta.stats.rejectedCount, 0, JSON.stringify(merged.rejected));
  const dish = merged.dishes.find((d) => d.origin === 'community');
  assert.equal(dish.canteenId, 'new_hall');
});

test('文件方式用 base64 会被明确拒绝并给出替代方案', () => {
  const merged = buildMenu(base, [
    { image: 'data:image/jpeg;base64,QUJD', canteen: '澜园', floor: '1F', window: '自选窗口', price: '12' },
  ]);
  assert.equal(merged.meta.stats.rejectedCount, 1);
  assert.ok(merged.rejected[0].errors[0].includes('base64'), merged.rejected[0].errors[0]);
  assert.ok(merged.rejected[0].errors[0].includes('upload.html'), '应提示改用哪个入口');
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
