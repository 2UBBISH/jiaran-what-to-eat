#!/usr/bin/env node
/**
 * DOM 集成测试入口：分别在独立进程里跑 index.html 与 admin.html
 * ---------------------------------------------------------------------------
 * 安装依赖（仅本地需要）：
 *   mkdir -p .tmp-jsdom && cd .tmp-jsdom && npm init -y >/dev/null && npm install --cache ./.npm-cache jsdom
 * 运行：node tools/test_site_dom.mjs
 * 未安装 jsdom 时自动跳过并以 0 退出（CI 只跑 core 测试，不引入额外依赖）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSDOM = join(ROOT, '.tmp-jsdom/node_modules/jsdom/lib/api.js');

if (!existsSync(JSDOM)) {
  console.log('⚠️  跳过 DOM 测试：未安装 jsdom');
  console.log('   安装：cd .tmp-jsdom && npm install --cache ./.npm-cache jsdom');
  process.exit(0);
}

const suites = [
  'tools/dom/app.domtest.mjs',
  'tools/dom/admin.domtest.mjs',
  'tools/dom/motion.domtest.mjs',
  'tools/dom/upload.domtest.mjs',
  'tools/dom/subpath.domtest.mjs',
];
let failed = 0;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [join(ROOT, suite)], { stdio: 'inherit', cwd: ROOT });
  if (result.status !== 0) failed += 1;
}

console.log(`\n${failed === 0 ? '✓ 全部 DOM 测试通过' : `✗ ${failed} 个套件失败`}`);
process.exit(failed === 0 ? 0 : 1);
