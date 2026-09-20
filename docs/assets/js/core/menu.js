/**
 * 菜单装配层（core，纯函数）
 * ---------------------------------------------------------------------------
 * 前端只认一种「Menu」对象，它由两部分合成：
 *   1) 构建期生成的静态数据  docs/assets/data/menu.json（tools/build_menu_data.py 产出）
 *   2) 线上上传的增量内容    docs/assets/data/contributions/*.json
 * 合成、校验、聚合、索引都在这里完成，视图层不关心数据从哪来。
 */

import { dateKey, isDateKey } from './date.js';

const FLOOR_IDS = ['1F', '2F', '3F'];
const CONTRIBUTION_KINDS = ['dish', 'canteen', 'stall', 'note'];
const WINDOW_TYPES = ['窗口', '自选', '固定'];

/* ------------------------------------------------------------------ 校验 */

function isStr(value, min = 1, max = 400) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

/** 把贡献内容里的价格文本解析成结构化价格（与工具链的规则保持一致） */
export function parsePriceText(text) {
  const base = {
    text: typeof text === 'string' ? text : null,
    min: null, max: null, currency: 'CNY',
    approx: false, uncertain: false, openEnded: false, note: null,
  };
  if (!isStr(text, 1, 60)) return base;

  const numbers = (text.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const approx = /左右|大概|大约|约|貌似/.test(text);
  const uncertain = /[?？]|忘了|还是/.test(text);
  const openEnded = /\+|以上/.test(text);
  const below = /以下/.test(text);

  let min = numbers.length ? Math.min(...numbers) : null;
  let max = numbers.length ? Math.max(...numbers) : null;
  if (below) min = null;
  if (openEnded) max = null;

  let note = null;
  for (const marker of ['半只', '半份', '一个', '小碗', '大碗', '看加几样东西', '按重量', '自选']) {
    if (text.includes(marker)) { note = marker; break; }
  }
  if (text.includes('小碗') && text.includes('大碗')) note = '小碗 / 大碗';

  const norm = (n) => (n == null ? null : (Number.isInteger(n) ? n : Number(n.toFixed(1))));
  return { ...base, min: norm(min), max: norm(max), approx, uncertain, openEnded, note };
}

/** 从 taxonomy 里取「评价标签 -> 等级/权重」，保证与生成数据同步 */
export function reviewMeta(menu) {
  const levels = menu?.taxonomy?.reviewLevels || [];
  const byLabel = new Map();
  const byId = new Map();
  levels.forEach((level) => {
    byLabel.set(level.label, level);
    byId.set(level.id, level);
  });
  return { byLabel, byId };
}

/**
 * 校验一条上传内容。
 * @returns {{ok:boolean, errors:string[], value?:object}}
 */
export function validateContribution(raw, menu) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['内容不是合法的 JSON 对象'] };

  const id = String(raw.id ?? '').trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(id)) errors.push('id 需为 3-64 位字母/数字/._-');
  if (!CONTRIBUTION_KINDS.includes(raw.kind)) errors.push(`kind 必须是 ${CONTRIBUTION_KINDS.join(' / ')}`);
  // payload 不是对象时无法继续校验明细，直接返回已收集的错误
  if (!raw.payload || typeof raw.payload !== 'object') {
    errors.push('缺少 payload');
    return { ok: false, errors };
  }

  const payload = { ...raw.payload };
  const { byLabel } = reviewMeta(menu);
  const canteenIds = new Set(menu.canteens.map((c) => c.id));
  const cuisineIds = new Set(menu.taxonomy.cuisines.map((c) => c.id));
  const tagNames = new Set(menu.taxonomy.tags.map((t) => t.name));

  if (raw.kind === 'dish') {
    if (!isStr(payload.name, 1, 40)) errors.push('菜名需为 1-40 字');
    if (!canteenIds.has(payload.canteenId)) errors.push(`饭堂 id 不存在：${payload.canteenId}`);
    const floor = payload.floor ?? null;
    if (floor != null && !FLOOR_IDS.includes(floor)) errors.push('floor 只能是 1F / 2F / 3F 或留空');
    if (payload.priceText != null && !isStr(payload.priceText, 0, 60)) errors.push('价格文本过长');
    const cuisines = Array.isArray(payload.cuisines) ? payload.cuisines : [];
    cuisines.forEach((id2) => {
      if (!cuisineIds.has(id2)) errors.push(`菜系 id 不存在：${id2}`);
    });
    if (!cuisines.length) errors.push('至少选择 1 个菜系');
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    tags.forEach((tag) => {
      if (!tagNames.has(tag)) errors.push(`标签不在词表内：${tag}`);
    });
    const spicy = Number(payload.spicyLevel ?? 0);
    if (!Number.isInteger(spicy) || spicy < 0 || spicy > 3) errors.push('辣度需为 0-3 的整数');
    const label = String(payload.reviewLabel ?? '好评');
    if (!byLabel.has(label)) errors.push(`评价标签不在词表内：${label}`);
    if (payload.reviewText != null && !isStr(payload.reviewText, 0, 400)) errors.push('评价最多 400 字');
    if (payload.image != null && !isStr(payload.image, 0, 300)) errors.push('图片地址过长');
    if (payload.stallName != null && !isStr(payload.stallName, 0, 60)) errors.push('窗口名过长');
    // date：填了就是「当天有效的自选菜」，不填就是常驻菜
    if (payload.date != null && payload.date !== '' && !isDateKey(payload.date)) {
      errors.push('date 需为 YYYY-MM-DD（自选菜填当天日期）');
    }

    payload.floor = floor;
    payload.cuisines = cuisines;
    payload.tags = tags;
    payload.spicyLevel = spicy;
    payload.reviewLabel = label;
    payload.mealSlots = Array.isArray(payload.mealSlots) && payload.mealSlots.length
      ? payload.mealSlots.filter((s) => menu.taxonomy.mealSlots.some((x) => x.id === s))
      : ['lunch', 'dinner'];
    payload.vegetarian = payload.vegetarian === true ? true : (payload.vegetarian === false ? false : null);
  }

  if (raw.kind === 'canteen') {
    if (!isStr(payload.name, 1, 20)) errors.push('饭堂名需为 1-20 字');
    if (payload.id && !/^[a-z0-9_]{3,32}$/.test(payload.id)) errors.push('饭堂 id 需为 3-32 位小写字母/数字/下划线');
    if (canteenIds.has(payload.id)) errors.push(`饭堂 id 已存在：${payload.id}`);
    const floors = Array.isArray(payload.floors) ? payload.floors : [];
    floors.forEach((f) => {
      if (!FLOOR_IDS.includes(f)) errors.push(`楼层只能是 ${FLOOR_IDS.join(' / ')}`);
    });
    payload.floors = floors;
  }

  if (raw.kind === 'stall') {
    if (!canteenIds.has(payload.canteenId)) errors.push(`饭堂 id 不存在：${payload.canteenId}`);
    const floor = payload.floor ?? null;
    if (floor != null && !FLOOR_IDS.includes(floor)) errors.push('floor 只能是 1F / 2F / 3F 或留空');
    if (!isStr(payload.name, 1, 40)) errors.push('窗口名需为 1-40 字');
    const windowType = payload.windowType || '窗口';
    if (!WINDOW_TYPES.includes(windowType)) errors.push(`windowType 只能是 ${WINDOW_TYPES.join(' / ')}`);
    if (payload.note != null && !isStr(payload.note, 0, 300)) errors.push('窗口说明最多 300 字');
    if (payload.image != null && !isStr(payload.image, 0, 300)) errors.push('图片地址过长');
    payload.floor = floor;
    payload.windowType = windowType;
  }

  if (raw.kind === 'note') {
    const dishIds = new Set(menu.dishes.map((d) => d.id));
    if (!dishIds.has(payload.targetDishId)) errors.push(`菜品 id 不存在：${payload.targetDishId}`);
    if (!isStr(payload.text, 1, 300)) errors.push('补充说明需为 1-300 字');
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [], value: { ...raw, id, payload } };
}

