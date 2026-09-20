/**
 * 部署布局测试：站点挂在子路径（https://<user>.github.io/<repo>/）下时，
 * 数据与资源路径必须仍然解析正确 —— 这是 GitHub Pages 项目站最容易踩的坑。
 * （本地 http://localhost/ 根路径跑不出这个问题，所以单独一个用例。）
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSuite, loadJsdom, DOCS, ROOT } from './harness.mjs';

const JSDOM = await loadJsdom();
if (!JSDOM) {
  console.log('⚠️  跳过：未安装 jsdom');
  process.exit(0);
}

const SUB = '/jiaran-what-to-eat/';
const BASE = `https://2ubbish.github.io${SUB}`;
const suite = createSuite();

suite.section('部署布局（子路径）');

await suite.test('子路径下抽签与推送菜系页面正常渲染', async () => {
  const dom = new JSDOM(readFileSync(join(DOCS, 'index.html'), 'utf8'), {
    url: BASE,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.matchMedia = (query) => ({
    matches: /reduce/.test(query), media: query,
    addEventListener() {}, removeEventListener() {},
  });

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
  define('matchMedia', window.matchMedia);
  define('URL', window.URL);
  define('Image', window.Image);
  define('HTMLElement', window.HTMLElement);
  define('Node', window.Node);
  define('Blob', window.Blob);
  define('requestAnimationFrame', window.requestAnimationFrame.bind(window));

  const requested = [];
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input?.url);
    const { pathname } = new URL(url);
    requested.push(pathname);
    if (!pathname.startsWith(SUB)) {
      return new Response('outside base path', { status: 404 });
    }
    const file = join(DOCS, pathname.slice(SUB.length));
    if (!existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await import(pathToFileURL(join(DOCS, 'assets/js/app.js')).href);
  await new Promise((resolve) => setTimeout(resolve, 150));

  const q = (selector) => window.document.querySelector(selector);
  assert0(q('.view--draw'), '抽签视图没渲染');
  assert0(q('.stage__pool')?.textContent.includes('候选'), `菜单数据没加载：${q('.stage__meta')?.textContent || ''}`);

  q('.stage__actions .btn--primary').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert0(q('.push__name')?.textContent.trim(), '推送菜系没渲染');
  assert0(/^[0-9A-Z]{5}$/.test(q('.ticket__value')?.textContent || ''), '签号缺失');

  // 所有请求都必须带子路径前缀，否则线上会 404
  const bad = requested.filter((path) => !path.startsWith(SUB));
  assert0(bad.length === 0, `有请求没带子路径前缀：${bad.join(', ')}`);
  console.log(`      （请求了 ${new Set(requested).size} 个资源，全部带 ${SUB} 前缀）`);
});

function assert0(condition, message) {
  if (!condition) throw new Error(message);
}

suite.finish();
