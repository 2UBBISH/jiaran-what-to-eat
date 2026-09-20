/**
 * 上传接入层（core，纯函数）
 * ---------------------------------------------------------------------------
 * 对外接口只要求五项：**饭菜图片 + 饭堂 + 楼层 + 窗口 + 价格**。
 * 这个模块把「其他 agent 随手写的 JSON」规范化成系统内部的贡献内容记录：
 *   - 字段名容错：canteen / canteenId / canteenName、window / stall / stallName、
 *     price / priceText、image / imageUrl / photo
 *   - 取值容错：楼层收 1F/一层/一楼/1，价格收 12 / "12" / "¥12" / "12-15"，
 *     菜系收 id 或中文名（「川菜」→ sichuan），辣度收 0-3 或「微辣」
 *   - 缺省补全：id、date（默认今天）、name（默认「自选菜」）、author
 *
 * 用法：
 *   const { records, errors } = normalizeIntakeBatch(inputs, menu)
 *   await source.saveMany(records, { images })
 */

import { dateKey, isDateKey } from './date.js';

export const INTAKE_SPEC = {
  version: 'v1',
  required: ['image', 'canteen', 'floor', 'window', 'price'],
  optional: ['name', 'date', 'cuisines', 'spicyLevel', 'reviewLabel', 'reviewText', 'tags', 'author', 'id'],
  aliases: {
    image: ['image', 'imageUrl', 'photo', 'photoUrl', 'pic'],
    canteen: ['canteen', 'canteenId', 'canteenName', 'hall'],
    floor: ['floor', 'floorId', 'floorLabel'],
    window: ['window', 'stall', 'stallName', 'counter'],
    price: ['price', 'priceText', 'cost'],
    name: ['name', 'dish', 'dishName', 'title'],
    date: ['date', 'day'],
    cuisines: ['cuisines', 'cuisine', 'cuisineIds'],
    spicyLevel: ['spicyLevel', 'spicy', 'spiciness'],
    reviewText: ['reviewText', 'review', 'note', 'comment'],
  },
};

const FLOOR_ALIASES = {
  '1f': '1F', 'f1': '1F', '1': '1F', '一层': '1F', '一楼': '1F', '1层': '1F', '1楼': '1F', 'b1': null,
  '2f': '2F', 'f2': '2F', '2': '2F', '二层': '2F', '二楼': '2F', '2层': '2F', '2楼': '2F',
  '3f': '3F', 'f3': '3F', '3': '3F', '三层': '3F', '三楼': '3F', '3层': '3F', '3楼': '3F',
  '': null, '-': null, '未标注': null, '未知': null, '无': null, 'none': null, 'null': null,
};

const SPICY_ALIASES = {
  0: 0, 1: 1, 2: 2, 3: 3,
  '0': 0, '1': 1, '2': 2, '3': 3,
  不辣: 0, 微辣: 1, 中辣: 2, 重辣: 3, 辣: 2, 很辣: 3,
};

function pick(input, field) {
  for (const key of INTAKE_SPEC.aliases[field] || [field]) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') return input[key];
  }
  return undefined;
}

function makeId(prefix = 'd') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${stamp}-${prefix}${Math.random().toString(36).slice(2, 7)}`;
}

/** 饭堂：接受 id 或中文名（大小写/空格不敏感） */
export function resolveCanteen(menu, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const canteens = menu?.canteens || [];
  const lower = raw.toLowerCase();
  return canteens.find((c) => c.id === raw)
    || canteens.find((c) => c.name === raw)
    || canteens.find((c) => c.name.toLowerCase() === lower)
    || canteens.find((c) => c.name.replace(/\s/g, '') === raw.replace(/\s/g, ''))
    || null;
}

/** 楼层：1F / 一层 / 一楼 / 1 都收 */
export function normalizeFloor(value) {
  if (value === undefined || value === null) return { ok: true, floor: null };
  const key = String(value).trim().toLowerCase();
  if (!(key in FLOOR_ALIASES)) return { ok: false, error: `楼层无法识别：${value}（可用 1F/2F/3F，或 一层/二层/三层）` };
  return { ok: true, floor: FLOOR_ALIASES[key] };
}

/** 菜系：接受 id 或中文名（含部分匹配） */
export function resolveCuisines(menu, value) {
  const list = value === undefined || value === null ? [] : (Array.isArray(value) ? value : [value]);
  const cuisines = menu?.taxonomy?.cuisines || [];
  const ids = [];
  const errors = [];
  list.forEach((item) => {
    const raw = String(item ?? '').trim();
    if (!raw) return;
    const exact = cuisines.find((c) => c.id === raw) || cuisines.find((c) => c.name === raw);
    if (exact) {
      ids.push(exact.id);
      return;
    }
    const partial = cuisines.filter((c) => c.name.includes(raw) || c.id.includes(raw.toLowerCase()));
    if (partial.length === 1) ids.push(partial[0].id);
    else if (partial.length > 1) errors.push(`菜系「${raw}」有歧义，请用 id：${partial.map((c) => c.id).join(' / ')}`);
    else errors.push(`菜系不存在：${raw}（可用 id 或中文名）`);
  });
  return { ids: [...new Set(ids)], errors };
}

/** 价格：12 / "12" / "¥12" / "12-15" / "10元以下" 都收（至少要能解析出数字） */
export function normalizePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ok: true, text: `¥${Number.isInteger(value) ? value : value.toFixed(1)}` };
  }
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, error: '缺少价格' };
  if (text.length > 60) return { ok: false, error: '价格文本过长' };
  if (!/\d/.test(text)) return { ok: false, error: `价格里没有数字：${text}（例：12 / ¥12 / 12-15 / 10元以下）` };
  return { ok: true, text };
}

/** 图片：接受 assets/uploads/xxx.jpg、https://…、data:image/…，或 {base64,name} */
export function normalizeImage(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const name = String(value.name || '').replace(/[^A-Za-z0-9._-]/g, '_') || `photo-${Date.now()}.jpg`;
    const base64 = String(value.base64 || '').replace(/^data:[^,]+,/, '');
    if (!base64) return { ok: false, error: 'image 对象缺少 base64' };
    return { ok: true, path: `assets/uploads/${name}`, asset: { name, base64, mime: value.mime || 'image/jpeg' } };
  }
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, error: '缺少饭菜图片' };
  if (text.startsWith('data:image/')) {
    const base64 = text.replace(/^data:[^,]+,/, '');
    return { ok: true, path: `assets/uploads/intake-${Date.now()}.jpg`, asset: { name: `intake-${Date.now()}.jpg`, base64, mime: 'image/jpeg' } };
  }
  if (/^https?:\/\//.test(text)) return { ok: true, path: text, asset: null };
  if (text.startsWith('assets/uploads/')) return { ok: true, path: text, asset: null };
  if (/^[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i.test(text)) {
    return { ok: true, path: `assets/uploads/${text}`, asset: null };
  }
  return { ok: false, error: `图片地址无法识别：${text}（用 assets/uploads/xxx.jpg、https://…、data:image/…，或 {base64,name}）` };
}

