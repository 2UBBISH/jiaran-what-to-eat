/**
 * 数据源契约（前后端分离的边界）
 * ---------------------------------------------------------------------------
 * 视图层只依赖这个契约，不认识 fetch / GitHub / localStorage。
 * 想换后端（GitHub API -> 自建 REST / Supabase / 云函数）时：
 *   1. 新写一个 createXxxSource()，实现下面 6 个方法
 *   2. 在 data/index.js 的工厂里注册
 * 视图代码一行都不用改。
 *
 * 契约方法：
 *   kind                                  数据源标识（static / mock / github / http）
 *   capabilities                          { read, write, upload, remove }
 *   loadMenu()                            -> { menu, meta }
 *   listContributions()                   -> [{ id, kind, author, createdAt, path, title }]
 *   saveContribution(record, options)     -> { ok, path, url, commit }
 *   uploadImage(asset, options)           -> { ok, path, url }
 *   deleteContribution(id, options)       -> { ok }
 *   health()                              -> { ok, mode, writable, detail }
 */

export class DataSourceError extends Error {
  constructor(message, { code = 'datasource_error', hint = '', cause = null } = {}) {
    super(message);
    this.name = 'DataSourceError';
    this.code = code;
    this.hint = hint;
    this.cause = cause;
  }
}

const REQUIRED_METHODS = [
  'loadMenu', 'listContributions', 'saveContribution', 'uploadImage', 'deleteContribution', 'health',
];

/** 启动时自检，避免「少写一个方法」在用户点击时才炸 */
export function assertContract(source) {
  const missing = REQUIRED_METHODS.filter((name) => typeof source?.[name] !== 'function');
  if (missing.length) {
    throw new DataSourceError(`数据源 ${source?.kind || '(未命名)'} 缺少方法：${missing.join(', ')}`);
  }
  return source;
}

/** 只读数据源在写操作时统一抛这个，UI 据此提示「切换到可写数据源」 */
export function readOnly(method) {
  return new DataSourceError(`当前数据源是只读的，不能执行 ${method}`, {
    code: 'read_only',
    hint: '到「内容管理」页把数据源切换为 GitHub 或 Mock，即可在线上传内容',
  });
}

export const CONTRACT_SUMMARY = [
  { method: 'loadMenu()', desc: '拉取基础数据 + 线上贡献内容，合成前端使用的 Menu' },
  { method: 'listContributions()', desc: '列出全部已上传内容（管理台用）' },
  { method: 'saveContribution(record)', desc: '新增一条内容（菜品 / 饭堂 / 补充说明）' },
  { method: 'uploadImage(asset)', desc: '上传图片（已在前端压缩为 base64/multipart）' },
  { method: 'deleteContribution(id)', desc: '删除一条内容' },
  { method: 'health()', desc: '连通性与可写性自检' },
];