/* ------------------------------------------------------------------ 合成 */

function newDishFromContribution(menu, contrib, index) {
  const p = contrib.payload;
  const { byLabel } = reviewMeta(menu);
  const level = byLabel.get(p.reviewLabel) || byLabel.get('好评');
  const price = parsePriceText(p.priceText);
  const variants = Array.isArray(p.variants) ? p.variants.filter((v) => isStr(v, 1, 40)) : [];
  return {
    id: `x-${contrib.id}`,
    type: 'dish',
    origin: 'community',
    contributionId: contrib.id,
    name: p.name.trim(),
    variants,
    canteenId: p.canteenId,
    floor: p.floor ?? null,
    floorId: p.floor ? `${p.canteenId}-${p.floor.toLowerCase()}` : null,
    floorSource: p.floor ? 'contribution' : null,
    stallName: p.stallName ? p.stallName.trim() : null,
    cuisines: p.cuisines.slice(),
    primaryCuisine: p.cuisines[0] ?? null,
    tags: p.tags.slice(),
    spicyLevel: p.spicyLevel,
    mealSlots: p.mealSlots.slice(),
    vegetarian: p.vegetarian,
    date: isDateKey(p.date) ? p.date : null,
    price,
    priceTier: null,
    reviewLevel: level ? level.id : 'positive',
    reviewLabel: level ? level.label : '好评',
    reviewText: (p.reviewText || '').trim(),
    drawWeight: level ? level.drawWeight : 3,
    excludedByDefault: level ? Boolean(level.excludedByDefault) : false,
    image: p.image || null,
    author: contrib.author || null,
    createdAt: contrib.createdAt || null,
    searchKeys: [p.name.trim(), ...variants, p.stallName || ''].filter(Boolean),
    source: { contribution: contrib.id, author: contrib.author || null, page: null },
    _index: index,
  };
}

