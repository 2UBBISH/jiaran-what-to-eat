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
 *   saveMany(records, { images })         -> { ok, commit, results }
 *        批量新增内容；可同时带上 images（照片），实现应尽量「内容+图片」一次提交
 *   uploadImages(assets, options)         -> { ok, commit, results }   （批量图片，一次提交）
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
  'loadMenu', 'listContributions', 'saveContribution', 'uploadImage',
  'saveMany', 'uploadImages', 'deleteContribution', 'health',
];

/**
 * 上传图片的路径约定（前端与各数据源共用）。
 * 上传前就能算出最终地址，所以「内容 + 图片」可以在同一次提交里完成。
 */
export function uploadPathFor(asset) {
  const safe = String(asset?.name || 'photo.jpg').replace(/[^A-Za-z0-9._-]/g, '_');
  return `assets/uploads/${safe}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 批量能力的默认实现：逐个调用单项方法。
 * 能一次提交多个文件的实现（如 githubSource 用 Git Data API）应覆盖它，
 * 这样「一次上传 5 张自选菜照片」只产生 1 个 commit。
 */
export function sequentialBatch(source, method) {
  const single = method === 'saveMany' ? 'saveContribution' : 'uploadImage';
  return async (items, options = {}) => {
    const results = [];
    for (const item of items) {
      results.push(await source[single](item, options));
    }
    return {
      ok: true,
      commit: null,
      batched: false,
      results,
    };
  };
}

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
  { method: 'saveMany(records, {images})', desc: '批量新增内容（可同时提交图片，一次上传只产生一个 commit）' },
  { method: 'uploadImages(assets)', desc: '批量上传图片（自选菜高频上传用）' },
  { method: 'deleteContribution(id)', desc: '删除一条内容' },
  { method: 'health()', desc: '连通性与可写性自检' },
];
