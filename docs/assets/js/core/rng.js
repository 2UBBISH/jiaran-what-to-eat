/**
 * 可复现随机数（core 层，无任何 DOM / 平台依赖）
 * ---------------------------------------------------------------
 * 抽签要「可复现、可分享、可验证」，所以随机数必须由种子推导：
 *   同一个 seed + 同一份数据 + 同一组筛选 => 永远同一个结果。
 */

/** FNV-1a：把任意字符串/数字稳定地映射成 32 位无符号整数（种子/签号用） */
export function hashSeed(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0;
  const str = String(input ?? '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32：小巧、分布均匀、可复现的伪随机数发生器，返回 [0,1) */
export function createRng(seed) {
  let a = hashSeed(seed);
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成给用户看的「签号」，例如 A3F9K */
export function ticketOf(seed) {
  return hashSeed(seed).toString(36).toUpperCase().padStart(5, '0').slice(-5);
}

/** 加权抽一个（权重全为 0 时退化为等概率） */
export function pickWeighted(items, rng, weightOf) {
  if (!items.length) return null;
  let total = 0;
  for (const item of items) total += Math.max(0, weightOf(item));
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (const item of items) {
    r -= Math.max(0, weightOf(item));
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * 加权不放回抽 k 个（Efraimidis–Spirakis A-Res）
 * key = ln(u) / w，取最大的 k 个：权重越高越可能排在前面，且不会重复。
 */
export function pickWeightedMany(items, rng, weightOf, k) {
  const keyed = items.map((item) => {
    const w = Math.max(0, weightOf(item));
    const u = Math.max(rng(), Number.MIN_VALUE);
    return { item, key: w <= 0 ? -Infinity : Math.log(u) / w };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map((entry) => entry.item);
}

/**
 * 把池子里每项的权重与概率摊开——用于「概率透明」展示与测试。
 * 概率之和恒为 1（权重全 0 时退化为均匀分布）。
 */
export function poolWeights(items, weightOf) {
  const rows = items.map((item) => ({ item, weight: Math.max(0, weightOf(item)) }));
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  rows.forEach((row) => {
    row.probability = total > 0 ? row.weight / total : 1 / (items.length || 1);
  });
  return { total, rows };
}