function applyContribution(menu, contrib) {
  const p = contrib.payload;
  if (contrib.kind === 'dish') {
    const dish = newDishFromContribution(menu, contrib, menu.dishes.length);
    if (menu.dishes.some((d) => d.id === dish.id)) return;
    menu.dishes.push(dish);
    return;
  }
  if (contrib.kind === 'canteen') {
    const canteenId = p.id || `c-${contrib.id}`.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
    if (menu.canteens.some((c) => c.id === canteenId)) return;
    menu.canteens.push({
      id: canteenId,
      name: p.name.trim(),
      category: p.category || '食堂',
      status: 'open',
      tags: Array.isArray(p.tags) ? p.tags : [],
      note: p.note || '由同学在线上传',
      origin: 'community',
      declaredFloors: p.floors.slice(),
      contributionId: contrib.id,
      floors: [], unassignedFloorDishCount: 0, dishCount: 0,
      drawableDishCount: 0, drawWeight: 0, stallNames: [], cuisines: [],
    });
    return;
  }
  if (contrib.kind === 'stall') {
    menu.stallRecords.push({
      contributionId: contrib.id,
      canteenId: p.canteenId,
      floor: p.floor ?? null,
      name: p.name.trim(),
      windowType: p.windowType,
      note: p.note || null,
      image: p.image || null,
      author: contrib.author || null,
      createdAt: contrib.createdAt || null,
    });
    return;
  }

  if (contrib.kind === 'note') {
    const dish = menu.dishes.find((d) => d.id === p.targetDishId);
    if (!dish) return;
    dish.communityNotes = dish.communityNotes || [];
    dish.communityNotes.push({
      text: p.text.trim(),
      author: contrib.author || '匿名同学',
      createdAt: contrib.createdAt || null,
      contributionId: contrib.id,
    });
  }
}

