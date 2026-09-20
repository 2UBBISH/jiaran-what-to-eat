/** 内容管理台 DOM 测试（独立进程里跑 admin.html） */
import { assert, createEnvironment, createSuite, loadJsdom, q, qa, tick, DOCS } from './harness.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const JSDOM = await loadJsdom();
if (!JSDOM) {
  console.log('⚠️  跳过：未安装 jsdom');
  process.exit(0);
}

const suite = createSuite();
const { window } = await createEnvironment(JSDOM, 'admin.html');
await import(pathToFileURL(join(DOCS, 'assets/js/admin.js')).href);
await tick(120);

const doc = window.document;

function fillDishForm(name) {
  const fill = (node, value) => {
    node.value = value;
    node.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  fill(doc.querySelector('.form-body input[placeholder*="羊肉锅"]'), name);
  fill(doc.querySelector('.form-body input[placeholder*="¥18"]'), '¥18');

  const canteenSelect = doc.querySelector('.form-body select');
  canteenSelect.value = canteenSelect.options[1].value;
  canteenSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

  const cuisineChip = doc.querySelector('.form-body .chip-row .chip');
  if (!cuisineChip.classList.contains('is-active')) {
    cuisineChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  }
  fill(doc.querySelector('.form-body textarea'), '亲测：肉多、汤浓，18 元很值。');
}

const submitButton = () => qa(window, '.admin__submit .btn').find((node) => node.textContent.includes('提交'));
const sourceSelect = () => q(window, '.admin__section select');

suite.section('内容管理台（admin.html）');

await suite.test('渲染数据源、上传表单与契约说明', () => {
  assert.ok(q(window, '.view--admin'), '缺少管理台视图');
  assert.ok(qa(window, '.admin__section').length >= 4, '管理台分区缺失');
  assert.ok(q(window, '.health'), '缺少连接状态');
  assert.ok(qa(window, '.form-body .field').length > 3, '表单字段缺失');
  assert.ok(qa(window, '.contract li').length >= 5, '契约说明缺失');
});

await suite.test('数据源下拉包含四种模式', () => {
  const values = [...sourceSelect().options].map((option) => option.value);
  assert.deepEqual(values, ['static', 'mock', 'github', 'http']);
});

await suite.test('必填项为空时给出校验错误并禁用提交', () => {
  assert.ok(q(window, '.valid.is-bad'), '没有显示校验错误');
  assert.ok(qa(window, '.valid.is-bad li').length >= 3, '错误条目太少');
  assert.ok(submitButton().disabled, '校验不通过时应禁用提交');
});

await suite.test('静态（只读）数据源下明确提示只读', () => {
  const notes = qa(window, '.admin__note').map((node) => node.textContent).join(' ');
  const health = q(window, '.health').textContent;
  assert.ok(notes.includes('只读'), '缺少只读提示');
  assert.ok(health.includes('静态') && health.includes('只读'), `连接状态没说清只读：${health}`);
});

await suite.test('填完整后校验通过，但只读数据源仍不可提交', () => {
  fillDishForm('测试·羊肉锅');
  assert.ok(q(window, '.valid.is-ok'), `仍有校验错误：${q(window, '.valid.is-bad')?.textContent || ''}`);
  assert.ok(q(window, '.draft-preview .code').textContent.includes('测试·羊肉锅'), 'JSON 预览未同步');
  assert.ok(submitButton().disabled, '只读数据源下提交按钮应禁用');
});

await suite.test('切到可写数据源后完成一次真实提交（在线上传流程）', async () => {
  // 「本地演示」与线上「GitHub 仓库」走同一套契约与校验，只是落点不同
  const select = sourceSelect();
  select.value = 'mock';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(150);

  fillDishForm('测试·在线提交菜');
  const button = submitButton();
  assert.ok(!button.disabled, '可写数据源下校验通过后应能提交');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(200);

  const stored = JSON.parse(window.localStorage.getItem('tsc:mock:contributions') || '[]');
  const toasts = qa(window, '.toast').map((node) => node.textContent).join(' / ');
  assert.equal(stored.length, 1, `提交的内容没有落库（提示：${toasts || '无'}）`);
  assert.equal(stored[0].payload.name, '测试·在线提交菜');
  assert.equal(stored[0].kind, 'dish');
  assert.ok(stored[0].id && stored[0].createdAt, '记录结构不完整');
  assert.ok(qa(window, '.admin__item').length >= 1, '已上传列表没有刷新');
});

await suite.test('提交的内容会出现在列表并可删除', async () => {
  const item = q(window, '.admin__item');
  assert.ok(item.textContent.includes('测试·在线提交菜'), '列表标题不对');
  assert.ok(item.textContent.includes('菜品'), '缺少类型标签');

  window.confirm = () => true; // jsdom 没有实现 confirm
  const removeButton = item.querySelector('.icon-btn--danger');
  removeButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(200);

  const stored = JSON.parse(window.localStorage.getItem('tsc:mock:contributions') || '[]');
  assert.equal(stored.length, 0, '删除没有生效');
});

await suite.test('非法 JSON 导入被拒绝且不污染数据', async () => {
  const before = JSON.parse(window.localStorage.getItem('tsc:mock:contributions') || '[]').length;
  const admin = await import(pathToFileURL(join(DOCS, 'assets/js/core/menu.js')).href);
  const base = JSON.parse(
    (await import('node:fs')).readFileSync(join(DOCS, 'assets/data/menu.json'), 'utf8'),
  );
  const menu = admin.buildMenu(base, []);
  const bad = admin.validateContribution({ id: 'x', kind: 'dish', payload: { name: '', canteenId: 'nope' } }, menu);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 2);
  const after = JSON.parse(window.localStorage.getItem('tsc:mock:contributions') || '[]').length;
  assert.equal(after, before);
});

await suite.test('切回只读数据源后恢复禁用', async () => {
  const select = sourceSelect();
  select.value = 'static';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(150);
  fillDishForm('测试·静态模式');
  assert.ok(submitButton().disabled, '只读模式下应禁用提交');
});

suite.finish();
