/**
 * 日期工具（core，纯函数）
 * ---------------------------------------------------------------------------
 * 「今天的自选菜」必须按**本地日期**判断：用 UTC 的话北京时间早上 8 点才翻篇，
 * 食堂午饭时段会算错一天。抽签的「每日固定签」也用同一套。
 */

export function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDate(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + days);
  return dateKey(date.getTime());
}

/** 0=今天，1=昨天，2=前天…（用于展示「昨天的自选」） */
export function daysAgo(key, today = dateKey()) {
  const toUTC = (k) => {
    const [y, m, d] = String(k).split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  return Math.round((toUTC(today) - toUTC(key)) / 86400000);
}

export function dateLabel(key, today = dateKey()) {
  if (!key) return '';
  const diff = daysAgo(key, today);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  if (diff > 0) return `${diff} 天前`;
  return String(key).slice(5);
}

/** 校验 YYYY-MM-DD */
export function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
