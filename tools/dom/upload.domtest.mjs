/**
 * 自选菜快传的 DOM 用例：选位置 → 选照片 → 填菜名 → 一次提交
 * ---------------------------------------------------------------------------
 * 图片压缩依赖 canvas（jsdom 没有），所以这里注入一个假的 prepareImage，
 * 其余流程（校验、日期语义、one-commit 提交、窗口自动建档）都是真实代码路径。
 */
import { assert, createEnvironment, createSuite, loadJsdom, q, qa, tick, DOCS } from './harness.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const JSDOM = await loadJsdom();
if (!JSDOM) {
  console.log('⚠️  跳过：未安装 jsdom');
  process.exit(0);
}

const suite = createSuite();
const { window } = await createEnvironment(JSDOM, 'upload.html');
const doc = window.document;

const { createUploadView } = await import(pathToFileURL(join(DOCS, 'assets/js/ui/viewUpload.js')).href);
const { dateKey } = await import(pathToFileURL(join(DOCS, 'assets/js/core/date.js')).href);

let prepared = 0;
const fakePrepare = async (file) => {
  prepared += 1;
  return {
    name: `test-${prepared}.jpg`,
    mime: 'image/jpeg',
    base64: 'dGVzdA==',
    dataUrl: 'data:image/jpeg;base64,dGVzdA==',
    blob: null,
    bytes: 2048,
    width: 800,
    height: 600,
    describe: () => '800×600',
  };
};

const view = createUploadView({ root: q(window, '#upload'), prepareImage: fakePrepare });
await view.boot();
await tick(120);

const pickPhotos = (names) => {
  const fileInput = q(window, '.up__file');
  Object.defineProperty(fileInput, 'files', {
    value: names.map((name) => new window.File(['x'], name, { type: 'image/jpeg' })),
    configurable: true,
  });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
};

// 提交区是最后一个 .up__block，按钮文案会变（先选照片 / 还需填 N 个菜名 / 一次提交 N 道菜）
const submitButton = () => q(window, '.view--upload section.up__block:last-of-type .btn');

suite.section('自选菜快传（upload.html）');

await suite.test('页面渲染：位置 / 照片 / 共同属性 / 提交', () => {
  assert.ok(q(window, '.view--upload'), '缺少快传视图');
  assert.ok(q(window, '.up__picker'), '缺少选照片入口');
  assert.ok(qa(window, '.up__block').length >= 4, '区块数量不对');
  assert.ok(submitButton(), '缺少提交按钮');
});

await suite.test('只读数据源下禁止提交并提示切换', () => {
  assert.ok(submitButton().disabled, '只读数据源下应禁用提交');
  const hints = qa(window, '.up__hint').map((n) => n.textContent).join(' ');
  assert.ok(hints.includes('只读'), `缺少只读提示：${hints.slice(0, 80)}`);
});

await suite.test('切到可写数据源（本地演示）', async () => {
  // 展开设置 → 选「本地演示」
  qa(window, '.up__row .btn').find((n) => n.textContent.includes('设置'))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(40);
  const modeRow = q(window, '.up__settings .segmented');
  const mockItem = [...modeRow.querySelectorAll('.segmented__item')].find((n) => n.textContent.includes('本地演示'));
  mockItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(160);
  const value = JSON.parse(window.localStorage.getItem('tsc:datasource') || '{}');
  assert.equal(value.mode, 'mock', '数据源没有切换成功');
});

await suite.test('选择饭堂/楼层/窗口', async () => {
  const canteenSelect = q(window, '.up__block select');
  canteenSelect.value = 'lan_yuan';
  canteenSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(60);

  // 楼层分段控件里选「一层」
  const floorSeg = qa(window, '.up__block-inner .segmented')[0];
  const firstFloor = [...floorSeg.querySelectorAll('.segmented__item')].find((n) => n.textContent.includes('一层'));
  firstFloor.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);

  const stallInput = [...qa(window, '.up__block input')].find((n) => n.placeholder?.includes('自选窗口'));
  stallInput.value = '测试自选窗口';
  stallInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(40);

  const saved = JSON.parse(window.localStorage.getItem('tsc:upload:prefs') || '{}');
  assert.equal(saved.canteenId, 'lan_yuan');
  assert.equal(saved.floor, '1F');
  assert.equal(saved.stallName, '测试自选窗口');
});

