/**
 * 动效状态机用例：开启真实动效（prefers-reduced-motion: false）跑一次抽签，
 * 验证「逐行高亮 -> 锁定 -> 粒子 -> 签号落定 -> 结果入场」都真的发生。
 */
import { createEnvironment, createSuite, loadJsdom, q, qa, tick, DOCS } from './harness.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const JSDOM = await loadJsdom();
if (!JSDOM) {
  console.log('⚠️  跳过：未安装 jsdom');
  process.exit(0);
}

const suite = createSuite();
const { window } = await createEnvironment(JSDOM, 'index.html', '#/draw', { motion: true });
await import(pathToFileURL(join(DOCS, 'assets/js/app.js')).href);
await tick(120);

suite.section('抽签动效（motion on）');

await suite.test('点击后进入抽签中状态（逐行高亮 + 按钮忙碌 + 舞台发光）', async () => {
  q(window, '.stage__actions .btn--primary').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(120);

  assert0(qa(window, '.reel.is-active').length >= 1, '没有正在转动的行高亮');
  assert0(q(window, '.stage').classList.contains('is-drawing'), '舞台没有进入抽签态');
  const button = q(window, '.stage__actions .btn--primary');
  assert0(button.classList.contains('is-busy'), '按钮没有忙碌态');
  assert0(button.disabled, '抽签中按钮应禁用');
  assert0(button.textContent.includes('抽签中'), `按钮文案没有切换：${button.textContent}`);
  assert0(q(window, '.reel__value.is-rolling'), '没有滚动中的数值');
});

await suite.test('转动期间会迸发粒子', async () => {
  let seen = 0;
  for (let i = 0; i < 40; i += 1) {
    seen = Math.max(seen, qa(window, '.burst').length);
    if (seen && qa(window, '.reel.is-locked').length >= 3) break;
    await tick(50);
  }
  assert0(seen > 0, '整个抽签过程没有任何粒子迸发');
});

await suite.test('三行依次锁定，并清理掉临时动画节点', async () => {
  for (let i = 0; i < 40 && qa(window, '.reel.is-locked').length < 3; i += 1) await tick(60);
  assert0(qa(window, '.reel.is-locked').length === 3, `锁定行数不对：${qa(window, '.reel.is-locked').length}`);
  assert0(qa(window, '.reel.is-active').length === 0, '抽完后仍有行处于高亮态');
  assert0(!q(window, '.stage').classList.contains('is-drawing'), '舞台没有退出抽签态');
  const button = q(window, '.stage__actions .btn--primary');
  assert0(!button.classList.contains('is-busy'), '按钮仍在忙碌态');
  assert0(button.textContent.includes('开始抽签'), `按钮文案没有复位：${button.textContent}`);
  assert0(!button.disabled, '按钮没有恢复可点');

  await tick(1100); // 等粒子层被回收
  assert0(qa(window, '.burst').length === 0, '粒子层没有被清理，会一直堆在 DOM 里');
});

await suite.test('签号先乱码后落定', async () => {
  const first = q(window, '.ticket__value').textContent;
  assert0(/^[0-9A-Z]{5}$/.test(first), `签号格式不对：${first}`);

  // 再抽一次，从第三次锁定前后开始高频采样
  q(window, '.stage__actions .btn--primary').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(1150);
  const samples = [];
  for (let i = 0; i < 16; i += 1) {
    samples.push(q(window, '.ticket__value')?.textContent || '');
    await tick(40);
  }
  const settled = q(window, '.ticket__value').textContent;
  assert0(/^[0-9A-Z]{5}$/.test(settled), `落定后的签号格式不对：${settled}`);
  const scrambled = samples.filter((text) => /^[0-9A-Z]{5}$/.test(text) && text !== settled);
  assert0(scrambled.length > 0, `没有观察到签号跳动（采样：${[...new Set(samples)].join('/')}）`);
  assert0(samples[samples.length - 1] === settled, '结尾应稳定在最终签号');
});

await suite.test('结果入场：扫光卡片 + 菜品错峰序号', async () => {
  const push = q(window, '.push');
  assert0(push.classList.contains('is-revealed'), '推送卡片没有扫光态');
  const cards = qa(window, '.dish-list--push .dish-card');
  assert0(cards.length > 0, '没有菜品卡');
  const indexes = cards.map((card) => card.style.getPropertyValue('--i'));
  assert0(indexes.every((value, i) => value === String(i)), `错峰序号不对：${indexes.join(',')}`);
  assert0(!q(window, '.dish-list--push').classList.contains('no-anim'), '首次结果应播放入场动画');
});

await suite.test('重渲染（切换收藏）不重放动画', async () => {
  const heart = q(window, '.dish-list--push .dish-card .icon-btn');
  heart.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  assert0(q(window, '.dish-list--push').classList.contains('no-anim'), '重渲染时不应重放入场动画');
});

suite.finish();

function assert0(condition, message) {
  if (!condition) throw new Error(message);
}