const PRICE_TIERS = [
  ['cheap', 0, 10], ['normal', 10, 20], ['premium', 20, 50], ['restaurant', 50, null],
];

function priceTierOf(price) {
  const anchor = price?.min ?? price?.max;
  if (anchor == null) return null;
  for (const [id, low, high] of PRICE_TIERS) {
    if (anchor > low && (high == null || anchor <= high)) return id;
  }
  return null;
}

/**
 * 把「窗口」变成一等实体：
 *   - 从已有菜品的 stallName 自动派生（截图数据里就有窗口名）
 *   - 线上新增的 stall 贡献可以补图片/说明/类型（自选 | 固定 | 窗口）
 * 同一 (饭堂, 楼层, 窗口名) 视为同一个窗口。
 */
function deriveStalls(menu) {
  const map = new Map();
  const keyOf = (canteenId, floor, name) => `${canteenId}|${floor || ''}|${name}`;

  function ensure(canteenId, floor, name) {
    const key = keyOf(canteenId, floor, name);
    if (!map.has(key)) {
      map.set(key, {
        id: `stall:${key}`,
        canteenId,
        floor: floor || null,
        name,
        windowType: '窗口',
        note: null,
        image: null,
        origin: 'derived',
        contributionId: null,
        author: null,
        createdAt: null,
        dishCount: 0,
        dailyDishCount: 0,
        todayDishCount: 0,
        dishIds: [],
      });
    }
    return map.get(key);
  }

  menu.dishes.forEach((dish) => {
    if (!dish.stallName) return;
    const stall = ensure(dish.canteenId, dish.floor, dish.stallName);
    stall.dishCount += 1;
    stall.dishIds.push(dish.id);
    if (dish.daily) {
      stall.dailyDishCount += 1;
      if (dish.isToday) stall.todayDishCount += 1;
      if (!stall.image && dish.image) stall.image = dish.image; // 自选菜照片顺带当窗口图
    }
  });

  menu.stallRecords.forEach((record) => {
    const stall = ensure(record.canteenId, record.floor, record.name);
    stall.windowType = record.windowType || stall.windowType;
    if (record.note) stall.note = record.note;
    if (record.image) stall.image = record.image;
    stall.origin = 'community';
    stall.contributionId = record.contributionId;
    stall.author = record.author;
    stall.createdAt = record.createdAt;
  });

  return [...map.values()].sort((a, b) => (
    a.canteenId.localeCompare(b.canteenId)
    || String(a.floor || 'zz').localeCompare(String(b.floor || 'zz'))
    || b.todayDishCount - a.todayDishCount
    || b.dishCount - a.dishCount
    || a.name.localeCompare(b.name)
  ));
}

/**
 * 同窗口 + 同一天 + 同名 的自选菜只保留最后上传的一条。
 * 高频上传时很常见：菜拍糊了重拍、或者一天传了两次同名菜，
 * 不去重的话抽签权重会被悄悄放大。
 */
function dedupeDaily(menu) {
  const lastIndexByKey = new Map();
  // 注意用 dish.date 而不是 dish.daily：daily 标记是在聚合阶段才算出来的，
  // 去重发生在此之前。
  const keyOf = (dish) => (
    dish.date && dish.stallName
      ? `${dish.canteenId}|${dish.floor || ''}|${dish.stallName}|${dish.date}|${dish.name}`
      : null
  );

  menu.dishes.forEach((dish, index) => {
    const key = keyOf(dish);
    if (key) lastIndexByKey.set(key, index);
  });

  const before = menu.dishes.length;
  menu.dishes = menu.dishes.filter((dish, index) => {
    const key = keyOf(dish);
    return !key || lastIndexByKey.get(key) === index;
  });
  menu.dedupedDailyCount = before - menu.dishes.length;
  return menu;
}