await suite.test('一次选两张照片 → 生成两行待填菜名，按钮直接说还差什么', async () => {
  pickPhotos(['a.jpg', 'b.jpg']);
  await tick(120);
  const rows = qa(window, '.up__entries .up__entry');
  assert.equal(rows.length, 2, `照片行数不对：${rows.length}`);
  assert.ok(q(window, '.up__entries img'), '缺少缩略图');
  assert.ok(submitButton().disabled, '菜名没填时不应允许提交');
  assert.ok(submitButton().textContent.includes('2 个菜名'), `按钮文案应提示缺菜名：${submitButton().textContent}`);
  assert.equal(qa(window, '.up__entry input.is-invalid').length, 2, '未填菜名的输入框应有红框提示');
});

await suite.test('逐张补菜名，按钮随之变化', async () => {
  const nameInputs = qa(window, '.up__entry input').filter((n) => n.placeholder?.includes('菜名'));
  nameInputs[0].value = '红烧肉';
  nameInputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(40);
  assert.ok(submitButton().disabled, '还有一道菜没填名字，应仍禁用');
  assert.ok(submitButton().textContent.includes('1 个菜名'), `按钮文案不对：${submitButton().textContent}`);

  nameInputs[1].value = '清炒时蔬';
  nameInputs[1].dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(60);
  assert.ok(!submitButton().disabled, '都填好后应可提交');
  assert.ok(submitButton().textContent.includes('提交 2 道菜'), `按钮文案不对：${submitButton().textContent}`);
  assert.equal(qa(window, '.up__entry input.is-invalid').length, 0, '填好后不应再有红框');
});

await suite.test('提交后：窗口自动建档 + 自选菜带当天日期 + 落库', async () => {
  submitButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(300);

  const stored = JSON.parse(window.localStorage.getItem('tsc:mock:contributions') || '[]');
  const stall = stored.find((r) => r.kind === 'stall');
  const dishes = stored.filter((r) => r.kind === 'dish');

  assert.ok(stall, '没有自动建立窗口记录');
  assert.equal(stall.payload.name, '测试自选窗口');
  assert.equal(stall.payload.windowType, '自选');
  assert.equal(stall.payload.floor, '1F');

  assert.equal(dishes.length, 2, `菜品条数不对：${dishes.length}`);
  assert.deepEqual(dishes.map((d) => d.payload.name).sort(), ['清炒时蔬', '红烧肉']);
  assert.ok(dishes.every((d) => d.payload.date === dateKey()), '自选菜应带当天日期');
  // 提交时写的是约定路径 assets/uploads/xxx；mock 数据源会把它换成内联图，便于本机直接看到
  assert.ok(
    dishes.every((d) => String(d.payload.image).startsWith('data:image/')),
    `mock 模式应把约定路径换成本机可显示的内联图：${dishes.map((d) => d.payload.image).join(', ')}`,
  );
  assert.ok(dishes.every((d) => d.payload.stallName === '测试自选窗口'));
  assert.ok(dishes.every((d) => d.payload.canteenId === 'lan_yuan' && d.payload.floor === '1F'));
});

await suite.test('提交后清空照片、保留位置，并列出今天已上传', async () => {
  assert.equal(qa(window, '.up__entries .up__entry').length, 0, '提交后应清空照片');
  const prefs = JSON.parse(window.localStorage.getItem('tsc:upload:prefs') || '{}');
  assert.equal(prefs.stallName, '测试自选窗口', '应保留窗口选择，方便下次继续传');

  const today = q(window, '.up__today');
  assert.ok(today, '缺少「今天已上传」提示');
  assert.ok(today.textContent.includes('红烧肉') && today.textContent.includes('清炒时蔬'));
});

await suite.test('窗口照片与内容同一次提交', async () => {
  const windowInput = qa(window, '.up__picker--small input')[0];
  Object.defineProperty(windowInput, 'files', {
    value: [new window.File(['x'], 'win.jpg', { type: 'image/jpeg' })],
    configurable: true,
  });
  windowInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(140);
  assert.ok(q(window, '.up__window-photo .up__thumb img'), '窗口照片预览没出现');

  const stored = JSON.parse(window.localStorage.getItem('tsc:mock:contributions') || '[]');
  assert.equal(stored.filter((r) => r.kind === 'stall').length, 1, '此时还不该产生新的窗口记录');
});

await suite.test('页面没有 null 脏文本节点', () => {
  const junk = [];
  const walk = (node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const text = child.textContent.trim();
        if (text === 'null' || text === 'undefined') junk.push(text);
      } else walk(child);
    });
  };
  walk(q(window, '#upload'));
  assert.equal(junk.length, 0, `出现了脏文本节点：${junk.join(', ')}`);
});

suite.finish();
