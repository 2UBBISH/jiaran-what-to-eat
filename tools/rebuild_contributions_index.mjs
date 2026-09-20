#!/usr/bin/env node
/**
 * 重建 docs/assets/data/contributions/index.json
 * ---------------------------------------------------------------------------
 * 为什么需要它：GitHub Pages 是静态托管，没有目录列表接口，前端只能靠
 * index.json 知道有哪些贡献内容；但「在线上传内容」时同时去改 index.json
 * 会产生并发写冲突（两个人同时上传就撞车）。
 * 所以约定：上传者只写自己那一个文件，索引由 CI / 本地脚本重建。
 *
 * 用法：
 *   node tools/rebuild_contributions_index.mjs            # 写入 index.json
 *   node tools/rebuild_contributions_index.mjs --check    # 只检查是否最新（CI 用）
 *   node tools/rebuild_contributions_index.mjs --strict   # 有非法内容时退出码 1
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMenu, inspectContribution } from '../docs/assets/js/core/menu.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'docs/assets/data');
const CONTRIB_DIR = join(DATA_DIR, 'contributions');
const INDEX_PATH = join(CONTRIB_DIR, 'index.json');

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const STRICT = args.has('--strict');

async function main() {
  const base = JSON.parse(await readFile(join(DATA_DIR, 'menu.json'), 'utf8'));

  let names = [];
  if (existsSync(CONTRIB_DIR)) {
    names = (await readdir(CONTRIB_DIR))
      .filter((name) => name.endsWith('.json') && !name.startsWith('_') && name !== 'index.json')
      .sort();
  }

  const records = [];
  const broken = [];
  for (const name of names) {
    try {
      records.push({ name, record: JSON.parse(await readFile(join(CONTRIB_DIR, name), 'utf8')) });
    } catch (error) {
      broken.push({ file: name, errors: [`JSON 解析失败：${error.message}`] });
    }
  }

  // 先用「饭堂」类内容建一次菜单，再逐条摘要（这样裸接口格式也能解析出饭堂/窗口）
  const declared = records.filter((item) => item.record?.kind === 'canteen').map((item) => item.record);
  const menu = buildMenu(base, declared);

  const files = records.map(({ name, record }) => {
    const info = inspectContribution(record, menu);
    return {
      file: name,
      id: info.id,
      kind: info.kind,
      author: info.author,
      createdAt: info.createdAt,
      title: info.title,
      valid: info.ok,
      ...(info.ok ? {} : { errors: info.errors }),
    };
  }).concat(broken.map((item) => ({
    file: item.file, id: null, kind: null, author: null, createdAt: null,
    title: item.file, valid: false, errors: item.errors,
  })));

  const invalid = files.filter((item) => !item.valid);
  const summary = {
    count: files.length,
    invalidCount: invalid.length,
    validCount: files.length - invalid.length,
    files,
  };
  // 文件清单没变时保留旧的 generatedAt，否则每次 CI 都会产生一个无意义的机器人提交
  const existing = existsSync(INDEX_PATH)
    ? JSON.parse(await readFile(INDEX_PATH, 'utf8'))
    : null;
  const sameFiles = existing && JSON.stringify(existing.files) === JSON.stringify(files);
  const payload = {
    generatedAt: sameFiles ? existing.generatedAt : new Date().toISOString(),
    ...summary,
  };

  console.log(`扫描到 ${files.length} 个贡献文件（有效 ${payload.validCount}，无效 ${payload.invalidCount}）`);
  invalid.forEach((item) => console.log(`  ✗ ${item.file}: ${(item.errors || []).join('; ')}`));

  if (CHECK_ONLY) {
    if (!existsSync(INDEX_PATH)) {
      console.error('✗ index.json 不存在，请运行 node tools/rebuild_contributions_index.mjs');
      process.exit(1);
    }
    const current = JSON.parse(await readFile(INDEX_PATH, 'utf8'));
    const a = JSON.stringify((current.files || []).map((f) => f.file).sort());
    const b = JSON.stringify(files.map((f) => f.file).sort());
    if (a !== b) {
      console.error('✗ index.json 与 contributions 目录不一致，请重新生成');
      process.exit(1);
    }
    console.log('✓ index.json 是最新的');
  } else {
    const next = JSON.stringify(payload, null, 2) + '\n';
    const prev = existsSync(INDEX_PATH) ? await readFile(INDEX_PATH, 'utf8') : null;
    if (prev !== next) {
      await writeFile(INDEX_PATH, next, 'utf8');
      console.log(`✓ 已写入 ${INDEX_PATH.replace(`${ROOT}/`, '')}`);
    } else {
      console.log('✓ index.json 无变化');
    }
  }

  if (STRICT && invalid.length) {
    console.error(`✗ --strict：有 ${invalid.length} 个贡献文件未通过校验`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