function recompute(menu) {
  dedupeDaily(menu);

  // 菜系聚合
  const cuisineMap = new Map(menu.taxonomy.cuisines.map((c) => [c.id, {
    ...c, dishCount: 0, dishIds: [], canteenIds: new Set(),
  }]));
  const canteenMap = new Map(menu.canteens.map((c) => [c.id, {
    ...c,
    floors: [], stallNames: new Set(), cuisines: new Set(),
    dishCount: 0, drawableDishCount: 0, drawWeight: 0, unassignedFloorDishCount: 0,
  }]));
  const floorMap = new Map();

  menu.dishes.forEach((dish) => {
    dish.priceTier = priceTierOf(dish.price);
    dish.daily = Boolean(dish.date);
    dish.isToday = !dish.daily || dish.date === menu.today;
    dish.stale = dish.daily && !dish.isToday;
    const canteen = canteenMap.get(dish.canteenId);
    if (!canteen) return;
    canteen.dishCount += 1;
    if (dish.stallName) canteen.stallNames.add(dish.stallName);
    dish.cuisines.forEach((id) => {
      canteen.cuisines.add(id);
      const cuisine = cuisineMap.get(id);
      if (cuisine) {
        cuisine.dishCount += 1;
        cuisine.dishIds.push(dish.id);
        cuisine.canteenIds.add(dish.canteenId);
      }
    });
    const drawable = dish.type !== 'stall_recommendation' && !dish.excludedByDefault;
    if (drawable) {
      canteen.drawableDishCount += 1;
      canteen.drawWeight += dish.drawWeight;
    }
    if (dish.floor) {
      const key = `${dish.canteenId}-${dish.floor.toLowerCase()}`;
      if (!floorMap.has(key)) {
        floorMap.set(key, {
          id: key, canteenId: dish.canteenId, floor: dish.floor,
          label: { '1F': '一层', '2F': '二层', '3F': '三层' }[dish.floor] || dish.floor,
          stallNames: new Set(), dishCount: 0, drawableDishCount: 0, drawWeight: 0,
        });
      }
      const floor = floorMap.get(key);
      floor.dishCount += 1;
      if (dish.stallName) floor.stallNames.add(dish.stallName);
      if (drawable) {
        floor.drawableDishCount += 1;
        floor.drawWeight += dish.drawWeight;
      }
    } else {
      canteen.unassignedFloorDishCount += 1;
    }
  });

  menu.canteens = [...canteenMap.values()].map((canteen) => {
    const declared = canteen.declaredFloors || [];
    const floors = [...floorMap.values()]
      .filter((f) => f.canteenId === canteen.id)
      .sort((a, b) => a.floor.localeCompare(b.floor))
      .map((f) => ({ ...f, stallNames: [...f.stallNames].sort() }));
    declared.forEach((floor) => {
      if (!floors.some((f) => f.floor === floor)) {
        floors.push({
          id: `${canteen.id}-${floor.toLowerCase()}`, canteenId: canteen.id, floor,
          label: { '1F': '一层', '2F': '二层', '3F': '三层' }[floor] || floor,
          stallNames: [], dishCount: 0, drawableDishCount: 0, drawWeight: 0,
        });
      }
    });
    return {
      ...canteen,
      floors: floors.sort((a, b) => a.floor.localeCompare(b.floor)),
      stallNames: [...canteen.stallNames].sort(),
      cuisines: [...canteen.cuisines].sort(),
      drawWeight: Number(canteen.drawWeight.toFixed(2)),
    };
  });

  menu.cuisines = [...cuisineMap.values()].map((cuisine) => ({
    ...cuisine,
    canteenIds: [...cuisine.canteenIds].sort(),
  }));

  const indexes = {
    byCanteen: {}, byFloor: {}, byCuisine: {}, byTag: {},
    byReviewLevel: {}, byPriceTier: {}, byMealSlot: {}, bySpicyLevel: {},
  };
  const push = (bucket, key, id) => {
    if (key == null) return;
    (bucket[key] = bucket[key] || []).push(id);
  };
  menu.dishes.forEach((dish) => {
    push(indexes.byCanteen, dish.canteenId, dish.id);
    push(indexes.byFloor, dish.floorId, dish.id);
    dish.cuisines.forEach((id) => push(indexes.byCuisine, id, dish.id));
    dish.tags.forEach((tag) => push(indexes.byTag, tag, dish.id));
    push(indexes.byReviewLevel, dish.reviewLevel, dish.id);
    push(indexes.byPriceTier, dish.priceTier, dish.id);
    dish.mealSlots.forEach((slot) => push(indexes.byMealSlot, slot, dish.id));
    push(indexes.bySpicyLevel, `L${dish.spicyLevel}`, dish.id);
  });
  menu.indexes = indexes;

  menu.stalls = deriveStalls(menu);

  const communityDishes = menu.dishes.filter((d) => d.origin === 'community').length;
  const dailyDishes = menu.dishes.filter((d) => d.daily);
  menu.meta = {
    ...menu.meta,
    stats: {
      ...(menu.meta?.stats || {}),
      dishCount: menu.dishes.length,
      canteenCount: menu.canteens.length,
      communityDishCount: communityDishes,
      stallCount: menu.stalls.length,
      dailyDishCount: dailyDishes.length,
      todayDailyDishCount: dailyDishes.filter((d) => d.isToday).length,
      dedupedDailyCount: menu.dedupedDailyCount || 0,
      contributionCount: menu.contributions.length,
      rejectedCount: menu.rejected.length,
    },
  };
  return menu;
}

