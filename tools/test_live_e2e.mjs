#!/usr/bin/env node
/**
 * 线上 E2E：把已部署的站点整包抓下来，用同一套 DOM 用例跑一遍
 * ---------------------------------------------------------------------------
 * 为什么要这样测：GitHub Pages 是静态托管，本地跑通不代表线上跑通
 * （常见坑：base path 子路径、文件没进产物、MIME 不对、部署的是旧版本）。
 * 这个脚本抓的是线上真实字节，所以能覆盖上述问题。
 *
 * 用法：
 *   node tools/test_live_e2e.mjs                          # 默认线上地址
 *   node tools/test_live_e2e.mjs https://user.github.io/repo/
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const TMP = join(ROOT, '.tmp-live');
const BASE = (process.argv[2] || 'https://2ubbish.github.io/jiaran-what-to-eat/').replace(/\/?$/, '/');
const BASE_URL = new URL(BASE);
const BASE_PATH = BASE_URL.pathname.endsWith('/') ? BASE_URL.pathname : `${BASE_URL.pathname}/`;

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** 递归列出本地 docs/ 下的文件（作为线上抓取的清单） */
function walkFiles(dir, base = dir, out = []) {
  readdirSync(dir).forEach((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, base, out);
    else out.push(relative(base, full).split('\\').join('/'));
  });
  return out.sort();
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
    }
  }
  throw lastError;
}

async function main() {
  console.log(`线上 E2E：${BASE}`);
  console.log(`（站点基础路径 ${BASE_PATH}）\n`);

  // 0) 可达性
  const probe = await fetchWithRetry(BASE).catch((error) => ({ ok: false, status: 0, error }));
  if (!probe.ok) {
    console.error(`✗ 线上站点不可访问（HTTP ${probe.status || '-'}）`);
    process.exit(1);
  }

  // 1) 下载部署产物
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  const target = join(TMP, 'docs');
  mkdirSync(target, { recursive: true });

  // 线上真实上传的内容（本地 docs/ 里没有）：按线上索引把贡献文件与图片也抓下来，
  // 这样「部署产物副本」与线上完全一致，DOM 用例才跑的是真实数据。
  const liveIndex = await fetchWithRetry(`${BASE}assets/data/contributions/index.json?t=${Date.now()}`)
    .then((response) => (response.ok ? response.json() : { files: [] }))
    .catch(() => ({ files: [] }));
  const contributionFiles = (liveIndex.files || [])
    .filter((item) => item.valid !== false)
    .map((item) => `assets/data/contributions/${item.file}`);

  const imageFiles = [];
  const contributionRecords = [];
  for (const path of contributionFiles) {
    const response = await fetchWithRetry(BASE + path).catch(() => null);
    if (!response || !response.ok) continue;
    const record = await response.json().catch(() => null);
    if (!record) continue;
    contributionRecords.push(record);
    const image = record.payload?.image || record.image;
    if (typeof image === 'string' && image.startsWith('assets/')) imageFiles.push(image);
  }

  const localFiles = walkFiles(DOCS).filter((name) => name !== '.nojekyll');
  const remoteOnly = [...new Set([...contributionFiles, ...imageFiles])]
    .filter((name) => !localFiles.includes(name));
  const files = [...localFiles, ...remoteOnly];
  const concurrency = 8;
  const results = [];
  for (let i = 0; i < files.length; i += concurrency) {
    const slice = files.slice(i, i + concurrency);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(slice.map(async (name) => {
      const response = await fetchWithRetry(BASE + name).catch(() => null);
      if (!response || !response.ok) {
        results.push({ name, status: response?.status ?? 0, ok: false });
        return;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const out = join(target, name);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, buffer);
      const localHash = sha(readFileSync(join(DOCS, name)));
      results.push({ name, status: response.status, ok: true, same: sha(buffer) === localHash });
    }));
  }

  const missing = results.filter((r) => !r.ok);
  const differs = results.filter((r) => r.ok && !r.same);
  console.log(`抓取 ${results.length} 个文件：成功 ${results.length - missing.length}，失败 ${missing.length}`);
  console.log(`其中线上上传的内容：${contributionFiles.length} 条记录 + ${imageFiles.length} 张图片`
    + (remoteOnly.length ? `（本地没有、仅线上有：${remoteOnly.length} 个）` : ''));
  if (missing.length) {
    missing.slice(0, 8).forEach((r) => console.log(`  ✗ ${r.name}: HTTP ${r.status}`));
  }
  const onlyIndex = differs.length > 0
    && differs.every((r) => r.name === 'assets/data/contributions/index.json');
  if (onlyIndex) {
    console.log('ℹ️  本地 contributions/index.json 落后于线上（该文件由 CI 维护，属正常）');
  } else if (differs.length) {
    console.log(`⚠️  与本地不一致 ${differs.length} 个（线上可能是旧版本，或本地有未推送的改动）：`);
    differs.slice(0, 8).forEach((r) => console.log(`  · ${r.name}`));
  }
  if (!missing.length && !differs.length) {
    console.log('✓ 线上产物与本地逐字节一致（含线上上传的内容）');
  }
  console.log('');

  // 1.5) 线上内容体检：能合并成菜、图片真的可取
  if (contributionFiles.length) {
    const { buildMenu } = await import(new URL(`file://${join(target, 'assets/js/core/menu.js')}`).href);
    const base = JSON.parse(readFileSync(join(target, 'assets/data/menu.json'), 'utf8'));
    const menu = buildMenu(base, contributionRecords);
    const imagesOk = [];
    for (const image of new Set(imageFiles)) {
      const response = await fetchWithRetry(BASE + image).catch(() => null);
      imagesOk.push({ image, status: response?.status ?? 0, type: response?.headers.get('content-type') || '' });
    }
    const badImages = imagesOk.filter((item) => item.status !== 200 || !item.type.startsWith('image/'));
    console.log(`线上上传内容体检：合并出 ${menu.meta.stats.communityDishCount} 道菜，`
      + `窗口 ${menu.meta.stats.stallCount} 个，图片 ${imagesOk.length} 张`);
    if (menu.rejected.length) {
      console.log(`  ⚠️ 有 ${menu.rejected.length} 条被校验拒绝：${JSON.stringify(menu.rejected).slice(0, 160)}`);
    }
    if (badImages.length) {
      badImages.forEach((item) => console.log(`  ✗ 图片取不到：${item.image}（HTTP ${item.status} ${item.type}）`));
      process.exit(1);
    }
    console.log('  ✓ 每条内容都能合并进菜单，引用的图片全部可取');
  }

  // 2) 用抓下来的真实产物跑 DOM 用例
  const suites = [
    'tools/dom/app.domtest.mjs',
    'tools/dom/admin.domtest.mjs',
    'tools/dom/motion.domtest.mjs',
    'tools/dom/upload.domtest.mjs',
    'tools/dom/subpath.domtest.mjs',
  ];
  let failed = 0;
  for (const suite of suites) {
    console.log(`=== 线上产物 · ${suite} ===`);
    const result = spawnSync(process.execPath, [join(ROOT, suite)], {
      stdio: 'inherit',
      cwd: ROOT,
      env: { ...process.env, TSC_DOCS_ROOT: target, TSC_BASE_PATH: BASE_PATH },
    });
    if (result.status !== 0) failed += 1;
  }

  console.log(`\n${failed === 0 ? '✓ 线上 E2E 全部通过' : `✗ ${failed} 个套件失败`}`);
  if (missing.length) {
    console.log(`✗ 有 ${missing.length} 个文件在线上缺失`);
    process.exit(1);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
