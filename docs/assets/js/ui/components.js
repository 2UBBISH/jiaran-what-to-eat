/** 复用组件：全部返回 DOM 节点，样式在 assets/css/components.css */

import { el, qs, raf } from './dom.js';
import { formatPrice, formatRelative, floorLabel, spicyLabel } from '../core/format.js';

/* ------------------------------------------------------------------ 基础 */

export function sectionTitle(text, action = null) {
  return el('div', { class: 'section-title' }, [
    el('h2', { text }),
    action || null,
  ]);
}

export function ticketChip(ticket, { seed = null } = {}) {
  return el('div', { class: 'ticket', title: seed != null ? `seed: ${seed}` : '' }, [
    el('span', { class: 'ticket__label', text: '签号' }),
    el('span', { class: 'ticket__value', text: ticket }),
  ]);
}

export function tagPill(text, variant = '') {
  return el('span', { class: `pill ${variant ? `pill--${variant}` : ''}`, text });
}

export function pricePill(price) {
  const text = formatPrice(price);
  const unknown = !price || (price.min == null && price.max == null);
  return el('span', { class: `pill pill--price${unknown ? ' is-unknown' : ''}`, text });
}

export function chip(label, { active = false, onClick, count = null, emoji = '' } = {}) {
  return el('button', {
    class: `chip${active ? ' is-active' : ''}`,
    type: 'button',
    onclick: onClick,
  }, [
    emoji ? el('span', { class: 'chip__emoji', text: emoji }) : null,
    el('span', { text: label }),
    count != null ? el('span', { class: 'chip__count', text: String(count) }) : null,
  ]);
}

export function chipRow(items, { value, multi = false, onChange } = {}) {
  const selected = new Set(multi ? (value || []) : [value]);
  const row = el('div', { class: 'chip-row' });
  items.forEach((item) => {
    const node = chip(item.label, {
      active: selected.has(item.value),
      emoji: item.emoji || '',
      count: item.count ?? null,
      onClick: () => {
        if (multi) {
          if (selected.has(item.value)) selected.delete(item.value);
          else selected.add(item.value);
        } else {
          selected.clear();
          if (item.value !== value) selected.add(item.value);
        }
        [...row.children].forEach((child, index) => {
          child.classList.toggle('is-active', selected.has(items[index].value));
        });
        onChange?.(multi ? [...selected] : [...selected][0]);
      },
    });
    row.append(node);
  });
  return row;
}

export function segmented(items, { value, onChange } = {}) {
  const wrap = el('div', { class: 'segmented', role: 'tablist' });
  const thumb = el('div', { class: 'segmented__thumb' });
  wrap.append(thumb);
  items.forEach((item, index) => {
    const button = el('button', {
      class: `segmented__item${item.value === value ? ' is-active' : ''}`,
      type: 'button',
      role: 'tab',
      text: item.label,
      onclick: () => {
        [...wrap.querySelectorAll('.segmented__item')].forEach((node, i) => {
          node.classList.toggle('is-active', i === index);
        });
        moveThumb(index);
        onChange?.(item.value);
      },
    });
    wrap.append(button);
  });
  function moveThumb(index) {
    const active = wrap.querySelectorAll('.segmented__item')[index];
    if (!active) return;
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  }
  raf(() => {
    const index = Math.max(0, items.findIndex((item) => item.value === value));
    moveThumb(index);
  });
  return wrap;
}

export function toggleRow(label, { checked = false, hint = '', onChange } = {}) {
  const input = el('input', { type: 'checkbox', class: 'switch__input', ...(checked ? { checked: true } : {}) });
  input.addEventListener('change', () => onChange?.(input.checked));
  return el('label', { class: 'row row--switch' }, [
    el('span', { class: 'row__main' }, [
      el('span', { class: 'row__label', text: label }),
      hint ? el('span', { class: 'row__hint', text: hint }) : null,
    ]),
    el('span', { class: 'switch' }, [input, el('span', { class: 'switch__track' })]),
  ]);
}

export function field(label, control, hint = '') {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    control,
    hint ? el('span', { class: 'field__hint', text: hint }) : null,
  ]);
}

export function input(props = {}) {
  return el('input', { class: 'input', ...props });
}

export function textarea(props = {}) {
  return el('textarea', { class: 'input input--area', rows: 4, ...props });
}

export function select(options, { value, onChange, placeholder } = {}) {
  const node = el('select', { class: 'input' });
  if (placeholder) node.append(el('option', { value: '', text: placeholder }));
  options.forEach((option) => {
    node.append(el('option', {
      value: option.value,
      text: option.label,
      ...(option.value === value ? { selected: true } : {}),
    }));
  });
  node.addEventListener('change', () => onChange?.(node.value));
  return node;
}