/**
 * 把静态基础数据与线上贡献内容合成成前端使用的 Menu。
 * @param {object} base docs/assets/data/menu.json
 * @param {object[]} contributions 已解析的贡献内容数组
 */
export function buildMenu(base, contributions = [], { today = dateKey() } = {}) {
  const menu = {
    today,
    meta: { ...(base.meta || {}) },
    taxonomy: base.taxonomy,
    dishes: (base.dishes || []).map((d) => ({ origin: 'curated', ...d })),
    canteens: (base.canteens || []).map((c) => ({ origin: 'curated', ...c })),
    cuisines: [],
    indexes: {},
    draw: base.draw || {},
    stallRecords: [],
    stalls: [],
    contributions: [],
    rejected: [],
    builtAt: new Date().toISOString(),
  };

  // 先合并「新增饭堂」，再合并菜品/补充说明，这样菜品可以引用同批上传的新饭堂，
  // 结果与文件顺序无关（CI 重建索引时也用同一套逻辑）。
  const KIND_ORDER = { canteen: 0, stall: 1, dish: 2, note: 3 };
  contributions
    .filter((item) => item && typeof item === 'object' && !String(item.id || '').startsWith('_'))
    .slice()
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))
    .forEach((item) => {
      const result = validateContribution(item, menu);
      if (!result.ok) {
        menu.rejected.push({ id: item.id ?? '(无 id)', errors: result.errors });
        return;
      }
      applyContribution(menu, result.value);
      menu.contributions.push({
        id: result.value.id,
        kind: result.value.kind,
        author: result.value.author || '匿名同学',
        createdAt: result.value.createdAt || null,
      });
    });

  return recompute(menu);
}

/* ------------------------------------------------------------- 查询/筛选 */

/** 默认抽签池：排除窗口级推荐、差评与已停业 */
export function isDrawable(dish) {
  return dish.type !== 'stall_recommendation' && !dish.excludedByDefault;
}

/** 自选菜只在当天有效；常驻菜（没有 date）永远有效 */
export function isDishToday(dish, today = dateKey()) {
  return !dish.date || dish.date === today;
}

