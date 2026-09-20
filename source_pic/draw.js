/**
 * 今天吃什么 · 抽签与菜系推荐（零依赖，可移植到微信小程序）
 * ---------------------------------------------------------------------------
 * 只依赖 source_pic/menu_data.js（或 menu_data.json）这份数据，不依赖任何平台 API，
 * 不含 wx.* / window.* 调用，可以直接复制进小程序包内使用。
 *
 *   const menu = require('./menu_data.js')
 *   const draw = require('./draw.js')
 *
 *   // 1) 今天吃什么：先抽饭堂，再抽楼层，再抽菜（同一 seed 结果可复现、可分享）
 *   const result = draw.drawMeal(menu, { seed: 20260920, maxSpicyLevel: 2 })
 *   // -> { canteen, floor, dish, poolSize, seed, explain }
 *
 *   // 2) 只想要某个饭堂 / 楼层
 *   draw.drawDish(menu, { canteenId: 'lan_yuan', floor: '3F' })
 *
 *   // 3) 菜系推荐：按菜系 + 预算排序
 *   draw.recommend(menu, { cuisines: ['sichuan', 'hotpot'], maxPrice: 25, limit: 5 })
 *
 * 说明：
 * - 默认排除 reviewLevel 为“差评 / 已停业”的菜品（excludedByDefault === true）
 *   以及 type === 'stall_recommendation' 的窗口级推荐记录。
 * - 抽签权重直接用数据里的 dish.drawWeight（来自帖子自带评价）。
 */
'use strict'

/* ------------------------------------------------------------------ 随机数 */

