/**
 * 抽签引擎（core，纯函数、无 DOM、无网络）
 * ---------------------------------------------------------------------------
 * 玩法：先抽「饭堂 + 楼层」，再据此推送一个「菜系」，并给出该菜系在这一层的菜。
 *
 * 为什么可复现：所有随机都来自 seed 派生的独立随机流
 *   seed:draw  -> ':canteen' / ':floor' / ':cuisine'
 * 同一个 seed + 同一份菜单 + 同一组筛选 = 完全一样的结果，
 * 所以「签号 / 分享链接」不需要后端也能让同学看到同一份推送。
 */

import { createRng, hashSeed, pickWeighted, poolWeights, ticketOf } from './rng.js';
import { filterDishes } from './menu.js';
import { dateKey } from './date.js';
import { encodeShare } from './share.js';

export const DEFAULT_OPTIONS = {
  seed: null,
  daily: false,
  canteenId: null,
  floor: null,
  cuisines: [],
  maxSpicyLevel: null,
  maxPrice: null,
  requirePrice: false,
  mealSlot: null,
  vegetarian: null,
  keyword: '',
  labeledFloorsOnly: false,
  avoidRecent: true,
  includePastDaily: false,
  recentDishIds: [],
  recentCanteenIds: [],
  canteenWeight: 'balanced', // balanced | dishWeight | uniform
  perCuisineDishLimit: 8,
};

const CANTEEN_WEIGHTS = ['balanced', 'dishWeight', 'uniform'];

export function normalizeOptions(options = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  merged.cuisines = Array.isArray(merged.cuisines) ? merged.cuisines.filter(Boolean) : [];
  merged.recentDishIds = Array.isArray(merged.recentDishIds) ? merged.recentDishIds : [];
  merged.recentCanteenIds = Array.isArray(merged.recentCanteenIds) ? merged.recentCanteenIds : [];
  if (!CANTEEN_WEIGHTS.includes(merged.canteenWeight)) merged.canteenWeight = 'balanced';
  if (merged.maxSpicyLevel != null) merged.maxSpicyLevel = Number(merged.maxSpicyLevel);
  if (merged.maxPrice != null) merged.maxPrice = Number(merged.maxPrice);
  return merged;
}

/** 解析本次抽签的种子；daily=true 时同一天同一条件结果固定 */
export function resolveSeed(options = {}, now = Date.now()) {
  const cuisines = Array.isArray(options.cuisines) ? options.cuisines : [];
  if (options.seed != null && options.seed !== '') {
    return { seed: hashSeed(options.seed), kind: 'explicit' };
  }
  if (options.daily) {
    const today = dateKey(now);
    const signature = [
      today, options.canteenId || '', options.floor || '',
      cuisines.join('+'), options.maxSpicyLevel ?? '', options.maxPrice ?? '',
    ].join('|');
    return { seed: hashSeed(`daily|${signature}`), kind: 'daily', dateKey: today };
  }
  return { seed: (Math.random() * 4294967296) >>> 0, kind: 'random' };
}

/* --------------------------------------------------------------- 抽签计划 */

/**
 * 计算候选池与各级权重（不消费随机数）。
 * 抽签与「概率透明」展示共用它，便于验证公平性。
 */
export function plan(menu, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const filters = {
    canteenId: options.canteenId || null,
    cuisines: options.cuisines,
    includePastDaily: options.includePastDaily,
    maxSpicyLevel: options.maxSpicyLevel,
    maxPrice: options.maxPrice,
    requirePrice: options.requirePrice,
    mealSlot: options.mealSlot,
    vegetarian: options.vegetarian,
    keyword: options.keyword,
    labeledFloorsOnly: options.labeledFloorsOnly,
  };

  const basePool = filterDishes(menu, filters);
  const recentDishes = new Set(options.recentDishIds);
  const recentCanteens = new Map();
  options.recentCanteenIds.forEach((id) => recentCanteens.set(id, (recentCanteens.get(id) || 0) + 1));

  const warnings = [];
  const weightOf = (dish) => {
    let weight = Math.max(0, dish.drawWeight);
    if (options.avoidRecent && recentDishes.has(dish.id)) weight = 0;
    return weight;
  };

  const pool = basePool;
  let relaxed = false;
  const strictTotal = pool.reduce((sum, dish) => sum + weightOf(dish), 0);
  if (basePool.length && strictTotal <= 0 && options.avoidRecent) {
    // 最近吃过的菜刚好覆盖了整个池子：放宽冷却，避免抽不出来
    relaxed = true;
    warnings.push('最近吃过的菜覆盖了整个候选池，本次已放宽冷却');
  }
  const effectiveWeight = relaxed
    ? (dish) => Math.max(0, dish.drawWeight)
    : weightOf;

  const byCanteen = new Map();
  pool.forEach((dish) => {
    if (!byCanteen.has(dish.canteenId)) byCanteen.set(dish.canteenId, []);
    byCanteen.get(dish.canteenId).push(dish);
  });

  const canteenRows = menu.canteens
    .filter((canteen) => byCanteen.has(canteen.id))
    .map((canteen) => {
      const dishes = byCanteen.get(canteen.id);
      const sum = dishes.reduce((acc, dish) => acc + effectiveWeight(dish), 0);
      const recentCount = recentCanteens.get(canteen.id) || 0;
      let weight;
      if (options.canteenWeight === 'uniform') weight = 1;
      else if (options.canteenWeight === 'dishWeight') weight = sum;
      else weight = sum / (1 + recentCount);
      return { canteen, dishes, weight, recentCount, sum };
    })
    .filter((row) => row.dishes.length > 0 && row.weight > 0);

  const { total: canteenTotal, rows: canteenWeights } = poolWeights(canteenRows, (row) => row.weight);

  return {
    options,
    filters,
    pool,
    basePool,
    canteenRows,
    canteenTotal,
    canteenWeights: canteenWeights.map((row) => ({
      canteenId: row.item.canteen.id,
      name: row.item.canteen.name,
      probability: row.probability,
      dishCount: row.item.dishes.length,
    })),
    effectiveWeight,
    warnings,
  };
}

