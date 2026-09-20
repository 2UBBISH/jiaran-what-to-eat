/**
 * 图片灯箱：点任意菜品/窗口照片看大图
 * ---------------------------------------------------------------------------
 * - 只装一个委托监听：任何 <img class="zoomable"> 被点击就打开
 * - 相册范围取最近的 [data-gallery] 容器，所以「今日窗口」里的多张菜图可以左右翻
 * - 支持 Esc / 点背景 / 关闭按钮 / ←→ / 手机左右滑动
 * - 尊重「减少动态效果」
 */

import { el, qsa, prefersReducedMotion } from './dom.js';

let installed = false;

function collectGallery(img) {
  const scope = img.closest('[data-gallery]');
  const nodes = scope ? qsa('img.zoomable', scope) : [img];
  const items = nodes.map((node) => ({
    src: node.getAttribute('src'),
    title: node.dataset.zoomTitle || node.getAttribute('alt') || '',
    meta: node.dataset.zoomMeta || '',
  }));
  const index = Math.max(0, nodes.indexOf(img));
  return { items, index };
}

/** 打开灯箱；items: [{src, title, meta}] */
export function openLightbox(items, startIndex = 0) {
  const list = (items || []).filter((item) => item && item.src);
  if (!list.length) return null;

  let index = Math.min(Math.max(0, startIndex), list.length - 1);
  const image = el('img', { class: 'lightbox__img', alt: '' });
  const title = el('div', { class: 'lightbox__title' });
  const meta = el('div', { class: 'lightbox__meta' });
  const counter = el('div', { class: 'lightbox__counter' });
  const prev = el('button', { class: 'lightbox__nav lightbox__nav--prev', type: 'button', text: '‹', title: '上一张' });
  const next = el('button', { class: 'lightbox__nav lightbox__nav--next', type: 'button', text: '›', title: '下一张' });
  const close = el('button', { class: 'lightbox__close', type: 'button', text: '✕', title: '关闭' });

  const panel = el('div', { class: 'lightbox__panel' }, [
    image,
    el('div', { class: 'lightbox__caption' }, [title, meta]),
  ]);
  const overlay = el('div', {
    class: 'lightbox',
    role: 'dialog',
    'aria-modal': 'true',
    onclick: (event) => { if (event.target === overlay) closeBox(); },
  }, [prev, panel, next, counter, close]);

  function render() {
    const item = list[index];
    image.src = item.src;
    image.alt = item.title || '';
    title.textContent = item.title || '';
    meta.textContent = item.meta || '';
    counter.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : '';
    const single = list.length < 2;
    prev.hidden = single;
    next.hidden = single;
  }

  function step(delta) {
    index = (index + delta + list.length) % list.length;
    render();
  }

  function onKey(event) {
    if (event.key === 'Escape') closeBox();
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
  }

  let touchStartX = null;
  overlay.addEventListener('touchstart', (event) => {
    touchStartX = event.touches[0]?.clientX ?? null;
  }, { passive: true });
  overlay.addEventListener('touchend', (event) => {
    if (touchStartX == null) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    if (Math.abs(delta) > 40) step(delta > 0 ? -1 : 1);
    touchStartX = null;
  });

  prev.addEventListener('click', (event) => { event.stopPropagation(); step(-1); });
  next.addEventListener('click', (event) => { event.stopPropagation(); step(1); });
  close.addEventListener('click', (event) => { event.stopPropagation(); closeBox(); });

  function closeBox() {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('is-in');
    const delay = prefersReducedMotion() ? 0 : 180;
    setTimeout(() => {
      overlay.remove();
      document.body.classList.remove('is-locked');
    }, delay);
  }

  render();
  document.body.append(overlay);
  document.body.classList.add('is-locked');
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => overlay.classList.add('is-in'));
  return { close: closeBox, step };
}

/** 全局安装一次：点击任何 zoomable 图片即可看大图 */
export function initLightbox() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (event) => {
    const img = event.target.closest?.('img.zoomable');
    if (!img) return;
    if (img.closest('.lightbox')) return;
    event.preventDefault();
    const { items, index } = collectGallery(img);
    openLightbox(items, index);
  });
}