export function button(label, { variant = 'primary', onClick, icon = '', size = '' } = {}) {
  return el('button', {
    class: `btn btn--${variant}${size ? ` btn--${size}` : ''}`,
    type: 'button',
    onclick: onClick,
  }, [
    icon ? el('span', { class: 'btn__icon', text: icon }) : null,
    el('span', { text: label }),
  ]);
}

export function emptyState(title, desc = '', action = null) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty__icon', text: '🍽' }),
    el('div', { class: 'empty__title', text: title }),
    desc ? el('div', { class: 'empty__desc', text: desc }) : null,
    action,
  ]);
}

export function skeleton(lines = 3) {
  const wrap = el('div', { class: 'skeleton-card' });
  for (let i = 0; i < lines; i += 1) wrap.append(el('div', { class: 'skeleton' }));
  return wrap;
}

/* ------------------------------------------------------------------ 菜品 */

export function dishCard(dish, { canteen = null, onFavorite = null, favorite = false } = {}) {
  const meta = [];
  if (dish.stallName) meta.push(`窗口：${dish.stallName}`);
  if (canteen && !canteen.name?.includes(dish.canteenId)) {
    meta.push(`${canteen.name}${dish.floor ? ` · ${floorLabel(dish.floor)}` : ''}`);
  } else if (dish.floor) {
    meta.push(floorLabel(dish.floor));
  }

  const badges = [
    pricePill(dish.price),
    dish.spicyLevel ? tagPill(spicyLabel(dish.spicyLevel), 'spicy') : null,
    ...(dish.tags || []).slice(0, 3).map((tag) => tagPill(tag, 'tag')),
    dish.origin === 'community' ? tagPill('同学上传', 'community') : null,
  ].filter(Boolean);

  const node = el('article', { class: 'dish-card' }, [
    dish.image ? el('div', { class: 'dish-card__media' }, [el('img', { src: dish.image, alt: dish.name, loading: 'lazy' })]) : null,
    el('div', { class: 'dish-card__body' }, [
      el('div', { class: 'dish-card__head' }, [
        el('h3', { class: 'dish-card__name', text: dish.name }),
        onFavorite ? el('button', {
          class: `icon-btn${favorite ? ' is-on' : ''}`,
          type: 'button',
          title: favorite ? '取消收藏' : '收藏',
          text: favorite ? '♥' : '♡',
          onclick: (e) => { e.stopPropagation(); onFavorite(dish); },
        }) : null,
      ]),
      meta.length ? el('div', { class: 'dish-card__meta', text: meta.join(' · ') }) : null,
      badges.length ? el('div', { class: 'dish-card__badges' }, badges) : null,
      dish.reviewText ? el('p', { class: 'dish-card__review', text: `${dish.reviewLabel}：${dish.reviewText}` }) : null,
      (dish.communityNotes || []).length
        ? el('div', { class: 'dish-card__notes' }, dish.communityNotes.map((note) => el('p', {
          class: 'note',
          text: `💬 ${note.text}${note.author ? ` —— ${note.author}` : ''}`,
        })))
        : null,
    ]),
  ]);
  return node;
}

export function historyItem(entry, { dish }) {
  return el('div', { class: 'history-item' }, [
    el('div', { class: 'history-item__main' }, [
      el('div', { class: 'history-item__title', text: dish ? dish.name : entry.dishId }),
      el('div', {
        class: 'history-item__meta',
        text: [entry.canteenName, entry.floor ? floorLabel(entry.floor) : null, formatRelative(entry.ts)]
          .filter(Boolean).join(' · '),
      }),
    ]),
    el('span', { class: 'history-item__ticket', text: entry.ticket || '' }),
  ]);
}

/* ------------------------------------------------------------ 浮层/提示 */

export function toast(message, { tone = 'info', timeout = 2600 } = {}) {
  let host = qs('#toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host' });
    document.body.append(host);
  }
  const node = el('div', { class: `toast toast--${tone}`, text: message });
  host.append(node);
  raf(() => node.classList.add('is-in'));
  setTimeout(() => {
    node.classList.remove('is-in');
    setTimeout(() => node.remove(), 320);
  }, timeout);
  return node;
}

/**
 * 底部抽屉。返回 { close, body }，body 是内容容器。
 */
export function bottomSheet({ title, onClose } = {}) {
  const panel = el('div', { class: 'sheet__panel' }, [
    el('div', { class: 'sheet__grabber' }),
    title ? el('div', { class: 'sheet__head' }, [
      el('h2', { text: title }),
      el('button', { class: 'icon-btn', type: 'button', text: '✕', onclick: () => close() }),
    ]) : null,
  ]);
  const body = el('div', { class: 'sheet__body' });
  panel.append(body);
  const overlay = el('div', { class: 'sheet', onclick: (e) => { if (e.target === overlay) close(); } }, [panel]);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-in'));

  function close() {
    overlay.classList.remove('is-in');
    setTimeout(() => { overlay.remove(); onClose?.(); }, 260);
  }
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
  return { close, body, panel };
}
