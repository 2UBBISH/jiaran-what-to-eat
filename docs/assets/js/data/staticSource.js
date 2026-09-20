/**
 * 静态数据源：直接读 docs/assets/data/（GitHub Pages 上的静态 JSON）
 * ---------------------------------------------------------------------------
 * 这是线上默认的数据源 —— 只读、零成本、可被 CDN 缓存。
 * 目录里同时有构建期生成的 menu.json 和线上累积的 contributions/*.json，
 * 两者在 core/menu.js 里合成。
 */

import { buildMenu } from '../core/menu.js';
import { assertContract, DataSourceError, readOnly } from './contract.js';

const DEFAULT_BASE = 'assets/data/';

export function createStaticSource({
  baseUrl = DEFAULT_BASE,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  cacheBust = true,
} = {}) {
  const bust = (url) => (cacheBust ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url);

  async function getJSON(path, { required = true } = {}) {
    if (!fetchImpl) throw new DataSourceError('当前环境没有 fetch', { code: 'no_fetch' });
    const url = bust(new URL(path, new URL(baseUrl, location?.href || 'http://localhost/')).href);
    let response;
    try {
      response = await fetchImpl(url, { cache: 'no-cache' });
    } catch (error) {
      throw new DataSourceError(`读取 ${path} 失败：${error.message}`, {
        code: 'network', cause: error, hint: '检查网络，或确认 GitHub Pages 已部署成功',
      });
    }
    if (!response.ok) {
      if (!required && response.status === 404) return null;
      throw new DataSourceError(`读取 ${path} 失败：HTTP ${response.status}`, { code: 'http', hint: url });
    }
    try {
      return await response.json();
    } catch (error) {
      throw new DataSourceError(`${path} 不是合法 JSON`, { code: 'parse', cause: error });
    }
  }

  async function loadContributions() {
    const index = await getJSON('contributions/index.json', { required: false });
    const files = Array.isArray(index?.files) ? index.files : [];
    const records = await Promise.all(files.map(async (file) => {
      const name = typeof file === 'string' ? file : file?.file;
      if (!name || name.startsWith('_')) return null;
      try {
        return await getJSON(`contributions/${name}`, { required: false });
      } catch (error) {
        console.warn('[static] 跳过损坏的贡献内容', name, error.message);
        return null;
      }
    }));
    return records.filter(Boolean);
  }

  return assertContract({
    kind: 'static',
    capabilities: { read: true, write: false, upload: false, remove: false, batch: false },

    async loadMenu() {
      const [manifest, base, contributions] = await Promise.all([
        getJSON('manifest.json', { required: false }),
        getJSON('menu.json'),
        loadContributions(),
      ]);
      const menu = buildMenu(base, contributions);
      return {
        menu,
        meta: {
          source: 'static',
          version: manifest?.version || base?.meta?.version || null,
          generatedAt: base?.meta?.generatedAt || null,
          contributionFiles: contributions.length,
          rejected: menu.rejected.length,
          fetchedAt: Date.now(),
        },
      };
    },

    async listContributions() {
      const records = await loadContributions();
      return records.filter(Boolean).map((record) => ({
        id: record.id,
        kind: record.kind,
        author: record.author || '匿名同学',
        createdAt: record.createdAt || null,
        title: record.payload?.name || record.payload?.title || record.payload?.text || record.id,
        path: `contributions/${record.id}.json`,
        record,
      }));
    },

    async saveContribution() { throw readOnly('上传内容'); },
    async uploadImage() { throw readOnly('上传图片'); },
    async saveMany() { throw readOnly('批量上传内容'); },
    async uploadImages() { throw readOnly('批量上传图片'); },
    async deleteContribution() { throw readOnly('删除内容'); },

    async health() {
      try {
        const manifest = await getJSON('manifest.json', { required: false });
        return {
          ok: Boolean(manifest),
          mode: 'static',
          writable: false,
          detail: manifest
            ? `静态数据 v${manifest.version}（${manifest.stats?.dishCount ?? '?'} 道菜），只读`
            : '找不到 manifest.json，请先运行 tools/build_menu_data.py',
        };
      } catch (error) {
        return { ok: false, mode: 'static', writable: false, detail: error.message };
      }
    },
  });
}
