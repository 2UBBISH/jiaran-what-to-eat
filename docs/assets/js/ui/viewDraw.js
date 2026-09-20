/**
 * 抽签视图：抽「饭堂 + 楼层」-> 展示「推送菜系」页面
 * ---------------------------------------------------------------------------
 * 视图只做三件事：渲染、把用户操作转成 core 调用、展示结果。
 * 抽签算法在 core/lottery.js，内容来自注入的数据源，本文件不碰网络与存储细节
 * （本机历史/收藏走 userData，属于用户自己的数据）。
 */

import { el, clear, mount, burst, scramble, createRoller, randomOf } from './dom.js';
import { APP_NAME, APP_TAGLINE, APP_SUB, SHARE_TITLE } from '../brand.js';
import {
  button, chipRow, segmented, toggleRow, dishCard, ticketChip,
  emptyState, sectionTitle, toast, bottomSheet, historyItem,
  stallStrip, todayBoard,
} from './components.js';
import { draw, redrawCuisine, preview } from '../core/lottery.js';
import { dateLabel } from '../core/date.js';
import { stallsOf } from '../core/menu.js';
import { hashForResult, buildShareText, optionsFromHash } from '../core/share.js';
import {
  loadSettings, saveSettings, recentContext, recordDraw, markEaten,
  loadFavorites, toggleFavorite, loadHistory,
} from '../userData.js';
import { currentUrlFor } from '../router.js';

const SPICY_OPTIONS = [
  { label: '不限', value: null },
  { label: '不辣', value: 0 },
  { label: '微辣', value: 1 },
  { label: '中辣', value: 2 },
];

const PRICE_OPTIONS = [
  { label: '不限', value: null },
  { label: '≤10', value: 10 },
  { label: '≤20', value: 20 },
  { label: '≤30', value: 30 },
];

