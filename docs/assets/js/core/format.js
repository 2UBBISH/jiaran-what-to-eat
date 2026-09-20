/** 展示层格式化（纯函数） */

const SPICY_LABELS = ['不辣', '微辣', '中辣', '重辣'];

export function spicyLabel(level) {
  return SPICY_LABELS[Math.max(0, Math.min(3, Number(level) || 0))];
}

/** 把结构化 price 渲染成人话 */
export function formatPrice(price) {
  if (!price) return '价格未记录';
  const { text, min, max, approx, uncertain, openEnded, note } = price;
  let out;
  if (min == null && max == null) {
    out = text ? '价格未记录' : '价格未记录';
  } else if (openEnded) {
    out = `${min} 元起`;
  } else if (min == null) {
    out = `${max} 元以下`;
  } else if (max == null || min === max) {
    out = `${min} 元`;
  } else {
    out = `${min}-${max} 元`;
  }
  const marks = [];
  if (approx) marks.push('约');
  if (uncertain) marks.push('待确认');
  if (note) marks.push(note);
  return marks.length ? `${out} · ${marks.join(' / ')}` : out;
}

/** 价格徽章用的短文本，例如 ¥18 / ¥20-30 */
export function priceBadge(price) {
  if (!price) return null;
  const { min, max, openEnded } = price;
  if (min == null && max == null) return null;
  if (openEnded) return `¥${min}+`;
  if (min == null) return `<¥${max}`;
  if (max == null || min === max) return `¥${min}`;
  return `¥${min}-${max}`;
}

export function floorLabel(floor) {
  if (!floor) return '楼层未标注';
  return { '1F': '一层', '2F': '二层', '3F': '三层' }[floor] || floor;
}

export function mealSlotLabel(slot) {
  return {
    breakfast: '早餐', lunch: '午餐', dinner: '晚餐',
    night: '夜宵', drink: '饮品', dessert: '甜品',
  }[slot] || slot;
}

export function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRelative(ts, now = Date.now()) {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return formatTime(ts).slice(0, 10);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function byteSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
