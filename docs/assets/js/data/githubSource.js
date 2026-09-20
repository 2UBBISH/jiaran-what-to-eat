/**
 * GitHub 数据源（把仓库当作后端）
 * ---------------------------------------------------------------------------
 * GitHub Pages 没有服务端，但仓库本身就是可写的存储：
 *   - 读：raw.githubusercontent.com（走 CDN，无需 Token）
 *   - 写：GitHub Contents API（需要 fine-grained Token，权限只勾 Contents: Read and write）
 *   - 上传图片：把压缩后的图片提交到 docs/assets/uploads/
 *
 * 这样「在线上传内容」不需要任何服务器，前端与数据/存储彻底分离；
 * 将来换成自建后端，只要实现同一个契约（见 httpSource.js）。
 */

import { buildMenu } from '../core/menu.js';
import { assertContract, DataSourceError, sleep, uploadPathFor } from './contract.js';

const API_ROOT = 'https://api.github.com';
const RAW_ROOT = 'https://raw.githubusercontent.com';

/** UTF-8 字符串 -> base64（不用已废弃的 unescape） */
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function createGitHubSource({
  token,
  owner,
  repo,
  branch = 'main',
  dataDir = 'docs/assets/data',
  uploadDir = 'docs/assets/uploads',
  maxUploadBytes = 2 * 1024 * 1024,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
} = {}) {
  const configured = Boolean(token && owner && repo);

  function assertConfigured() {
    if (!configured) {
      throw new DataSourceError('GitHub 数据源未配置完整', {
        code: 'not_configured',
        hint: '需要在「内容管理」里填写 owner / repo / branch 与 Token',
      });
    }
    if (!fetchImpl) throw new DataSourceError('当前环境没有 fetch', { code: 'no_fetch' });
  }

  async function api(path, { method = 'GET', body = null, raw = false } = {}) {
    assertConfigured();
    const response = await fetchImpl(`${API_ROOT}/repos/${owner}/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw mapError(response.status, detail, { method, path });
    }
    if (raw) return response.text();
    if (response.status === 204) return null;
    return response.json();
  }

  function rawUrl(path) {
    return `${RAW_ROOT}/${owner}/${repo}/${branch}/${path}?t=${Date.now()}`;
  }

  async function readRaw(path, { required = true } = {}) {
    const response = await fetchImpl(rawUrl(path), { cache: 'no-cache' });
    if (!response.ok) {
      if (!required && response.status === 404) return null;
      throw mapError(response.status, path, { method: 'GET(raw)', path });
    }
    return response.json();
  }

  async function listDir(dir) {
    try {
      const entries = await api(`/contents/${dir}?ref=${encodeURIComponent(branch)}`);
      return Array.isArray(entries) ? entries : [];
    } catch (error) {
      if (error.code === 'not_found') return [];
      throw error;
    }
  }

  async function putFile(path, { message, contentBase64, sha = null }) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await api(`/contents/${path}`, {
          method: 'PUT',
          body: { message, content: contentBase64, branch, ...(sha ? { sha } : {}) },
        });
      } catch (error) {
        lastError = error;
        // 409/422 通常是并发写入导致 sha 过期：重新取 sha 再试一次
        if (error.code === 'conflict' && attempt < 2) {
          sha = await shaOf(path);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * 用 Git Data API 一次提交多个文件（blobs -> tree -> commit -> 更新分支）。
   * 为什么不用 Contents API 循环：那样 N 张照片会变成 N 个 commit，
   * 高频上传自选菜照片时提交历史会被刷爆。
   */
  async function commitFiles(files, { message } = {}) {
    assertConfigured();
    if (!files.length) return { ok: true, commit: null, url: null, files: [] };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const ref = await api(`/git/ref/heads/${encodeURIComponent(branch)}`);
        const parentSha = ref.object.sha;
        const parent = await api(`/git/commits/${parentSha}`);

        const blobs = await Promise.all(files.map(async (file) => {
          const blob = await api('/git/blobs', {
            method: 'POST',
            body: { content: file.base64, encoding: 'base64' },
          });
          return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
        }));

        const tree = await api('/git/trees', {
          method: 'POST',
          body: { base_tree: parent.tree.sha, tree: blobs },
        });
        const commit = await api('/git/commits', {
          method: 'POST',
          body: {
            message: message || `content: update ${files.length} file(s)`,
            tree: tree.sha,
            parents: [parentSha],
          },
        });
        await api(`/git/refs/heads/${encodeURIComponent(branch)}`, {
          method: 'PATCH',
          body: { sha: commit.sha, force: false },
        });
        return {
          ok: true,
          batched: true,
          commit: commit.sha,
          url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
          files: files.map((file) => file.path),
        };
      } catch (error) {
        // 并发提交会让分支指针前移：重新取 ref 再试
        const retriable = error.code === 'conflict' || error.code === 'not_found';
        if (retriable && attempt < 3) {
          await sleep(320 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
    throw new DataSourceError('批量提交多次冲突，请稍后重试', { code: 'conflict' });
  }

  async function shaOf(path) {
    try {
      const meta = await api(`/contents/${path}?ref=${encodeURIComponent(branch)}`);
      return meta?.sha || null;
    } catch (error) {
      if (error.code === 'not_found') return null;
      throw error;
    }
  }

  return assertContract({
    kind: 'github',
    capabilities: { read: true, write: true, upload: true, remove: true, batch: true },
    config: { owner, repo, branch, dataDir, uploadDir },
    commitFiles,

    async loadMenu() {
      assertConfigured();
      const [base, entries] = await Promise.all([
        readRaw(`${dataDir}/menu.json`).catch(async () => {
          // raw 可能被 CDN 缓存阻塞时退回 API 读取
          const meta = await api(`/contents/${dataDir}/menu.json?ref=${encodeURIComponent(branch)}`, { raw: true });
          return JSON.parse(meta);
        }),
        listDir(`${dataDir}/contributions`),
      ]);
      const files = entries.filter((entry) => entry.type === 'file'
        && entry.name.endsWith('.json')
        && !entry.name.startsWith('_')
        && entry.name !== 'index.json');
      const records = (await Promise.all(files.map(async (file) => {
        try {
          const text = await api(`/contents/${file.path}?ref=${encodeURIComponent(branch)}`, { raw: true });
          return JSON.parse(text);
        } catch (error) {
          console.warn('[github] 跳过读取失败的贡献内容', file.name, error.message);
          return null;
        }
      }))).filter(Boolean);

      const menu = buildMenu(base, records);
      return {
        menu,
        meta: {
          source: 'github',
          version: base?.meta?.version || null,
          generatedAt: base?.meta?.generatedAt || null,
          contributionFiles: records.length,
          rejected: menu.rejected.length,
          fetchedAt: Date.now(),
          repo: `${owner}/${repo}@${branch}`,
        },
      };
    },

    async listContributions() {
      const entries = (await listDir(`${dataDir}/contributions`))
        .filter((entry) => entry.type === 'file'
          && entry.name.endsWith('.json')
          && !entry.name.startsWith('_')
          && entry.name !== 'index.json');
      const records = await Promise.all(entries.map(async (entry) => {
        try {
          const text = await api(`/contents/${entry.path}?ref=${encodeURIComponent(branch)}`, { raw: true });
          const record = JSON.parse(text);
          return {
            id: record.id,
            kind: record.kind,
            author: record.author || '匿名同学',
            createdAt: record.createdAt || null,
            title: record.payload?.name || record.payload?.text || record.id,
            path: entry.path.replace(`${dataDir}/contributions/`, 'contributions/'),
            sha: entry.sha,
            record,
          };
        } catch (error) {
          console.warn('[github] 读取失败', entry.name, error.message);
          return null;
        }
      }));
      return records.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    async saveContribution(record, { message } = {}) {
      const path = `${dataDir}/contributions/${record.id}.json`;
      const sha = await shaOf(path);
      const payload = utf8ToBase64(JSON.stringify(record, null, 2) + '\n');
      const result = await putFile(path, {
        message: message || `content: add ${record.kind} ${record.id}`,
        contentBase64: payload,
        sha,
      });
      return {
        ok: true,
        path,
        url: result?.content?.html_url || null,
        commit: result?.commit?.html_url || null,
        created: !sha,
      };
    },

    async uploadImage(asset, { message } = {}) {
      if (!asset?.base64) {
        throw new DataSourceError('图片内容为空', { code: 'bad_asset' });
      }
      const bytes = Math.floor((asset.base64.length * 3) / 4);
      if (bytes > maxUploadBytes) {
        throw new DataSourceError(`图片约 ${(bytes / 1024 / 1024).toFixed(1)}MB，超过 ${(maxUploadBytes / 1024 / 1024).toFixed(1)}MB 上限`, {
          code: 'too_large',
          hint: '上传前会自动压缩，若仍超限请手动裁剪',
        });
      }
      const safeName = asset.name.replace(/[^A-Za-z0-9._-]/g, '_');
      const path = `${uploadDir}/${safeName}`;
      const sha = await shaOf(path);
      const result = await putFile(path, {
        message: message || `content: upload image ${safeName}`,
        contentBase64: asset.base64,
        sha,
      });
      const publicUrl = `assets/uploads/${safeName}`;
      return { ok: true, path, url: publicUrl, rawUrl: result?.content?.download_url || null };
    },

    /**
     * 批量新增内容；带 images 时把照片和 JSON 放进**同一个 commit**。
     * 前端已经把 payload.image 写成 uploadPathFor(asset) 约定的路径，
     * 所以这里直接按同样的路径提交图片即可。
     */
    async saveMany(records, { images = [], message } = {}) {
      const imageFiles = images.map((asset) => ({
        path: `${uploadDir}/${uploadPathFor(asset).split('/').pop()}`,
        base64: asset.base64,
      }));
      const recordFiles = records.map((record) => ({
        path: `${dataDir}/contributions/${record.id}.json`,
        base64: utf8ToBase64(JSON.stringify(record, null, 2) + '\n'),
      }));
      const result = await commitFiles([...imageFiles, ...recordFiles], {
        message: message || `content: add ${records.length} entr${records.length > 1 ? 'ies' : 'y'}`
          + (images.length ? ` + ${images.length} photo(s)` : ''),
      });
      return {
        ok: true,
        commit: result.url,
        batched: true,
        results: recordFiles.map((file) => ({ ok: true, path: file.path, url: result.url })),
      };
    },

    async uploadImages(assets, { message } = {}) {
      const oversized = assets.find((asset) => Math.floor((asset.base64.length * 3) / 4) > maxUploadBytes);
      if (oversized) {
        throw new DataSourceError(`「${oversized.name}」超过 ${(maxUploadBytes / 1024 / 1024).toFixed(1)}MB 上限`, {
          code: 'too_large',
        });
      }
      const files = assets.map((asset) => ({
        path: `${uploadDir}/${asset.name.replace(/[^A-Za-z0-9._-]/g, '_')}`,
        base64: asset.base64,
      }));
      const result = await commitFiles(files, {
        message: message || `content: upload ${assets.length} image(s)`,
      });
      return {
        ok: true,
        commit: result.url,
        batched: true,
        results: files.map((file, index) => ({
          ok: true,
          name: assets[index].name,
          path: file.path,
          url: `assets/uploads/${file.path.split('/').pop()}`,
        })),
      };
    },

    async deleteContribution(id, { message } = {}) {
      const path = `${dataDir}/contributions/${id}.json`;
      const sha = await shaOf(path);
      if (!sha) return { ok: false, reason: 'not_found' };
      await api(`/contents/${path}`, {
        method: 'DELETE',
        body: { message: message || `content: remove ${id}`, sha, branch },
      });
      return { ok: true };
    },

    async health() {
      if (!configured) {
        return { ok: false, mode: 'github', writable: false, detail: '尚未填写完整配置（owner / repo / Token）' };
      }
      try {
        const repoInfo = await api('');
        const canWrite = Boolean(repoInfo?.permissions?.push);
        return {
          ok: true,
          mode: 'github',
          writable: canWrite,
          detail: `${repoInfo.full_name}@${repoInfo.default_branch} · ${canWrite ? '可写入' : 'Token 无写入权限（需要 Contents: Read and write）'}`,
          defaultBranch: repoInfo.default_branch,
        };
      } catch (error) {
        return { ok: false, mode: 'github', writable: false, detail: error.message, hint: error.hint };
      }
    },
  });
}

function mapError(status, detail, context) {
  const short = String(detail || '').slice(0, 200);
  if (status === 401) {
    return new DataSourceError('GitHub Token 无效或已过期', {
      code: 'unauthorized', hint: '重新生成 fine-grained Token，权限勾选 Contents: Read and write',
    });
  }
  if (status === 403) {
    return new DataSourceError('GitHub 拒绝访问（权限不足或触发限流）', {
      code: 'forbidden', hint: short || '确认 Token 勾选了该仓库的 Contents 写权限',
    });
  }
  if (status === 404) {
    return new DataSourceError(`找不到资源：${context.path}`, {
      code: 'not_found', hint: '确认 owner / repo / branch 正确，且仓库已推送',
    });
  }
  if (status === 409 || status === 422) {
    return new DataSourceError(`写入冲突或校验失败（HTTP ${status}）`, { code: 'conflict', hint: short });
  }
  return new DataSourceError(`GitHub API 返回 HTTP ${status}`, { code: 'http', hint: short });
}
