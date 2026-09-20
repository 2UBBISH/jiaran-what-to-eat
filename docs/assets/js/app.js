/**
 * 应用装配（index.html 入口）
 * ---------------------------------------------------------------------------
 * 这里只做「接线」：建状态、造数据源、挂视图、跑路由。
 * 业务逻辑在 core/，数据访问在 data/，页面在 ui/。
 */

import { createStore } from './store.js';
import { createRouter } from './router.js';
import { createDataSource, loadConfig, SOURCE_MODES } from './data/index.js';
import { createDrawView } from './ui/viewDraw.js';
import { createBrowseView } from './ui/viewBrowse.js';
import { el, clear, qs } from './ui/dom.js';
import { button, skeleton, toast } from './ui/components.js';
import { initLightbox } from './ui/lightbox.js';

const appRoot = qs('#app');
const navRoot = qs('#tabbar');
const statusRoot = qs('#status');

const store = createStore({
  menu: null,
  meta: null,
  loading: true,
  error: null,
  config: loadConfig(),
});

const drawView = createDrawView({ getMenu: () => store.get().menu, onNeedMenu: () => boot() });
const browseView = createBrowseView({ getMenu: () => store.get().menu });
const views = { draw: drawView, browse: browseView, r: drawView };

let currentRoute = { name: 'draw', params: new URLSearchParams() };

function renderStatus(state) {
  clear(statusRoot);
  if (state.loading) {
    statusRoot.append(skeleton(3));
    return;
  }
  if (state.error) {
    statusRoot.append(el('div', { class: 'card status-card' }, [
      el('h2', { text: '数据没能加载出来' }),
      el('p', { class: 'status-card__msg', text: state.error.message }),
      state.error.hint ? el('p', { class: 'status-card__hint', text: state.error.hint }) : null,
      el('div', { class: 'status-card__actions' }, [
        button('重试', { onClick: () => boot() }),
        el('a', { class: 'link', href: 'admin.html', text: '去内容管理检查数据源' }),
      ]),
    ]));
  }
}

function renderRoute(route) {
  currentRoute = route;
  const view = views[route.name] || views.draw;
  clear(appRoot);
  appRoot.append(view.root);
  view.onRoute?.(route);
  renderNav(route);
}

function renderNav(route) {
  clear(navRoot);
  const active = route.name === 'browse' ? 'browse' : 'draw';
  const items = [
    { id: 'draw', label: '抽签', icon: '🎲', hash: '#/draw' },
    { id: 'browse', label: '逛一逛', icon: '🍜', hash: '#/browse' },
    { id: 'upload', label: '传自选菜', icon: '📷', href: 'upload.html' },
    { id: 'admin', label: '内容管理', icon: '✎', href: 'admin.html' },
  ];
  items.forEach((item) => {
    const node = el(item.href ? 'a' : 'button', {
      class: `tabbar__item${active === item.id ? ' is-active' : ''}`,
      ...(item.href ? { href: item.href } : { type: 'button', onclick: () => router.navigate(item.hash) }),
    }, [
      el('span', { class: 'tabbar__icon', text: item.icon }),
      el('span', { class: 'tabbar__label', text: item.label }),
    ]);
    navRoot.append(node);
  });
}

async function boot() {
  const config = loadConfig();
  store.set({ loading: true, error: null, config });
  renderStatus(store.get());

  let source;
  try {
    source = createDataSource(config);
  } catch (error) {
    store.set({ loading: false, error });
    renderStatus(store.get());
    return;
  }

  try {
    const { menu, meta } = await source.loadMenu();
    store.set({ menu, meta, loading: false, error: null });
    renderStatus(store.get());
    if (menu.rejected?.length) {
      toast(`有 ${menu.rejected.length} 条同学上传的内容没通过校验，已跳过`, { tone: 'info', timeout: 4200 });
    }
    drawView.onMenuReady?.();
    browseView.onMenuReady?.();
    renderRoute(currentRoute);
  } catch (error) {
    console.error('[app] loadMenu failed', error);
    store.set({ loading: false, error });
    renderStatus(store.get());
  }
}

const router = createRouter({
  fallback: 'draw',
  onRoute: (route) => {
    if (store.get().loading) {
      currentRoute = route;
      return;
    }
    renderRoute(route);
  },
});

function renderFooterNote() {
  const config = store.get().config;
  const mode = SOURCE_MODES.find((m) => m.id === config.mode);
  const note = qs('#footer-note');
  if (!note) return;
  note.textContent = `数据源：${mode?.name || config.mode} · 抽签全部在本机运行，结果可复现可分享`;
}

store.subscribe((state) => {
  renderStatus(state);
  renderFooterNote();
});

initLightbox();

router.start();
boot();