/** 把任意字符串/数字变成 32 位整数种子 */
function hashSeed (seed) {
  if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0
  var str = String(seed === undefined || seed === null ? Date.now() : seed)
  var h = 2166136261
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32：小巧的可复现伪随机数发生器，返回 [0,1) */
function createRng (seed) {
  var a = hashSeed(seed)
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    var t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* -------------------------------------------------------------- 数据预处理 */

/** 取菜品数组：兼容 menu_data.js 整体、{dishes:[]}、或直接是数组 */
function toDishList (menu) {
  if (Array.isArray(menu)) return menu
  if (menu && Array.isArray(menu.dishes)) return menu.dishes
  throw new Error('draw.js: 传入的数据里找不到 dishes 数组')
}

function toCanteenList (menu) {
  if (menu && Array.isArray(menu.canteens)) return menu.canteens
  return []
}

/** 该菜品最低价（用于预算过滤） */
function lowPrice (dish) {
  var p = dish.price || {}
  if (p.min != null) return p.min
  if (p.max != null) return p.max
  return null
}

/* ------------------------------------------------------------------ 过滤 */

/**
 * 按条件筛选候选菜品。
 * @param {object|Array} menu
 * @param {object} [opts]
 *   canteenId      {string}   限定饭堂
 *   floor          {string}   '1F' | '2F' | '3F'
 *   includeNoFloor {boolean}  true 时把未标注楼层的菜也算进某个楼层筛选结果
 *   cuisines       {string[]} 命中任一即可
 *   keyword        {string}   简单模糊匹配（菜名/别名/窗口）
 *   maxPrice       {number}   价格上限，按 price.min 判断
 *   requirePrice   {boolean}  true 时丢掉价格未记录的菜品（配合 maxPrice 更严谨）
 *   maxSpicyLevel  {number}   辣度上限 0-3
 *   mealSlot       {string}   breakfast/lunch/dinner/night/drink/dessert
 *   vegetarian     {boolean}  true 只要素 / false 只要荤 / 省略不限
 *   includeExcluded{boolean}  true 时把差评、已停业也纳入
 *   includeStallRecommendation {boolean} 是否纳入“（窗口整体推荐）”
 * @returns {object[]}
 */
function filterDishes (menu, opts) {
  opts = opts || {}
  var dishes = toDishList(menu)
  return dishes.filter(function (dish) {
    if (!opts.includeExcluded && dish.excludedByDefault) return false
    if (!opts.includeStallRecommendation && dish.type === 'stall_recommendation') return false
    if (opts.canteenId && dish.canteenId !== opts.canteenId) return false
    if (opts.floor) {
      var floorOk = dish.floor === opts.floor ||
        (opts.includeNoFloor === true && dish.floor == null)
      if (!floorOk) return false
    }
    if (opts.cuisines && opts.cuisines.length) {
      var hit = opts.cuisines.some(function (c) { return (dish.cuisines || []).indexOf(c) >= 0 })
      if (!hit) return false
    }
    if (opts.maxSpicyLevel != null && dish.spicyLevel > opts.maxSpicyLevel) return false
    if (opts.requirePrice && lowPrice(dish) == null) return false
    if (opts.maxPrice != null) {
      var price = lowPrice(dish)
      if (price != null && price > opts.maxPrice) return false
    }
    if (opts.mealSlot && (dish.mealSlots || []).indexOf(opts.mealSlot) < 0) return false
    if (opts.vegetarian != null && dish.vegetarian !== opts.vegetarian) return false
    if (opts.keyword) {
      var kw = String(opts.keyword)
      var hay = (dish.searchKeys || [dish.name]).join('|') + '|' + (dish.reviewText || '')
      if (hay.indexOf(kw) < 0) return false
    }
    return true
  })
}

/* ------------------------------------------------------------------ 抽签 */

function weightedPick (items, rng, weightOf) {
  if (!items.length) return null
  var total = 0
  var i
  for (i = 0; i < items.length; i++) total += Math.max(0, weightOf(items[i]))
  if (total <= 0) return items[Math.floor(rng() * items.length)]
  var r = rng() * total
  for (i = 0; i < items.length; i++) {
    r -= Math.max(0, weightOf(items[i]))
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * 抽一道菜。
 * @returns {{dish:object, poolSize:number, seed:*, explain:string}}
 */
function drawDish (menu, opts) {
  opts = opts || {}
  var pool = filterDishes(menu, opts)
  if (!pool.length) return { dish: null, poolSize: 0, seed: opts.seed, explain: '没有符合条件的菜品' }
  var rng = createRng(opts.seed === undefined ? Date.now() : opts.seed)
  var dish = weightedPick(pool, rng, function (d) { return d.drawWeight })
  return {
    dish: dish,
    poolSize: pool.length,
    seed: opts.seed === undefined ? null : opts.seed,
    explain: '从 ' + pool.length + ' 道候选里按评价权重抽出「' + dish.name + '」'
  }
}

/**
 * 抽一个饭堂（权重 = 该饭堂可抽菜品的权重之和，可按菜品数或均权调整）。
 */
function drawCanteen (menu, opts) {
  opts = opts || {}
  var candidates = toCanteenList(menu).filter(function (canteen) {
    if (opts.canteenIds && opts.canteenIds.indexOf(canteen.id) < 0) return false
    if (opts.category && canteen.category !== opts.category) return false
    if (!opts.includeDiscontinued && canteen.status === 'discontinued') return false
    var probe = filterDishes(menu, {
      canteenId: canteen.id,
      floor: opts.floor,
      cuisines: opts.cuisines,
      maxSpicyLevel: opts.maxSpicyLevel,
      maxPrice: opts.maxPrice,
      mealSlot: opts.mealSlot,
      vegetarian: opts.vegetarian
    })
    canteen.__pool = probe
    return probe.length > 0
  })
  if (!candidates.length) return { canteen: null, poolSize: 0, seed: opts.seed, explain: '没有符合条件的饭堂' }
  var rng = createRng(opts.seed === undefined ? Date.now() : opts.seed)
  var mode = opts.canteenWeight || 'dishWeight' // dishWeight | dishCount | uniform
  var picked = weightedPick(candidates, rng, function (canteen) {
    if (mode === 'uniform') return 1
    if (mode === 'dishCount') return canteen.__pool.length
    return canteen.__pool.reduce(function (sum, d) { return sum + d.drawWeight }, 0)
  })
  return {
    canteen: picked,
    poolSize: candidates.length,
    seed: opts.seed === undefined ? null : opts.seed,
    explain: '从 ' + candidates.length + ' 个饭堂里抽中「' + picked.name + '」'
  }
}

/**
 * 今天吃什么：饭堂 -> 楼层 -> 菜，一步到位。
 * 同一个 seed 会给出同样的结果，方便把“抽签结果”分享给同学复现。
 */
function drawMeal (menu, opts) {
  opts = opts || {}
  var seed = opts.seed === undefined ? Date.now() : opts.seed
  var canteenDraw = drawCanteen(menu, Object.assign({}, opts, { seed: seed + ':canteen' }))
  if (!canteenDraw.canteen) return { canteen: null, floor: null, dish: null, seed: seed, explain: canteenDraw.explain }

  var canteen = canteenDraw.canteen
  var floors = (canteen.floors || []).filter(function (f) { return f.dishCount > 0 })

  var floor = opts.floor || null
  if (!floor && floors.length && opts.drawFloor !== false) {
    var rng = createRng(seed + ':floor')
    floor = weightedPick(floors, rng, function (f) { return f.dishCount }).floor
  }

  var dishDraw = drawDish(menu, Object.assign({}, opts, {
    canteenId: canteen.id,
    floor: floor,
    seed: seed + ':dish'
  }))
  return {
    canteen: canteen,
    floor: floor,
    dish: dishDraw.dish,
    poolSize: dishDraw.poolSize,
    seed: seed,
    explain: '抽中「' + canteen.name + (floor ? ' · ' + floor : '') + '」的「' +
      (dishDraw.dish ? dishDraw.dish.name : '—') + '」'
  }
}

/* -------------------------------------------------------------- 菜系推荐 */

var TAG_BONUS = {
  '校内公认好吃': 2,
  '必点': 1.5,
  '性价比高': 0.8,
  '量大': 0.4,
  '清淡': 0.3
}
var TAG_PENALTY = {
  '偏贵': -1,
  '分量偏少': -0.8,
  '出品不稳定': -1,
  '偏咸': -0.4,
  '偏油': -0.3,
  '可能已撤出': -1.5,
  '不推荐': -5,
  '已停业': -5
}

function scoreDish (dish, opts) {
  var score = dish.drawWeight
  var reasons = []

  reasons.push('评价：' + dish.reviewLabel)

  if (opts.cuisines && opts.cuisines.length) {
    var hits = (dish.cuisines || []).filter(function (c) { return opts.cuisines.indexOf(c) >= 0 })
    if (hits.length) score += 2 * hits.length
  }
  ;(dish.tags || []).forEach(function (tag) {
    if (TAG_BONUS[tag]) { score += TAG_BONUS[tag]; reasons.push(tag) }
    if (TAG_PENALTY[tag]) { score += TAG_PENALTY[tag]; reasons.push(tag) }
  })

  var price = lowPrice(dish)
  if (opts.maxPrice != null && price != null) {
    score += Math.max(0, (opts.maxPrice - price) / opts.maxPrice) // 越便宜加分越多
    reasons.push('约 ' + price + ' 元')
  } else if (price != null) {
    reasons.push('约 ' + price + ' 元')
  }

  if (opts.maxSpicyLevel != null) {
    score += (opts.maxSpicyLevel - dish.spicyLevel) * 0.3
  }
  return { dish: dish, score: Math.round(score * 100) / 100, reasons: reasons }
}

/**
 * 菜系推荐：先按条件过滤，再打分排序。
 * @returns {Array<{dish:object, score:number, reasons:string[]}>}
 */
function recommend (menu, opts) {
  opts = opts || {}
  var pool = filterDishes(menu, opts)
  var ranked = pool.map(function (dish) { return scoreDish(dish, opts) })
  ranked.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score
    return String(a.dish.id).localeCompare(String(b.dish.id))
  })
  return opts.limit ? ranked.slice(0, opts.limit) : ranked
}

var api = {
  createRng: createRng,
  hashSeed: hashSeed,
  filterDishes: filterDishes,
  drawDish: drawDish,
  drawCanteen: drawCanteen,
  drawMeal: drawMeal,
  recommend: recommend,
  lowPrice: lowPrice
}

/* 小程序 / Node 用 require，浏览器里挂到全局 */
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof globalThis !== 'undefined') globalThis.TodayEatDraw = api
