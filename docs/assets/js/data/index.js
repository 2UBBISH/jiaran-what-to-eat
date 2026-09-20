/**
 * 数据源工厂（唯一需要改动的装配点）
 * ---------------------------------------------------------------------------
 * 界面只调用 createDataSource(config)，拿到的一定是满足 contract.js 的实现：
 *   static -> 线上默认，只读静态 JSON（GitHub Pages 零成本方案）
 *   mock   -> 本地演示，可写（localStorage），无需 Token
 *   github -> 把仓库当后端，可写可上传图片（线上真实的内容管理）
 *   http   -> 自建 REST 后端，可写可上传
 * 配置存在 localStorage，管理台里可以随时切换，刷新即生效。
 */

import { createStaticSource } from './staticSource.js';
import { createMockSource } from './mockSource.js';
import { createGitHubSource } from './githubSource.js';
import { createHttpSource } from './httpSource.js';
import { DataSourceError } from './contract.js';
import { KEYS, getJSON, setJSON } from './local.js';

export const SOURCE_MODES = [
  {
    id: 'static',
    name: '静态数据（只读）',
    desc: '直接读 docs/assets/data/*.json，GitHub Pages 默认方案，零成本、可被 CDN 缓存',
    writes: false,
  },
  {
    id: 'mock',
    name: '本地演示（可写）',
    desc: '上传内容保存在这台设备的 localStorage，用来完整演示上传流程，不影响线上',
    writes: true,
  },
  {
    id: 'github',
    name: 'GitHub 仓库（可写，线上推荐）',
    desc: '用 fine-grained Token 调 Contents API 提交内容，无需服务器，合并后自动触发 Pages 重新部署',
    writes: true,
  },
  {
    id: 'http',
    name: '自建 REST 后端（可写）',
    desc: '把数据源换成自己的服务，端点约定见 httpSource.js',
    writes: true,
  },
];

export function defaultConfig() {
  return {
    mode: 'static',
    github: {
      owner: '', repo: '', branch: 'main',
      dataDir: 'docs/assets/data',
      uploadDir: 'docs/assets/uploads',
      token: '',
    },
    http: { baseUrl: '/api', headers: {} },
  };
}

export function loadConfig() {
  const saved = getJSON(KEYS.dataSource, null);
  const base = defaultConfig();
  if (!saved || typeof saved !== 'object') return base;
  return {
    ...base,
    ...saved,
    github: { ...base.github, ...(saved.github || {}) },
    http: { ...base.http, ...(saved.http || {}) },
  };
}

export function saveConfig(config) {
  setJSON(KEYS.dataSource, config);
  return config;
}

/** 只保留非敏感信息用于展示（Token 只显示后 4 位） */
export function describeConfig(config) {
  const gh = config.github || {};
  const masked = gh.token ? `····${String(gh.token).slice(-4)}` : '（未填写）';
  return {
    mode: config.mode,
    github: `${gh.owner || '?'}/${gh.repo || '?'}@${gh.branch || 'main'} · Token ${masked}`,
    http: config.http?.baseUrl || '-',
  };
}

export function createDataSource(config = loadConfig(), { staticBase } = {}) {
  const mode = config?.mode || 'static';
  switch (mode) {
    case 'static':
      return createStaticSource({ baseUrl: staticBase || 'assets/data/' });
    case 'mock':
      return createMockSource({
        baseLoader: async () => {
          const response = await fetch(new URL(staticBase || 'assets/data/menu.json', location.href), { cache: 'no-cache' });
          if (!response.ok) throw new DataSourceError(`读取静态菜单失败：HTTP ${response.status}`, { code: 'http' });
          return response.json();
        },
      });
    case 'github':
      return createGitHubSource(config.github || {});
    case 'http':
      return createHttpSource(config.http || {});
    default:
      throw new DataSourceError(`未知的数据源模式：${mode}`, {
        code: 'unknown_mode',
        hint: `可选值：${SOURCE_MODES.map((m) => m.id).join(' / ')}`,
      });
  }
}

export { DataSourceError } from './contract.js';
