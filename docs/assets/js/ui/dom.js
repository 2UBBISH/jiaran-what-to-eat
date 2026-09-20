/** DOM 小工具 + 抽签滚动动画（不含业务逻辑） */

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * 挂载子节点并自动过滤 null / false / undefined。
 * 原生 append(null) 会插入文本节点 "null"（页面上真的漏出过一次），
 * 所以多子节点挂载一律走这个函数。
 */
export function mount(parent, ...children) {
  children.flat(Infinity).forEach((child) => {
    if (child == null || child === false || child === true) return;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return parent;
}

export function on(node, event, selector, handler) {
  node.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && node.contains(target)) handler(e, target);
  });
}

/** requestAnimationFrame 的安全包装（非浏览器环境退化为 setTimeout） */
export function raf(callback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(() => callback(Date.now()), 16);
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * 老虎机式滚动：抽签结果其实已经算好了，这里只负责「转起来 -> 逐个锁定」的手感。
 * 尊重 prefers-reduced-motion：直接显示结果，不做动画。
 */
export function createRoller(node, { interval = 60 } = {}) {
  let timer = null;
  const reduced = prefersReducedMotion();

  function start(supply) {
    if (reduced) return;
    if (timer) return;
    node.classList.add('is-rolling');
    const tick = () => { node.textContent = supply(); };
    tick();
    timer = setInterval(tick, interval);
  }

  async function stop(value, { delay = 0 } = {}) {
    if (delay) await sleep(reduced ? 0 : delay);
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    node.textContent = value;
    node.classList.remove('is-rolling');
    node.classList.remove('is-locked');
    void node.offsetWidth; // 强制重排以重放动画
    node.classList.add('is-locked');
  }

  return { start, stop, get running() { return timer !== null; } };
}

/** 数字/文本快速跳动（用于概率、计数展示） */
export async function countUp(node, to, { duration = 600, suffix = '' } = {}) {
  if (prefersReducedMotion()) {
    node.textContent = `${to}${suffix}`;
    return;
  }
  const steps = 18;
  for (let i = 1; i <= steps; i += 1) {
    node.textContent = `${Math.round((to * i) / steps)}${suffix}`;
    await sleep(duration / steps);
  }
  node.textContent = `${to}${suffix}`;
}

/** 抽签锁定时的粒子迸发（尊重 prefers-reduced-motion） */
export function burst(host, { count = 7, duration = 620 } = {}) {
  if (!host || prefersReducedMotion()) return null;
  const layer = el('span', { class: 'burst', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.7;
    const distance = 20 + Math.random() * 28;
    layer.append(el('i', {
      style: `--dx:${(Math.cos(angle) * distance).toFixed(1)}px;`
        + `--dy:${(Math.sin(angle) * distance).toFixed(1)}px;`
        + `--delay:${Math.round(Math.random() * 90)}ms`,
    }));
  }
  host.append(layer);
  setTimeout(() => layer.remove(), duration + 240);
  return layer;
}

/** 签号刮奖式跳动：先乱码，再从左到右逐位落定 */
export async function scramble(node, finalText, { duration = 460, charset = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ' } = {}) {
  if (!node) return;
  if (prefersReducedMotion()) {
    node.textContent = finalText;
    return;
  }
  const target = String(finalText);
  const started = Date.now();
  await new Promise((resolve) => {
    const frame = () => {
      const t = Math.min(1, (Date.now() - started) / duration);
      const settled = Math.floor(t * target.length);
      node.textContent = target
        .split('')
        .map((ch, index) => (index < settled ? ch : charset[Math.floor(Math.random() * charset.length)]))
        .join('');
      if (t < 1) raf(frame);
      else {
        node.textContent = target;
        resolve();
      }
    };
    raf(frame);
  });
}