/** 把某个饭堂的候选菜按楼层分桶（floor 为 null 的归入「未标注」） */
export function floorBuckets(dishes, weightOf) {
  const map = new Map();
  dishes.forEach((dish) => {
    const key = dish.floor || '__none__';
    if (!map.has(key)) map.set(key, { floor: dish.floor, dishes: [] });
    map.get(key).dishes.push(dish);
  });
  const buckets = [...map.values()].map((bucket) => ({
    ...bucket,
    weight: bucket.dishes.reduce((sum, dish) => sum + weightOf(dish), 0),
  }));
  buckets.sort((a, b) => (a.floor || 'z').localeCompare(b.floor || 'z'));
  return buckets;
}

/** 把候选菜按菜系分桶；多菜系菜品把权重均摊，避免重复计数 */
export function cuisineBuckets(dishes, weightOf) {
  const map = new Map();
  dishes.forEach((dish) => {
    const share = weightOf(dish) / Math.max(1, dish.cuisines.length);
    dish.cuisines.forEach((id) => {
      if (!map.has(id)) map.set(id, { cuisineId: id, dishes: [], weight: 0 });
      const bucket = map.get(id);
      bucket.dishes.push(dish);
      bucket.weight += share;
    });
  });
  const buckets = [...map.values()];
  buckets.sort((a, b) => b.weight - a.weight || a.cuisineId.localeCompare(b.cuisineId));
  return buckets;
}

function sortDishes(dishes, weightOf) {
  return dishes.slice().sort((a, b) => (
    weightOf(b) - weightOf(a)
    || (a.price?.min ?? 999) - (b.price?.min ?? 999)
    || a.id.localeCompare(b.id)
  ));
}

/* ------------------------------------------------------------------ 抽签 */

/**
 * 执行一次「饭堂 + 楼层 -> 推送菜系」抽签。
 * @param {object} menu buildMenu() 产物
 * @param {object} rawOptions 见 DEFAULT_OPTIONS
 * @param {object} [env] { now, attempt } attempt 用于「换个菜系」
 */