export function isDishStale(dish, today = dateKey()) {
  return Boolean(dish.date) && dish.date !== today;
}

/** 某个饭堂/楼层下的窗口（默认只列有菜或有照片的） */
export function stallsOf(menu, { canteenId = null, floor = undefined, withDishesOnly = false } = {}) {
  return (menu.stalls || []).filter((stall) => {
    if (canteenId && stall.canteenId !== canteenId) return false;
    if (floor !== undefined && floor !== null && stall.floor !== floor) return false;
    if (withDishesOnly && stall.dishCount === 0) return false;
    return true;
  });
}

/**
 * 统一的菜品筛选。视图层的每个筛选项都对应这里的一个字段，
 * 抽签和浏览共用同一套语义。
 */
export function filterDishes(menu, filters = {}) {
  const {
    canteenId = null, floor = undefined, cuisines = [], maxSpicyLevel = null,
    maxPrice = null, requirePrice = false, mealSlot = null, vegetarian = null,
    keyword = '', allowExcluded = false, includeStallRecommendations = false,
    labeledFloorsOnly = false, includePastDaily = false, onlyDaily = false,
    today = null,
  } = filters;
  const todayKey = today || menu.today || dateKey();

  const kw = String(keyword || '').trim();
  return menu.dishes.filter((dish) => {
    if (!allowExcluded && dish.excludedByDefault) return false;
    if (!includeStallRecommendations && dish.type === 'stall_recommendation') return false;
    // 自选菜天天变：默认只用「今天」上传的，往日的自动退场
    if (!includePastDaily && isDishStale(dish, todayKey)) return false;
    if (onlyDaily && !dish.daily) return false;
    if (canteenId && dish.canteenId !== canteenId) return false;
    if (floor !== undefined && floor !== null && dish.floor !== floor) return false;
    if (labeledFloorsOnly && !dish.floor) return false;
    if (cuisines.length && !cuisines.some((id) => dish.cuisines.includes(id))) return false;
    if (maxSpicyLevel != null && dish.spicyLevel > maxSpicyLevel) return false;
    if (vegetarian != null && dish.vegetarian !== vegetarian) return false;
    if (mealSlot && !dish.mealSlots.includes(mealSlot)) return false;
    if (requirePrice && dish.price?.min == null && dish.price?.max == null) return false;
    if (maxPrice != null) {
      const price = dish.price?.min ?? dish.price?.max;
      if (price != null && price > maxPrice) return false;
    }
    if (kw) {
      const hay = `${(dish.searchKeys || [dish.name]).join('|')}|${dish.reviewText || ''}`;
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

export function canteenById(menu) {
  return new Map(menu.canteens.map((c) => [c.id, c]));
}

export function cuisineById(menu) {
  return new Map(menu.cuisines.map((c) => [c.id, c]));
}

export function dishById(menu) {
  return new Map(menu.dishes.map((d) => [d.id, d]));
}

export function canteensWithPool(menu, filters = {}) {
  const pool = filterDishes(menu, filters);
  const counts = new Map();
  pool.forEach((dish) => counts.set(dish.canteenId, (counts.get(dish.canteenId) || 0) + 1));
  return menu.canteens
    .filter((canteen) => counts.has(canteen.id))
    .map((canteen) => ({ ...canteen, poolCount: counts.get(canteen.id) }));
}

/** 菜单健康检查：给管理台和构建流程用 */
export function auditMenu(menu) {
  const problems = [];
  const dishIds = new Set();
  menu.dishes.forEach((dish) => {
    if (dishIds.has(dish.id)) problems.push(`菜品 id 重复：${dish.id}`);
    dishIds.add(dish.id);
    if (!menu.canteens.some((c) => c.id === dish.canteenId)) {
      problems.push(`${dish.id} 指向不存在的饭堂 ${dish.canteenId}`);
    }
  });
  return {
    ok: problems.length === 0,
    problems,
    stats: menu.meta.stats,
  };
}
