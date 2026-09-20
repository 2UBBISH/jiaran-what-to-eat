/**
 * HTTP 数据源（给「换成真正的后端」留的接口）
 * ---------------------------------------------------------------------------
 * 与 GitHub 数据源实现同一契约，只是把读写换成 REST。后端只需要这几个端点：
 *   GET    {base}/menu                     -> menu.json 同结构（可含贡献内容）
 *   GET    {base}/contributions            -> [{ id, kind, author, createdAt, title, record? }]
 *   POST   {base}/contributions            -> 新增/覆盖一条（body: 记录 JSON）
 *   DELETE {base}/contributions/{id}       -> 删除
 *   POST   {base}/uploads                  -> multipart 上传图片，返回 { url }
 *   GET    {base}/health                   -> { ok, writable, detail }
 *
 * 前端其它部分完全不用改：在 data/index.js 注册后，界面里切换数据源即可。
 */

import { buildMenu } from '../core/menu.js';
import { assertContract, DataSourceError } from './contract.js';

export function createHttpSource({
  baseUrl = '/api',
  headers = {},
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
} = {}) {
  async function request(path, { method = 'GET', body, isForm = false } = {}) {
    if (!fetchImpl) throw new DataSourceError('当前环境没有 fetch', { code: 'no_fetch' });
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        ...headers,
        ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new DataSourceError(`后端返回 HTTP ${response.status}`, {
        code: 'http', hint: String(detail).slice(0, 200),
      });
    }
    if (response.status === 204) return null;
    const type = response.headers.get('content-type') || '';
    return type.includes('json') ? response.json() : response.text();
  }

  return assertContract({
    kind: 'http',
    capabilities: { read: true, write: true, upload: true, remove: true },

    async loadMenu() {
      const [base, contributions] = await Promise.all([
        request('/menu'),
        request('/contributions').catch(() => []),
      ]);
      const records = (contributions || []).map((item) => item.record || item).filter(Boolean);
      const menu = buildMenu(base, records);
      return {
        menu,
        meta: {
          source: 'http',
          baseUrl,
          contributionFiles: records.length,
          rejected: menu.rejected.length,
          fetchedAt: Date.now(),
        },
      };
    },

    async listContributions() {
      const list = await request('/contributions');
      return (list || []).map((item) => ({
        id: item.id,
        kind: item.kind,
        author: item.author || '匿名同学',
        createdAt: item.createdAt || null,
        title: item.title || item.id,
        path: `contributions/${item.id}`,
        record: item.record || item,
      }));
    },

    async saveContribution(record) {
      const result = await request('/contributions', { method: 'POST', body: record });
      return { ok: true, path: result?.path || `contributions/${record.id}`, url: result?.url || null };
    },

    async uploadImage(asset) {
      if (typeof FormData !== 'undefined' && asset.blob) {
        const form = new FormData();
        form.append('file', asset.blob, asset.name);
        const result = await request('/uploads', { method: 'POST', body: form, isForm: true });
        return { ok: true, path: result?.path || asset.name, url: result?.url };
      }
      const result = await request('/uploads', {
        method: 'POST',
        body: { name: asset.name, mime: asset.mime, base64: asset.base64 },
      });
      return { ok: true, path: result?.path || asset.name, url: result?.url };
    },

    async deleteContribution(id) {
      await request(`/contributions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return { ok: true };
    },

    async health() {
      try {
        const result = await request('/health');
        return {
          ok: Boolean(result?.ok ?? true),
          mode: 'http',
          writable: Boolean(result?.writable ?? true),
          detail: result?.detail || `已连接 ${baseUrl}`,
        };
      } catch (error) {
        return { ok: false, mode: 'http', writable: false, detail: error.message, hint: error.hint };
      }
    },
  });
}