export function draw(menu, rawOptions = {}, env = {}) {
  const now = env.now ?? Date.now();
  const options = normalizeOptions(rawOptions);
  const { kind, seed, dateKey } = resolveSeed(options, now);
  const planResult = plan(menu, options);
  const { pool, warnings } = planResult;
  const effectiveWeight = planResult.effectiveWeight;
  const attempt = Math.max(0, Number(env.attempt) || 0);

  if (!pool.length) {
    return {
      ok: false,
      reason: 'empty_pool',
      hint: '没有符合条件的菜，试试放宽辣度 / 预算，或关闭「避开最近吃过的」',
      seed, kind, ticket: ticketOf(seed), filters: planResult.filters, warnings,
    };
  }

  const canteenRng = createRng(`${seed}:canteen:${attempt}`);
  const floorRng = createRng(`${seed}:floor:${attempt}`);
  const cuisineRng = createRng(`${seed}:cuisine:${attempt}`);

  let canteenRow = null;
  if (options.canteenId) {
    canteenRow = planResult.canteenRows.find((row) => row.canteen.id === options.canteenId) || null;
  }
  if (!canteenRow) {
    canteenRow = pickWeighted(planResult.canteenRows, canteenRng, (row) => row.weight);
  }
  if (!canteenRow) {
    return {
      ok: false, reason: 'no_canteen', hint: '这个筛选条件下没有可抽的饭堂',
      seed, kind, ticket: ticketOf(seed), filters: planResult.filters, warnings,
    };
  }

  const canteen = canteenRow.canteen;
  const buckets = floorBuckets(canteenRow.dishes, effectiveWeight);

  let floorBucket = null;
  if (options.floor) {
    floorBucket = buckets.find((bucket) => bucket.floor === options.floor) || null;
  } else if (options.lockFloor) {
    // 「只换菜系」时锁定楼层：null 表示「楼层未标注」这一桶，而不是「不限楼层」
    floorBucket = buckets.find((bucket) => bucket.floor === null) || null;
  }
  if (!floorBucket) {
    floorBucket = pickWeighted(buckets, floorRng, (bucket) => bucket.weight);
  }
  if (!floorBucket) {
    floorBucket = buckets[0] || null;
  }

  const floor = floorBucket ? floorBucket.floor : null;
  const floorDishes = floorBucket ? floorBucket.dishes : [];
  if (!floor) {
    warnings.push(`${canteen.name}的菜没有标注楼层，本次按「楼层未标注」展示`);
  }

  // 用户指定了菜系时，推送也必须落在指定范围内（否则会出现「筛了川菜却推面食」）
  const allCuisineBuckets = cuisineBuckets(floorDishes, effectiveWeight);
  const cuisines = options.cuisines.length
    ? allCuisineBuckets.filter((bucket) => options.cuisines.includes(bucket.cuisineId))
    : allCuisineBuckets;
  const cuisineBucket = pickWeighted(cuisines, cuisineRng, (bucket) => bucket.weight);
  const cuisine = cuisineBucket
    ? (menu.cuisines.find((c) => c.id === cuisineBucket.cuisineId) || null)
    : null;
  if (!cuisine) warnings.push('这一层的菜还没有菜系标签，先看看推荐菜');

  const dishLimit = Math.max(1, options.perCuisineDishLimit);
  const pushedDishes = cuisineBucket ? sortDishes(cuisineBucket.dishes, effectiveWeight).slice(0, dishLimit) : [];

  const others = sortDishes(
    pool.filter((dish) => dish.canteenId === canteen.id && dish.floor !== floor),
    effectiveWeight,
  ).slice(0, 4);

  const communityDishCount = (cuisineBucket ? cuisineBucket.dishes : [])
    .filter((dish) => dish.origin === 'community').length;
  if (communityDishCount) warnings.push(`其中 ${communityDishCount} 道来自同学在线上传，尚未人工核对`);

  const result = {
    ok: true,
    mode: 'canteen_floor',
    seed,
    seedKind: kind,
    dateKey: dateKey || null,
    ticket: ticketOf(seed),
    canteen,
    floor,
    floorLabel: floor ? ({ '1F': '一层', '2F': '二层', '3F': '三层' }[floor] || floor) : '楼层未标注',
    floorSource: floorDishes[0]?.floorSource || null,
    cuisine,
    dishes: pushedDishes,
    dishesOfCuisine: cuisineBucket ? cuisineBucket.dishes.length : 0,
    others,
    poolSize: pool.length,
    canteenPoolSize: canteenRow.dishes.length,
    weights: {
      canteens: planResult.canteenWeights,
      floors: poolWeights(buckets, (bucket) => bucket.weight).rows.map((row) => ({
        floor: row.item.floor, probability: row.probability, dishCount: row.item.dishes.length,
      })),
      cuisines: poolWeights(cuisines, (bucket) => bucket.weight).rows.map((row) => ({
        cuisineId: row.item.cuisineId, probability: row.probability, dishCount: row.item.dishes.length,
      })),
    },
    filters: planResult.filters,
    warnings,
    createdAt: now,
    attempt,
  };
  result.shareCode = encodeShare(result);
  return result;
}

/** 保持饭堂与楼层不变，只换一个推送菜系 */
export function redrawCuisine(menu, previous, rawOptions = {}) {
  if (!previous?.ok) return draw(menu, rawOptions);
  return draw(menu, {
    ...rawOptions,
    seed: previous.seed,
    canteenId: previous.canteen.id,
    floor: previous.floor,
    lockFloor: true, // 锁定楼层（previous.floor 可能是 null = 未标注）
  }, {
    now: previous.createdAt ?? Date.now(),
    attempt: (previous.attempt || 0) + 1,
  });
}

/**
 * 抽签前的概率预览：抽签页可以把它摊开给用户看（公平、可验证）。
 */
export function preview(menu, rawOptions = {}, env = {}) {
  const options = normalizeOptions(rawOptions);
  const { kind, seed } = resolveSeed(options, env.now ?? Date.now());
  const planResult = plan(menu, options);
  const canteenWeights = planResult.canteenWeights;
  const top = [...canteenWeights].sort((a, b) => b.probability - a.probability).slice(0, 5);
  return {
    seed,
    kind,
    ticket: ticketOf(seed),
    poolSize: planResult.pool.length,
    canteenCount: planResult.canteenRows.length,
    canteenWeights,
    topCanteens: top,
    warnings: planResult.warnings,
  };
}
