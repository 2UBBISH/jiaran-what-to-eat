/** 浏览视图：按饭堂 / 菜系翻菜单（展示层，只读） */

import { el, clear } from './dom.js';
import {
  dishCard, emptyState, tagPill, stallStrip, todayBoard, toggleRow, sectionTitle, stallDishCard,
} from './components.js';
import { filterDishes, stallsOf } from '../core/menu.js';
import { dateLabel } from '../core/date.js';
import { floorLabel } from '../core/format.js';
import { loadFavorites, toggleFavorite } from '../userData.js';

export function createBrowseView({ getMenu }) {
  let mode = 'canteen';
  let keyword = '';
  let showPastDaily = false;
  let detail = null; // { type: 'canteen'|'cuisine', id }

  const listHost = el('div', { class: 'browse__list' });
  const searchInput = el('input', {
    class: 'input input--search',
    type: 'search',
    placeholder: '搜菜名 / 窗口 / 饭堂',
    oninput: (e) => { keyword = e.target.value.trim(); render(); },
  });

  const modeRow = el('div', { class: 'segmented segmented--browse' });

  const root = el('div', { class: 'view view--browse' }, [
    el('header', { class: 'hero hero--compact' }, [
      el('div', { class: 'hero__eyebrow', text: '清华食堂 · 全部菜单' }),
      el('h1', { class: 'hero__title', text: '逛一逛' }),
    ]),
    el('div', { class: 'browse__bar card card--glass' }, [
      modeRow,
      searchInput,
      toggleRow('显示往日的窗口菜色', {
        checked: showPastDaily,
        hint: '窗口的菜天天变，默认只看今天的',
        onChange: (value) => { showPastDaily = value; render(); },
      }),
    ]),
    listHost,
  ]);

  function renderModeRow() {
    clear(modeRow);
    [['canteen', '按饭堂'], ['cuisine', '按菜系'], ['stall', '窗口']].forEach(([value, label]) => {
      modeRow.append(el('button', {
        class: `segmented__item${mode === value ? ' is-active' : ''}`,
        type: 'button',
        text: label,
        onclick: () => { mode = value; detail = null; render(); },
      }));
    });
  }

  function renderCanteenList(menu) {
    const dishes = filterDishes(menu, { keyword, includeStallRecommendations: true });
    const counts = new Map();
    dishes.forEach((dish) => counts.set(dish.canteenId, (counts.get(dish.canteenId) || 0) + 1));
    const rows = menu.canteens.filter((canteen) => counts.has(canteen.id));
    if (!rows.length) return emptyState('没有匹配的饭堂', '换个关键词试试');
    const host = el('div', { class: 'grid' });
    rows.forEach((canteen) => {
      host.append(el('button', {
        class: 'card card--tap canteen-card',
        type: 'button',
        onclick: () => { detail = { type: 'canteen', id: canteen.id }; render(); },
      }, [
        el('div', { class: 'canteen-card__head' }, [
          el('h3', { text: canteen.name }),
          el('span', { class: 'pill', text: `${counts.get(canteen.id)} 道` }),
        ]),
        el('div', { class: 'canteen-card__meta', text: `${canteen.category}${canteen.status === 'discontinued' ? ' · 已停业' : ''}` }),
        el('div', { class: 'canteen-card__floors' }, [
          ...(canteen.floors.length
            ? canteen.floors.map((floor) => tagPill(`${floorLabel(floor.floor)} ${floor.dishCount}`))
            : [tagPill('楼层未标注')]),
          menu.stalls.some((stall) => stall.canteenId === canteen.id && stall.todayDishCount)
            ? tagPill('今日有新菜', 'spicy')
            : null,
        ].filter(Boolean)),
        el('div', { class: 'canteen-card__cuisines' }, canteen.cuisines.slice(0, 6).map((id) => {
          const cuisine = menu.cuisines.find((c) => c.id === id);
          return cuisine ? el('span', { class: 'emoji', title: cuisine.name, text: cuisine.emoji || '•' }) : null;
        })),
      ]));
    });
    return host;
  }

  function renderCuisineList(menu) {
    const rows = menu.cuisines
      .filter((cuisine) => cuisine.dishCount > 0)
      .filter((cuisine) => {
        if (!keyword) return true;
        const hay = `${cuisine.name}|${(cuisine.keywords || []).join('|')}`;
        return hay.includes(keyword);
      })
      .sort((a, b) => b.dishCount - a.dishCount);
    if (!rows.length) return emptyState('没有匹配的菜系', '换个关键词试试');
    const host = el('div', { class: 'grid' });
    rows.forEach((cuisine) => {
      const dishes = filterDishes(menu, { cuisines: [cuisine.id], includeStallRecommendations: true });
      host.append(el('button', {
        class: 'card card--tap cuisine-card',
        type: 'button',
        onclick: () => { detail = { type: 'cuisine', id: cuisine.id }; render(); },
      }, [
        el('div', { class: 'cuisine-card__emoji', text: cuisine.emoji || '🍽' }),
        el('div', { class: 'cuisine-card__body' }, [
          el('h3', { text: cuisine.name }),
          el('p', { class: 'cuisine-card__keywords', text: (cuisine.keywords || []).join(' · ') }),
          el('p', { class: 'cuisine-card__meta', text: `${dishes.length} 道 · ${cuisine.canteenIds?.length || 0} 个饭堂` }),
        ]),
      ]));
    });
    return host;
  }

  /**
   * 「窗口」页签：菜一定挂在某个窗口下，所以这里列窗口。
   * 每个窗口一张卡（封面上传一次即可），点进去看它按日期分组的菜色。
   */
  function renderStallList(menu) {
    const dailies = filterDishes(menu, { onlyDaily: true, includePastDaily: true });
    const counts = new Map();
    dailies.forEach((dish) => {
      const key = `${dish.canteenId}|${dish.floor || ''}|${dish.stallName || ''}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    // 列出饭堂里所有窗口（有照片、有菜的排前面）—— 窗口就是打饭的地方
    const windows = (menu.stalls || [])
      .filter((stall) => {
        if (!keyword) return true;
        const canteen = menu.canteens.find((c) => c.id === stall.canteenId);
        return `${stall.name}|${canteen?.name || ''}`.includes(keyword);
      })
      .sort((a, b) => {
        const score = (stall) => (stall.image ? 2 : 0) + (stall.dishCount ? 1 : 0);
        return score(b) - score(a) || b.dishCount - a.dishCount || a.name.localeCompare(b.name);
      });

    if (!windows.length) {
      return emptyState(
        '还没有窗口记录',
        '打开「窗口菜色快传」，选好饭堂/楼层/窗口拍几张照片就有了',
        el('a', { class: 'link', href: 'upload.html', text: '去上传 →' }),
      );
    }

    const canteenMap = new Map(menu.canteens.map((canteen) => [canteen.id, canteen]));
    const host = el('div', {});
    host.append(el('p', { class: 'up__hint', text: '窗口 = 你在食堂打饭的那个窗口；点卡片看它各天的菜色' }));
    host.append(el('div', { class: 'stall-window-grid' }, windows.map((stall) => {
      const key = `${stall.canteenId}|${stall.floor || ''}|${stall.name}`;
      const todayDishes = dailies.filter((dish) => (
        `${dish.canteenId}|${dish.floor || ''}|${dish.stallName || ''}` === key && dish.date === menu.today
      ));
      const card = stallDishCard(stall, todayDishes, { canteen: canteenMap.get(stall.canteenId) });
      const badge = el('span', { class: 'pill', text: `共 ${counts.get(key) || 0} 道` });
      card.querySelector('.stall-dish-card__head')?.append(badge);
      const open = el('button', {
        class: 'btn btn--ghost btn--tiny',
        type: 'button',
        text: '看全部日期',
        onclick: () => { detail = { type: 'stall', id: stall.id }; render(); },
      });
      card.querySelector('.stall-dish-card__actions')
    || card.querySelector('.stall-dish-card__body')?.append(el('div', { class: 'stall-dish-card__actions' }, [open]));
      card.querySelector('.stall-dish-card__actions')?.append(open);
      return card;
    })));
    return host;
  }

  /** 某个窗口的全部菜色，按日期倒序 */
  function renderStallDetail(menu) {
    const stall = (menu.stalls || []).find((item) => item.id === detail.id);
    if (!stall) { detail = null; return render(); }
    const canteen = menu.canteens.find((c) => c.id === stall.canteenId);
    const dishes = filterDishes(menu, {
      onlyDaily: true,
      includePastDaily: true,
      keyword,
    }).filter((dish) => dish.stallName === stall.name && dish.canteenId === stall.canteenId
      && (dish.floor || null) === (stall.floor || null));

    const dates = [...new Set(dishes.map((dish) => dish.date))].sort().reverse();
    const host = el('div', {}, [
      el('div', { class: 'detail__head' }, [
        el('button', { class: 'link', type: 'button', text: '‹ 返回', onclick: () => { detail = null; render(); } }),
        el('h1', { class: 'detail__title', text: stall.name }),
        el('p', { class: 'detail__sub', text: [
          canteen?.name,
          stall.floor ? floorLabel(stall.floor) : '楼层未标注',
          `${dishes.length} 道`,
          stall.note || '',
        ].filter(Boolean).join(' · ') }),
      ]),
    ]);

    if (stall.image) {
      host.append(el('div', { class: 'stall-detail__cover', dataset: { gallery: 'stall-cover' } }, [
        el('img', {
          class: 'zoomable',
          src: stall.image,
          alt: `${stall.name} 封面`,
          title: '点击看大图',
          dataset: { zoomTitle: `${stall.name}（窗口照片）`, zoomMeta: canteen?.name || '' },
        }),
      ]));
    }

    dates.forEach((date) => {
      const items = dishes.filter((dish) => dish.date === date);
      host.append(el('div', { class: 'floor-block' }, [
        el('div', { class: 'floor-block__head' }, [
          el('h2', { text: dateLabel(date, menu.today) }),
          el('span', { class: 'pill', text: `${items.length} 道` }),
          el('span', { class: 'pill', text: date }),
        ]),
        el('div', { class: 'dish-list', dataset: { gallery: `stall-${date}` } }, items.map((dish) => dishCard(dish, {
          canteen,
          favorite: loadFavorites().includes(dish.id),
          onFavorite: (item) => { toggleFavorite(item.id); render(); },
        }))),
      ]));
    });
    return host;
  }

  /** 把某饭堂的菜按窗口聚合（与抽签页同一口径） */
  function groupByWindowForCanteen(menu, dishes) {
    const stallMap = new Map((menu.stalls || []).map((stall) => [
      `${stall.canteenId}|${stall.floor || ''}|${stall.name}`, stall,
    ]));
    const groups = new Map();
    dishes.forEach((dish) => {
      const key = `${dish.canteenId}|${dish.floor || ''}|${dish.stallName || '未标注窗口'}`;
      if (!groups.has(key)) {
        groups.set(key, {
          stall: stallMap.get(key) || {
            id: key, canteenId: dish.canteenId, floor: dish.floor,
            name: dish.stallName || '未标注窗口', windowType: '窗口', image: null, note: null,
          },
          dishes: [],
        });
      }
      groups.get(key).dishes.push(dish);
    });
    return [...groups.values()];
  }

  function renderDetail(menu) {
    const favorites = loadFavorites();
    const back = el('button', { class: 'link', type: 'button', text: '‹ 返回', onclick: () => { detail = null; render(); } });
    let title = '';
    let dishes = [];

    if (detail.type === 'canteen') {
      const canteen = menu.canteens.find((c) => c.id === detail.id);
      if (!canteen) { detail = null; return render(); }
      title = canteen.name;
      dishes = filterDishes(menu, {
        canteenId: canteen.id, keyword, includeStallRecommendations: true,
        includePastDaily: showPastDaily,
      });
      const byFloor = new Map();
      dishes.forEach((dish) => {
        const key = dish.floor || '__none__';
        if (!byFloor.has(key)) byFloor.set(key, []);
        byFloor.get(key).push(dish);
      });
      const todayDishes = menu.dishes.filter((dish) => dish.date === menu.today && dish.canteenId === canteen.id);
      const stalls = stallsOf(menu, { canteenId: canteen.id });
      const host = el('div', {}, [
        el('div', { class: 'detail__head' }, [
          back,
          el('h1', { class: 'detail__title', text: title }),
          el('p', { class: 'detail__sub', text: `${canteen.category} · ${dishes.length} 道 · ${canteen.note || ''}` }),
        ]),
        todayDishes.length
          ? el('div', { class: 'today-section' }, [
            sectionTitle(
              `${dateLabel(menu.today, menu.today)}窗口的菜`,
              el('span', { class: 'pill', text: `${todayDishes.length} 道` }),
            ),
            el('div', { class: 'stall-window-grid' }, groupByWindowForCanteen(menu, todayDishes).map((group) => (
              stallDishCard(group.stall, group.dishes, { canteen })
            ))),
          ])
          : null,
        stalls.length
          ? el('div', { class: 'stall-section' }, [
            sectionTitle('窗口', el('span', { class: 'pill', text: `${stalls.length} 个` })),
            stallStrip(stalls),
          ])
          : null,
      ]);
      [...byFloor.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .forEach(([floor, items]) => {
          host.append(el('div', { class: 'floor-block' }, [
            el('div', { class: 'floor-block__head' }, [
              el('h2', { text: floor === '__none__' ? '楼层未标注' : floorLabel(floor) }),
              el('span', { class: 'pill', text: `${items.length} 道` }),
            ]),
            el('div', { class: 'dish-list', dataset: { gallery: `floor-${floor}` } }, items.map((dish) => dishCard(dish, {
              canteen,
              favorite: favorites.includes(dish.id),
              onFavorite: (item) => { toggleFavorite(item.id); render(); },
            }))),
          ]));
        });
      return host;
    }

    if (detail.type === 'stall') return renderStallDetail(menu);

    const cuisine = menu.cuisines.find((c) => c.id === detail.id);
    if (!cuisine) { detail = null; return render(); }
    dishes = filterDishes(menu, { cuisines: [cuisine.id], keyword, includeStallRecommendations: true });
    const canteenMap = new Map(menu.canteens.map((c) => [c.id, c]));
    return el('div', {}, [
      el('div', { class: 'detail__head' }, [
        back,
        el('h1', { class: 'detail__title', text: `${cuisine.emoji || ''} ${cuisine.name}` }),
        el('p', { class: 'detail__sub', text: `${dishes.length} 道 · ${(cuisine.keywords || []).join(' · ')}` }),
      ]),
      el('div', { class: 'dish-list' }, dishes.map((dish) => dishCard(dish, {
        canteen: canteenMap.get(dish.canteenId),
        favorite: favorites.includes(dish.id),
        onFavorite: (item) => { toggleFavorite(item.id); render(); },
      }))),
    ]);
  }

  function render() {
    const menu = getMenu();
    clear(listHost);
    renderModeRow();
    if (!menu) {
      listHost.append(emptyState('正在读取菜单…'));
      return;
    }
    if (detail) {
      listHost.append(renderDetail(menu));
      return;
    }
    listHost.append(detailBreadcrumb());
    if (mode === 'stall') listHost.append(renderStallList(menu));
    else listHost.append(mode === 'canteen' ? renderCanteenList(menu) : renderCuisineList(menu));
  }

  function detailBreadcrumb() {
    const menu = getMenu();
    return el('div', { class: 'browse__summary' }, [
      el('span', {
        text: mode === 'canteen'
          ? `${menu.canteens.length} 个饭堂`
          : (mode === 'cuisine'
            ? `${menu.cuisines.filter((c) => c.dishCount).length} 个菜系`
            : `${(menu.stalls || []).length} 个窗口`),
      }),
      el('span', { class: 'dot' }),
      el('span', { text: `${menu.dishes.length} 道菜` }),
      menu.meta?.stats?.communityDishCount
        ? el('span', { class: 'pill pill--community', text: `含 ${menu.meta.stats.communityDishCount} 道同学上传` })
        : null,
    ]);
  }

  return { root, onMenuReady: render, onRoute: render, destroy() {} };
}