/**
 * 规范化单条上传（对外接口的主入口）。
 * @returns {{ok:boolean, errors:string[], record?:object, assets:object[]}}
 */
export function normalizeIntake(input, menu, { today = dateKey(), author = '匿名同学' } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['内容不是合法的 JSON 对象'], assets: [] };
  }

  const canteen = resolveCanteen(menu, pick(input, 'canteen'));
  if (!canteen) {
    const names = (menu?.canteens || []).map((c) => c.name).join('、');
    errors.push(`饭堂无法识别：${pick(input, 'canteen') ?? '(缺失)'}（可用中文名或 id；现有：${names}）`);
  }

  const floorResult = normalizeFloor(pick(input, 'floor'));
  if (!floorResult.ok) errors.push(floorResult.error);

  const windowName = String(pick(input, 'window') ?? '').trim();
  if (!windowName) errors.push('缺少窗口（window，例如「自选窗口」）');
  else if (windowName.length > 40) errors.push('窗口名过长（≤40 字）');

  const priceResult = normalizePrice(pick(input, 'price'));
  if (!priceResult.ok) errors.push(priceResult.error);

  const imageResult = normalizeImage(pick(input, 'image'));
  if (!imageResult.ok) errors.push(imageResult.error);

  const cuisineResult = resolveCuisines(menu, pick(input, 'cuisines'));
  errors.push(...cuisineResult.errors);

  const rawDate = pick(input, 'date');
  const date = rawDate === undefined ? today : String(rawDate);
  if (!isDateKey(date)) errors.push(`date 需为 YYYY-MM-DD：${date}`);

  const rawSpicy = pick(input, 'spicyLevel');
  let spicyLevel = 0;
  if (rawSpicy !== undefined) {
    const key = typeof rawSpicy === 'string' ? rawSpicy.trim() : rawSpicy;
    if (!(key in SPICY_ALIASES)) errors.push(`辣度无法识别：${rawSpicy}（可用 0-3 或 不辣/微辣/中辣/重辣）`);
    else spicyLevel = SPICY_ALIASES[key];
  }

  const name = String(pick(input, 'name') ?? '').trim() || '自选菜';
  if (name.length > 40) errors.push('菜名过长（≤40 字）');
  const reviewText = pick(input, 'reviewText');
  if (reviewText != null && String(reviewText).length > 400) errors.push('评价最多 400 字');

  if (errors.length) return { ok: false, errors, assets: [] };

  const record = {
    id: String(pick(input, 'id') || makeId('d')),
    kind: 'dish',
    createdAt: new Date().toISOString(),
    author: String(pick(input, 'author') || author),
    payload: {
      canteenId: canteen.id,
      floor: floorResult.floor,
      stallName: windowName,
      name,
      unnamed: !pick(input, 'name'), // 没给菜名时按图片去重，避免多张照片被当成同一道菜
      priceText: priceResult.text,
      cuisines: cuisineResult.ids,
      spicyLevel,
      tags: Array.isArray(input.tags) ? input.tags : [],
      reviewLabel: input.reviewLabel || '好评',
      reviewText: reviewText != null ? String(reviewText) : null,
      image: imageResult.path,
      date,
      mealSlots: ['lunch', 'dinner'],
      vegetarian: null,
    },
  };

  return { ok: true, errors: [], record, assets: imageResult.asset ? [imageResult.asset] : [] };
}

/**
 * 批量规范化：逐条返回成功/失败，互不影响（一个坏输入不会毁掉整批）。
 * @returns {{records:object[], assets:object[], failed:Array<{index:number, errors:string[]}>}}
 */
export function normalizeIntakeBatch(inputs, menu, options = {}) {
  const list = Array.isArray(inputs) ? inputs : (inputs?.records || inputs?.items || []);
  const records = [];
  const assets = [];
  const failed = [];
  list.forEach((input, index) => {
    const result = normalizeIntake(input, menu, options);
    if (result.ok) {
      records.push(result.record);
      assets.push(...result.assets);
    } else {
      failed.push({ index, errors: result.errors });
    }
  });
  return { records, assets, failed };
}
