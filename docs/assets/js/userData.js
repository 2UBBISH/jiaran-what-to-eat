/**
 * 本机用户数据：抽签历史、收藏、筛选偏好
 * ---------------------------------------------------------------------------
 * 这些是「用户私有的、只存在本机」的数据，和内容数据（走数据源）严格分开：
 *   - 抽签历史 -> 用于「避开最近吃过的」和饭堂均衡（喂给 core/lottery 的 recent* 参数）
 *   - 收藏     -> 只做展示与小幅加权
 *   - 筛选偏好 -> 记住用户上次的选择
 */

import { KEYS, getJSON, setJSON, remove } from './data/local.js';

const HISTORY_LIMIT = 60;

export function loadHistory() {
  const list = getJSON(KEYS.history, []);
  return Array.isArray(list) ? list : [];
}

export function recordDraw(result) {
  if (!result?.ok) return loadHistory();
  const entry = {
    ts: Date.now(),
    seed: result.seed,
    ticket: result.ticket,
    canteenId: result.canteen.id,
    canteenName: result.canteen.name,
    floor: result.floor,
    cuisineId: result.cuisine?.id || null,
    cuisineName: result.cuisine?.name || null,
    dishIds: result.dishes.map((dish) => dish.id),
    primaryDishId: result.dishes[0]?.id || null,
    eaten: false,
  };
  const next = [entry, ...loadHistory()].slice(0, HISTORY_LIMIT);
  setJSON(KEYS.history, next);
  return next;
}

/** 「今天就吃这个」：把最近一次抽签标记为已吃，方便以后回看 */
export function markEaten(ticket) {
  const list = loadHistory();
  const target = list.find((entry) => entry.ticket === ticket) || list[0];
  if (target) target.eaten = true;
  setJSON(KEYS.history, list);
  return list;
}

export function clearHistory() {
  remove(KEYS.history);
  return [];
}

/** 最近 N 次抽到的菜品/饭堂，用于冷却与均衡（去重后返回） */
export function recentContext(window = 5) {
  const recent = loadHistory().slice(0, window);
  const dishIds = [];
  recent.forEach((entry) => {
    (entry.dishIds || []).forEach((id) => { if (!dishIds.includes(id)) dishIds.push(id); });
  });
  return {
    recentDishIds: dishIds,
    recentCanteenIds: recent.map((entry) => entry.canteenId),
    recent,
  };
}

export function loadFavorites() {
  const list = getJSON(KEYS.favorites, []);
  return Array.isArray(list) ? list : [];
}

export function toggleFavorite(dishId) {
  const list = loadFavorites();
  const index = list.indexOf(dishId);
  if (index >= 0) list.splice(index, 1);
  else list.unshift(dishId);
  setJSON(KEYS.favorites, list);
  return list;
}

export function isFavorite(dishId) {
  return loadFavorites().includes(dishId);
}

export function loadSettings() {
  return {
    maxSpicyLevel: null,
    maxPrice: null,
    cuisines: [],
    avoidRecent: true,
    labeledFloorsOnly: false,
    ...getJSON(KEYS.settings, {}),
  };
}

export function saveSettings(settings) {
  setJSON(KEYS.settings, settings);
  return settings;
}

export function stats() {
  const history = loadHistory();
  const dishCounts = new Map();
  const canteenCounts = new Map();
  history.forEach((entry) => {
    (entry.dishIds || []).forEach((id) => dishCounts.set(id, (dishCounts.get(id) || 0) + 1));
    canteenCounts.set(entry.canteenName, (canteenCounts.get(entry.canteenName) || 0) + 1);
  });
  return {
    totalDraws: history.length,
    firstTs: history.length ? history[history.length - 1].ts : null,
    favorites: loadFavorites().length,
    topCanteens: [...canteenCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}
