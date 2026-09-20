/** 本地存储小工具（带降级：隐私模式 / 非浏览器环境不报错） */

function memoryFallback() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function pickStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__tsc_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch (error) {
    // 隐私模式 / 禁用存储：退化为内存
  }
  return memoryFallback();
}

const store = pickStorage();

export function getJSON(key, fallback = null) {
  try {
    const raw = store.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

export function setJSON(key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

export function remove(key) {
  try {
    store.removeItem(key);
    return true;
  } catch (error) {
    return false;
  }
}

export const KEYS = {
  dataSource: 'tsc:datasource',
  history: 'tsc:history',
  favorites: 'tsc:favorites',
  settings: 'tsc:settings',
  mockContributions: 'tsc:mock:contributions',
};
