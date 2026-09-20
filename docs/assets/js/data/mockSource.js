/**
 * Mock 数据源：读静态数据 + 把「上传」写进 localStorage
 * ---------------------------------------------------------------------------
 * 用途：
 *   - 本地开发 / 演示，没有 GitHub Token 也能把「在线上传内容」的完整流程跑通
 *   - 前端测试：写操作可断言
 * 与线上行为一致：写入的记录同样走 core/menu.js 的校验与合成。
 */

import { buildMenu } from '../core/menu.js';
import { assertContract, sequentialBatch, uploadPathFor } from './contract.js';
import { KEYS, getJSON, setJSON } from './local.js';

export function createMockSource({ baseMenu = null, baseLoader = null, fetchImpl, baseUrl = 'assets/data/', storageKey = KEYS.mockContributions } = {}) {
  function readAll() {
    const records = getJSON(storageKey, []);
    return Array.isArray(records) ? records : [];
  }

  function writeAll(records) {
    setJSON(storageKey, records);
  }

  async function loadBase() {
    if (baseMenu) return baseMenu;
    if (typeof baseLoader === 'function') return baseLoader();
    const response = await fetchImpl(new URL(`${baseUrl}menu.json`, location.href), { cache: 'no-cache' });
    return response.json();
  }

  return assertContract({
    kind: 'mock',
    capabilities: { read: true, write: true, upload: true, remove: true, batch: true },

    async loadMenu() {
      const baseMenu = await loadBase();
      const records = readAll();
      const menu = buildMenu(baseMenu, records);
      return {
        menu,
        meta: {
          source: 'mock',
          version: baseMenu?.meta?.version || null,
          generatedAt: baseMenu?.meta?.generatedAt || null,
          contributionFiles: records.length,
          rejected: menu.rejected.length,
          fetchedAt: Date.now(),
          note: '本地演示数据源：上传只保存在这台设备的 localStorage，不会影响线上',
        },
      };
    },

    async listContributions() {
      return readAll().map((record) => ({
        id: record.id,
        kind: record.kind,
        author: record.author || '匿名同学',
        createdAt: record.createdAt || null,
        title: record.payload?.name || record.payload?.text || record.id,
        path: `(localStorage) ${record.id}`,
        record,
      }));
    },

    async saveContribution(record) {
      const records = readAll().filter((item) => item.id !== record.id);
      records.push(record);
      writeAll(records);
      return { ok: true, path: `localStorage:${record.id}`, url: null, commit: null };
    },

    async uploadImage(asset) {
      // Mock 模式不落盘，直接把压缩后的 dataURL 内联在记录里
      return { ok: true, path: `inline:${asset.name}`, url: asset.dataUrl, commit: null };
    },

    async saveMany(records, { images = [] } = {}) {
      // 本机演示没有「提交」概念，直接写入；把约定路径换成内联 dataURL 以便直接显示
      const inline = new Map(images.map((asset) => [uploadPathFor(asset), asset.dataUrl]));
      const results = [];
      for (const record of records) {
        const next = { ...record, payload: { ...record.payload } };
        if (next.payload.image && inline.has(next.payload.image)) {
          next.payload.image = inline.get(next.payload.image);
        }
        results.push(await this.saveContribution(next));
      }
      return { ok: true, commit: null, batched: true, results };
    },

    async uploadImages(assets) {
      const results = assets.map((asset) => ({
        ok: true,
        name: asset.name,
        path: `inline:${asset.name}`,
        url: asset.dataUrl,
      }));
      return { ok: true, commit: null, batched: true, results };
    },

    async deleteContribution(id) {
      const records = readAll();
      const next = records.filter((item) => item.id !== id);
      writeAll(next);
      return { ok: next.length !== records.length };
    },

    async health() {
      return {
        ok: true,
        mode: 'mock',
        writable: true,
        detail: `本地演示数据源，已保存 ${readAll().length} 条上传内容（仅本机可见）`,
      };
    },
  });
}
