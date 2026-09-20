/**
 * DOM 测试公共设施：jsdom 环境 + 断言脚手架
 * ---------------------------------------------------------------------------
 * 为什么按「一进程一页面」拆：ES 模块在 Node 里只实例化一次，而 data/local.js
 * 会在首次使用时绑定当前 window 的 localStorage。若在同一个进程里先跑
 * index.html 再跑 admin.html，两个 jsdom realm 会共用同一份模块缓存。
 * 因此每个页面各自一个子进程（见 tools/test_site_dom.mjs）。
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DOCS = join(ROOT, 'docs');
const JSDOM_API = join(ROOT, '.tmp-jsdom/node_modules/jsdom/lib/api.js');

export async function loadJsdom() {
  if (!existsSync(JSDOM_API)) return null;
  const module = await import(pathToFileURL(JSDOM_API).href);
  return module.JSDOM;
}

/** 用本地文件系统当静态服务器，喂给前端的 fetch */
export function installFetchShim() {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string'
      ? input
      : (input instanceof URL ? input.href : input?.url);
    const { pathname } = new URL(url, 'http://localhost/');
    const file = join(DOCS, decodeURIComponent(pathname));
    if (!file.startsWith(DOCS) || !existsSync(file)) {
      return new Response('not found', { status: 404 });
    }
    const type = pathname.endsWith('.json') ? 'application/json' : 'text/plain';
    return new Response(readFileSync(file), { status: 200, headers: { 'content-type': type } });
  };
}

/** 建一个带浏览器全局变量的 jsdom 环境 */
export async function createEnvironment(JSDOM, htmlFile, hash = '#/draw') {
  const dom = new JSDOM(readFileSync(join(DOCS, htmlFile), 'utf8'), {
    url: `http://localhost/${hash}`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // 动画瞬间完成，测试才快而稳
  window.matchMedia = (query) => ({
    matches: /reduce/.test(query),
    media: query,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  });

  // Node 24 里 navigator/location 等是只读全局，统一用 defineProperty 覆盖
  const define = (name, value) => {
    try {
      globalThis[name] = value;
    } catch (error) {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
  };
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('location', window.location);
  define('localStorage', window.localStorage);
  define('HTMLElement', window.HTMLElement);
  define('Node', window.Node);
  define('Image', window.Image);
  define('URL', window.URL);
  define('Blob', window.Blob);
  define('matchMedia', window.matchMedia);
  define('requestAnimationFrame', window.requestAnimationFrame.bind(window));
  define('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
  installFetchShim();

  Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async () => {} },
    configurable: true,
  });

  return { dom, window };
}

export const q = (window, selector) => window.document.querySelector(selector);
export const qa = (window, selector) => [...window.document.querySelectorAll(selector)];
export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** 断言脚手架：返回 { test, section, finish } */
export function createSuite() {
  let passed = 0;
  const failures = [];
  return {
    section: (title) => console.log(`\n${title}`),
    async test(name, fn) {
      try {
        await fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
      } catch (error) {
        failures.push({ name, error });
        console.log(`  ✗ ${name}\n      ${String(error.message).split('\n')[0]}`);
      }
    },
    finish() {
      console.log(`\n${passed} passed, ${failures.length} failed`);
      if (failures.length) {
        console.log('\n失败详情:');
        failures.forEach((f) => console.log(`\n[${f.name}]\n${f.error.stack}`));
        process.exit(1);
      }
    },
  };
}

export { assert };