export function createDrawView({ getMenu, onNeedMenu }) {
  let settings = loadSettings();
  let result = null;
  let busy = false;
  let sharedFromLink = false;

  /* ------------------------------------------------------------ 骨架 */

  const reelCanteen = el('span', { class: 'reel__value', text: '待抽取' });
  const reelFloor = el('span', { class: 'reel__value', text: '待抽取' });
  const reelCuisine = el('span', { class: 'reel__value', text: '待推送' });
  const stageMeta = el('div', { class: 'stage__meta' });
  const resultHost = el('section', { class: 'result', hidden: true });
  const historyHost = el('section', { class: 'history' });
  const shareBanner = el('div', { class: 'banner', hidden: true });

  const drawButton = button('开始抽签', { size: 'lg', onClick: () => runDraw() });
  const filterButton = button('筛选', { variant: 'ghost', onClick: () => openFilters() });

  const setDrawLabel = (text) => { drawButton.firstElementChild.textContent = text; };

  const rowCanteen = el('div', { class: 'reel' }, [
    el('span', { class: 'reel__label', text: '饭堂' }), reelCanteen,
  ]);
  const rowFloor = el('div', { class: 'reel' }, [
    el('span', { class: 'reel__label', text: '楼层' }), reelFloor,
  ]);
  const rowCuisine = el('div', { class: 'reel reel--accent' }, [
    el('span', { class: 'reel__label', text: '推送菜系' }), reelCuisine,
  ]);

  const stage = el('section', { class: 'stage card card--glass' }, [
    el('div', { class: 'reels' }, [rowCanteen, rowFloor, rowCuisine]),
    el('div', { class: 'stage__actions' }, [drawButton, filterButton]),
    stageMeta,
  ]);

  const root = el('div', { class: 'view view--draw' }, [
    el('header', { class: 'hero' }, [
      el('div', { class: 'hero__eyebrow', text: APP_TAGLINE }),
      el('h1', { class: 'hero__title', text: APP_NAME }),
      el('p', { class: 'hero__sub', text: APP_SUB }),
    ]),
    shareBanner,
    stage,
    resultHost,
    historyHost,
  ]);

  const rollers = {
    canteen: createRoller(reelCanteen),
    floor: createRoller(reelFloor),
    cuisine: createRoller(reelCuisine),
  };

  /* ------------------------------------------------------------ 渲染 */

  function activeFilterSummary() {
    const parts = [];
    if (settings.maxSpicyLevel != null) {
      parts.push(SPICY_OPTIONS.find((o) => o.value === settings.maxSpicyLevel)?.label || '');
    }
    if (settings.maxPrice != null) parts.push(`≤¥${settings.maxPrice}`);
    if (settings.cuisines?.length) parts.push(`${settings.cuisines.length} 个菜系`);
    if (settings.avoidRecent) parts.push('避开最近吃过的');
    if (settings.labeledFloorsOnly) parts.push('只看有楼层');
    return parts.length ? parts.join(' · ') : '无筛选';
  }

  function refreshStage() {
    const menu = getMenu();
    if (!menu) {
      stageMeta.textContent = '正在读取菜单…';
      return;
    }
    const p = preview(menu, { ...settings, ...recentContext() }, { now: Date.now() });
    const todayCount = menu.dishes.filter((dish) => dish.date === menu.today).length;
    stageMeta.innerHTML = '';
    mount(
      stageMeta,
      el('span', {
        class: 'stage__pool',
        text: `池子 ${p.poolSize} 道 · ${p.canteenCount} 个饭堂`,
        title: '不含「避开最近吃过的」的稳定数量',
      }),
      p.avoidedCount
        ? el('span', {
          class: 'stage__avoided',
          text: `· 已避开最近 ${p.avoidedCount} 道`,
          title: '这些是最近抽到过的菜，本次不会再被抽中',
        })
        : null,
      el('span', { class: 'stage__sep', text: '·' }),
      el('span', { class: 'stage__filters', text: activeFilterSummary() }),
      todayCount
        ? el('a', { class: 'stage__today', href: 'upload.html', text: `· 今日自选 ${todayCount} 道` })
        : null,
    );
  }

  function renderHistory() {
    clear(historyHost);
    const history = loadHistory().slice(0, 6);
    if (!history.length) return;
    const menu = getMenu();
    const dishMap = new Map((menu?.dishes || []).map((dish) => [dish.id, dish]));
    historyHost.append(
      sectionTitle('最近的签'),
      el('div', { class: 'history-list' }, history.map((entry) => historyItem(entry, {
        dish: dishMap.get(entry.primaryDishId),
      }))),
    );
  }

  function renderResult(next, { shared = false, animate = false } = {}) {
    result = next;
    clear(resultHost);
    resultHost.hidden = false;

    if (!next.ok) {
      resultHost.append(emptyState('这次没抽到', next.hint || '换个筛选条件再试一次', button('重新筛选', {
        variant: 'ghost',
        onClick: () => openFilters(),
      })));
      return;
    }

    const menu = getMenu();
    const favorites = loadFavorites();
    const { canteen, floor, cuisine, dishes, others } = next;

    const head = el('div', { class: 'result__head' }, [
      ticketChip(next.ticket, { seed: next.seed }),
      el('div', { class: 'result__head-actions' }, [
        el('button', { class: 'icon-btn', type: 'button', title: '分享这一签', text: '⤴', onclick: () => share(next) }),
      ]),
    ]);

    const pushCard = el('article', { class: `push card${animate ? ' is-revealed' : ''}` }, [
      el('div', { class: 'push__glow' }),
      el('div', { class: 'push__emoji', text: cuisine?.emoji || '🍽' }),
      el('div', { class: 'push__label', text: '本次推送菜系' }),
      el('h2', { class: 'push__name', text: cuisine?.name || '暂无菜系' }),
      cuisine ? el('p', { class: 'push__keywords', text: (cuisine.keywords || []).join(' · ') }) : null,
      el('div', { class: 'push__stats' }, [
        el('span', { text: `${next.dishesOfCuisine} 道可选` }),
        el('span', { class: 'dot' }),
        el('span', { text: `位于 ${canteen.name}${floor ? ` · ${next.floorLabel}` : ''}` }),
      ]),
    ]);

    const targets = el('div', { class: 'targets' }, [
      el('div', { class: 'target' }, [
        el('span', { class: 'target__label', text: '饭堂' }),
        el('strong', { class: 'target__value', text: canteen.name }),
        el('span', { class: 'target__sub', text: canteen.category || '' }),
      ]),
      el('div', { class: 'target' }, [
        el('span', { class: 'target__label', text: '楼层' }),
        el('strong', { class: 'target__value', text: floor ? next.floorLabel : '未标注' }),
        el('span', { class: 'target__sub', text: floor ? floor : '该饭堂暂未标注楼层' }),
      ]),
    ]);

    const dishList = el('div', { class: `dish-list dish-list--push${animate ? '' : ' no-anim'}` }, dishes.map((dish, index) => {
      const card = dishCard(dish, {
        canteen,
        favorite: favorites.includes(dish.id),
        onFavorite: (item) => {
          toggleFavorite(item.id);
          renderResult(next, { shared });
          toast(favorites.includes(item.id) ? '已取消收藏' : '已收藏', { tone: 'ok' });
        },
      });
      card.style.setProperty('--i', String(index));
      return card;
    }));

    const actions = el('div', { class: 'result__actions' }, [
      button('换个菜系', { variant: 'soft', onClick: () => runRedrawCuisine() }),
      button('重新抽', { variant: 'ghost', onClick: () => runDraw() }),
      button('就吃这个', {
        variant: 'primary',
        onClick: () => {
          markEaten(next.ticket);
          renderHistory();
          toast('已记下，下次会避开它', { tone: 'ok' });
        },
      }),
    ]);

    const warnings = next.warnings?.length
      ? el('div', { class: 'warnings' }, next.warnings.map((text) => el('p', { class: 'warning', text: `⚠️ ${text}` })))
      : null;

    const transparency = el('details', { class: 'faq' }, [
      el('summary', { text: '概率透明 · 这一签怎么来的' }),
      el('div', { class: 'faq__body' }, [
        el('p', { text: `候选池 ${next.poolSize} 道菜；当前饭堂候选 ${next.canteenPoolSize} 道。抽签用签号做种子，规则固定、结果可复现。` }),
        el('div', { class: 'prob-list' }, next.weights.canteens
          .slice()
          .sort((a, b) => b.probability - a.probability)
          .slice(0, 6)
          .map((row) => el('div', { class: 'prob-row' }, [
            el('span', { class: 'prob-row__name', text: row.name }),
            el('span', { class: 'prob-row__bar' }, [
              el('i', { style: `width:${Math.max(2, Math.round(row.probability * 100))}%` }),
            ]),
            el('span', { class: 'prob-row__value', text: `${(row.probability * 100).toFixed(1)}%` }),
          ]))),
        el('p', { class: 'faq__seed', text: `seed = ${next.seed}（${next.seedKind === 'daily' ? '每日固定' : next.seedKind === 'explicit' ? '来自分享' : '本次随机'}）` }),
      ]),
    ]);

    const othersBlock = others.length
      ? el('div', { class: 'others' }, [
        sectionTitle(`${canteen.name} 其他可选`),
        el('div', { class: 'dish-list dish-list--compact' }, others.map((dish) => dishCard(dish, { canteen }))),
      ])
      : null;

    // 自选窗口：当天上传的菜（带照片）+ 这层有哪些窗口
    const todayDishes = (menu.dishes || []).filter((dish) => (
      dish.date === menu.today
      && dish.canteenId === canteen.id
      && dish.type !== 'stall_recommendation'
      && (floor ? dish.floor === floor : true)
    ));
    const todayBlock = todayDishes.length
      ? el('div', { class: 'today-section' }, [
        sectionTitle(`今日自选 · ${dateLabel(menu.today, menu.today)}`, el('span', { class: 'pill', text: `${todayDishes.length} 道` })),
        todayBoard(todayDishes, { canteen, favorites, onFavorite: (item) => {
          toggleFavorite(item.id);
          renderResult(next, { shared });
        } }),
        el('p', { class: 'up__hint', text: '自选窗口的菜每天更新，只当天参与抽签' }),
      ])
      : null;

    const stallsHere = stallsOf(menu, { canteenId: canteen.id, floor: floor ?? undefined });
    const stallBlock = stallsHere.length
      ? el('div', { class: 'stall-section' }, [
        sectionTitle('这层的窗口', el('span', { class: 'pill', text: `${stallsHere.length} 个` })),
        stallStrip(stallsHere),
      ])
      : null;

    mount(resultHost, head, pushCard, targets, todayBlock, warnings, dishList,
      stallBlock, actions, transparency, othersBlock);
    if (shared) highlightShared();
  }

  function highlightShared() {
    clear(shareBanner);
    shareBanner.hidden = false;
    shareBanner.append(
      el('span', { text: '这是同学分享的签，已按同一签号本地复现' }),
      el('button', { class: 'link', type: 'button', text: '我也抽一签', onclick: () => { shareBanner.hidden = true; runDraw(); } }),
    );
  }

  /* ------------------------------------------------------------ 抽签 */

  function buildOptions() {
    const recent = recentContext();
    return {
      ...settings,
      ...recent,
      avoidRecent: settings.avoidRecent,
    };
  }

  async function runDraw() {
    const menu = getMenu();
    if (!menu) { onNeedMenu?.(); return; }
    if (busy) return;
    busy = true;
    drawButton.disabled = true;
    resultHost.hidden = true;
    sharedFromLink = false;
    shareBanner.hidden = true;

    const canteenNames = menu.canteens.map((c) => c.name);
    const floorNames = ['一层', '二层', '三层', '楼层未标注'];
    const cuisineNames = menu.cuisines.map((c) => `${c.emoji || ''}${c.name}`);

    const next = draw(menu, buildOptions());
    if (!next.ok) {
      renderResult(next);
      busy = false;
      drawButton.disabled = false;
      return;
    }

    // 三行一起转，然后自上而下依次锁定：每锁定一行就有一次高亮 + 粒子
    const steps = [
      {
        row: rowCanteen, roller: rollers.canteen, delay: 640,
        pool: canteenNames, final: next.canteen.name,
      },
      {
        row: rowFloor, roller: rollers.floor, delay: 260,
        pool: floorNames, final: next.floor ? next.floorLabel : '楼层未标注',
      },
      {
        row: rowCuisine, roller: rollers.cuisine, delay: 260,
        pool: cuisineNames,
        final: next.cuisine ? `${next.cuisine.emoji || ''}${next.cuisine.name}` : '暂无菜系',
      },
    ];
    stage.classList.add('is-drawing');
    drawButton.classList.add('is-busy');
    setDrawLabel('抽签中');
    steps.forEach(({ row, roller, pool }) => {
      row.classList.remove('is-locked');
      row.classList.add('is-active');
      roller.start(() => randomOf(pool));
    });

    for (const step of steps) {
      await step.roller.stop(step.final, { delay: step.delay });
      step.row.classList.remove('is-active');
      step.row.classList.add('is-locked');
      burst(step.row);
    }

    renderResult(next, { animate: true });

    // 结果已经出现，立刻恢复可交互；签号乱码是揭晓后的点缀，不拖住状态机
    stage.classList.remove('is-drawing');
    drawButton.classList.remove('is-busy');
    setDrawLabel('开始抽签');
    busy = false;
    drawButton.disabled = false;

    recordDraw(next);
    renderHistory();
    refreshStage();
    await scramble(resultHost.querySelector('.ticket__value'), next.ticket);
  }

  async function runRedrawCuisine() {
    const menu = getMenu();
    if (!menu || !result?.ok || busy) return;
    busy = true;
    const next = redrawCuisine(menu, result, buildOptions());
    if (next.ok && next.cuisine) {
      rowCuisine.classList.remove('is-locked');
      rowCuisine.classList.add('is-active');
      await rollers.cuisine.stop(`${next.cuisine.emoji || ''}${next.cuisine.name}`, { delay: 0 });
      rowCuisine.classList.remove('is-active');
      rowCuisine.classList.add('is-locked');
      burst(rowCuisine);
    }
    renderResult(next, { animate: true });
    recordDraw(next);
    renderHistory();
    refreshStage();
    busy = false;
  }

  function applySharedOptions() {
    const options = optionsFromHash(location.hash);
    if (!options) return false;
    const menu = getMenu();
    if (!menu) return false;
    const next = draw(menu, { ...options, avoidRecent: false });
    settings = { ...settings, cuisines: options.cuisines || [], maxSpicyLevel: options.maxSpicyLevel, maxPrice: options.maxPrice };
    renderResult(next, { shared: true });
    reelCanteen.textContent = next.canteen?.name || '—';
    reelFloor.textContent = next.floor ? next.floorLabel : '楼层未标注';
    reelCuisine.textContent = next.cuisine ? `${next.cuisine.emoji || ''}${next.cuisine.name}` : '—';
    sharedFromLink = true;
    return true;
  }

  /* ------------------------------------------------------------ 筛选 */

  function openFilters() {
    const menu = getMenu();
    if (!menu) { onNeedMenu?.(); return; }
    const { body, close } = bottomSheet({ title: '筛选' });
    const cuisineItems = menu.cuisines
      .slice()
      .sort((a, b) => b.dishCount - a.dishCount)
      .map((cuisine) => ({ label: cuisine.name, value: cuisine.id, emoji: cuisine.emoji, count: cuisine.dishCount }));

    body.append(
      el('div', { class: 'sheet__group' }, [
        el('div', { class: 'sheet__label', text: '辣度上限' }),
        segmented(SPICY_OPTIONS, {
          value: settings.maxSpicyLevel,
          onChange: (value) => { settings.maxSpicyLevel = value; },
        }),
      ]),
      el('div', { class: 'sheet__group' }, [
        el('div', { class: 'sheet__label', text: '人均预算' }),
        segmented(PRICE_OPTIONS, {
          value: settings.maxPrice,
          onChange: (value) => { settings.maxPrice = value; },
        }),
      ]),
      el('div', { class: 'sheet__group' }, [
        el('div', { class: 'sheet__label', text: '只要这些菜系（可多选）' }),
        chipRow(cuisineItems, {
          multi: true,
          value: settings.cuisines || [],
          onChange: (value) => { settings.cuisines = value; },
        }),
      ]),
      el('div', { class: 'sheet__group' }, [
        toggleRow('避开最近吃过的', {
          checked: settings.avoidRecent,
          hint: '最近 5 次抽到的菜不再出现，避免连着吃同一道',
          onChange: (value) => { settings.avoidRecent = value; },
        }),
        toggleRow('只看有楼层标注的饭堂', {
          checked: settings.labeledFloorsOnly,
          hint: `当前 ${menu.dishes.filter((d) => d.floor).length} 道菜有明确楼层`,
          onChange: (value) => { settings.labeledFloorsOnly = value; },
        }),
        toggleRow('包含往日的自选菜', {
          checked: Boolean(settings.includePastDaily),
          hint: '自选菜天天变，默认只用今天上传的',
          onChange: (value) => { settings.includePastDaily = value; },
        }),
      ]),
      el('div', { class: 'sheet__footer' }, [
        button('重置', {
          variant: 'ghost',
          onClick: () => {
            settings = { maxSpicyLevel: null, maxPrice: null, cuisines: [], avoidRecent: true, labeledFloorsOnly: false };
            saveSettings(settings);
            close();
            refreshStage();
            toast('筛选已重置');
          },
        }),
        button('完成', {
          variant: 'primary',
          onClick: () => {
            saveSettings(settings);
            close();
            refreshStage();
          },
        }),
      ]),
    );
  }

  /* ------------------------------------------------------------ 分享 */

  async function share(next) {
    const url = currentUrlFor(hashForResult(next));
    const text = buildShareText(next, { url });
    if (navigator.share) {
      try {
        await navigator.share({ title: SHARE_TITLE, text, url });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('分享文案已复制，去粘给同学吧', { tone: 'ok' });
    } catch (error) {
      window.prompt('复制下面的分享内容：', text);
    }
  }

  /* ------------------------------------------------------------ 生命周期 */

  return {
    root,
    onMenuReady() {
      refreshStage();
      renderHistory();
      if (!applySharedOptions()) return;
    },
    onRoute(route) {
      if (route.name === 'r') applySharedOptions();
    },
    destroy() {},
  };
}
