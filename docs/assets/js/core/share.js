/**
 * 签号 / 分享链接编解码（core，纯函数）
 * ---------------------------------------------------------------------------
 * GitHub Pages 是纯静态站，没有服务端存结果，所以「分享一次抽签结果」的思路是：
 * 只把 seed 和筛选条件编进链接，对方打开后本地重算 —— 结果必然一模一样。
 *
 * 编码格式（全部 URL 安全字符，可读、可手改）：
 *   v1.<seed36>.<cuisines|->.<maxSpicy|->.<maxPrice|->.<labeledOnly 0|1>.<mealSlot|->
 * 例：v1.1f3k9z.sichuan+hotpot.2.25.0.-
 */

import { SHARE_TITLE } from '../brand.js';

export const SHARE_VERSION = 'v1';

function encodeCuisines(cuisines = []) {
  return cuisines.length ? cuisines.join('+') : '-';
}

function decodeCuisines(value) {
  if (!value || value === '-') return [];
  return value.split('+').map((s) => s.trim()).filter(Boolean);
}

/** 从抽签结果生成分享码 */
export function encodeShare(result) {
  if (!result?.seed) return null;
  const filters = result.filters || {};
  const parts = [
    SHARE_VERSION,
    Number(result.seed).toString(36),
    encodeCuisines(filters.cuisines || []),
    filters.maxSpicyLevel == null ? '-' : String(filters.maxSpicyLevel),
    filters.maxPrice == null ? '-' : String(filters.maxPrice),
    filters.labeledFloorsOnly ? '1' : '0',
    filters.mealSlot || '-',
  ];
  return parts.join('.');
}

/** 解析分享码 -> 抽签选项；非法返回 null */
export function decodeShare(code) {
  if (typeof code !== 'string') return null;
  const parts = code.trim().split('.');
  if (parts.length < 2 || parts[0] !== SHARE_VERSION) return null;
  const seed = parseInt(parts[1], 36);
  if (!Number.isFinite(seed)) return null;
  const spicy = parts[3];
  const price = parts[4];
  return {
    seed,
    cuisines: decodeCuisines(parts[2]),
    maxSpicyLevel: spicy == null || spicy === '-' ? null : Number(spicy),
    maxPrice: price == null || price === '-' ? null : Number(price),
    labeledFloorsOnly: parts[5] === '1',
    mealSlot: parts[6] && parts[6] !== '-' ? parts[6] : null,
  };
}

/** 结果页的 hash 路由，例如 #/r?k=v1.1f3k9z.sichuan.2.25.0.- */
export function hashForResult(result) {
  const code = encodeShare(result);
  return code ? `#/r?k=${encodeURIComponent(code)}` : '#/draw';
}

/** 从 location.hash 里取出抽签选项 */
export function optionsFromHash(hash) {
  const raw = String(hash || '');
  const queryIndex = raw.indexOf('?');
  if (queryIndex < 0) return null;
  const params = new URLSearchParams(raw.slice(queryIndex + 1));
  const code = params.get('k');
  return code ? decodeShare(code) : null;
}

/** 分享文案（小程序/微信/复制都能用） */
export function buildShareText(result, options = {}) {
  if (!result?.ok) return '';
  const { url } = options;
  const lines = [
    SHARE_TITLE,
    `🎯 饭堂：${result.canteen?.name || '—'}${result.floor ? ` · ${result.floorLabel}` : ''}`,
  ];
  if (result.cuisine) lines.push(`🍜 推送菜系：${result.cuisine.emoji || ''}${result.cuisine.name}`);
  if (result.dishes?.length) {
    lines.push(`🍽 推荐：${result.dishes.slice(0, 3).map((dish) => dish.name).join('、')}`);
  }
  lines.push(`🎫 签号：${result.ticket}`);
  if (url) lines.push(`点开抽到同一份：${url}`);
  return lines.join('\n');
}
