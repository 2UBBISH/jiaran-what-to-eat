/**
 * 自选菜快传（upload.html）
 * ---------------------------------------------------------------------------
 * 为「一天要传好几次」设计：
 *   - 位置（饭堂/楼层/窗口）与菜系记住上次选择，下次打开直接传
 *   - 一次可选多张照片，拍完只补菜名
 *   - 照片与内容走 saveMany(records, { images })，线上只产生 1 个 commit
 *   - 日期默认今天：自选菜只当天有效，第二天自动退场（不会污染抽签池）
 *   - 同窗口同一天同名会自动去重（重拍/重复上传不会放大抽签权重）
 */

import { el, clear, mount, qs } from './dom.js';
import {
  button, chipRow, segmented, field, input, select, toast,
  sectionTitle, emptyState, tagPill, toggleRow,
} from './components.js';
import { validateContribution } from '../core/menu.js';
import { dateKey, dateLabel } from '../core/date.js';
import { uploadPathFor } from '../data/contract.js';
import { loadConfig, saveConfig, createDataSource, SOURCE_MODES, describeConfig } from '../data/index.js';
import { prepareImageAsset, imageAccept } from './image.js';
import { KEYS, getJSON, setJSON } from '../data/local.js';
import { APP_NAME } from '../brand.js';

const PREFS_KEY = 'tsc:upload:prefs';
const AUTHOR_KEY = 'tsc:author';

function newId(prefix) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${stamp}-${prefix}${rand}`;
}

// prepareImage 可注入：单元/DOM 测试里用假的压缩实现，避免依赖 canvas
export function createUploadView({ root, prepareImage = prepareImageAsset }) {
  let config = loadConfig();
  let source = createDataSource(config);
  let menu = null;
  let busy = false;
  let lastResult = null;
  let validationErrors = [];
  let showSettings = false;

  const prefs = { cuisines: ['homestyle'], canteenId: '', floor: '', stallName: '', spicyLevel: 0, reviewLabel: '好评', ...getJSON(PREFS_KEY, {}) };
  const state = {
    date: dateKey(),
    customDate: dateKey(),
    useCustomDate: false,
    windowType: '自选',
    entries: [], // { asset, name, priceText, key }
    windowPhoto: null,
  };
  const author = getJSON(AUTHOR_KEY, '') || '';

  const sourceHost = el('section', { class: 'card up__block' });
  const locationHost = el('section', { class: 'card up__block' });
  const photoHost = el('section', { class: 'card up__block' });
  const sharedHost = el('section', { class: 'card up__block' });
  const submitHost = el('section', { class: 'card up__block' });

  const container = el('div', { class: 'view view--upload' }, [
    el('header', { class: 'hero hero--compact' }, [
      el('div', { class: 'hero__eyebrow', text: '自选窗口 · 高频上传' }),
      el('h1', { class: 'hero__title', text: '传今天的自选菜' }),
      el('p', { class: 'hero__sub', text: '拍几张照片，补上菜名就行；只当天有效，第二天自动退场' }),
    ]),
    sourceHost,
    locationHost,
    photoHost,
    sharedHost,
    submitHost,
  ]);
  root.append(container);

  const persistPrefs = () => setJSON(PREFS_KEY, prefs);

  async function reload() {
    try {
      const { menu: loaded } = await source.loadMenu();
      menu = loaded;
    } catch (error) {
      menu = null;
      toast(`读取数据失败：${error.message}`, { tone: 'bad', timeout: 5200 });
    }
  }

  /* --------------------------------------------------------- 数据源状态 */

  function renderSource() {
    clear(sourceHost);
    const mode = SOURCE_MODES.find((m) => m.id === config.mode);
    const writable = source.capabilities.write;
    mount(
      sourceHost,
      el('div', { class: 'up__row' }, [
        el('div', { class: 'up__row-main' }, [
          el('div', { class: 'up__label', text: '数据源' }),
          el('div', { class: 'up__value', text: `${mode?.name || config.mode}${writable ? '' : ' · 只读'}` }),
        ]),
        button(showSettings ? '收起' : '设置', {
          variant: 'ghost',
          onClick: () => { showSettings = !showSettings; renderSource(); },
        }),
      ]),
      writable ? null : el('p', { class: 'up__hint up__hint--warn', text: '当前数据源不能上传：展开「设置」切到 GitHub 仓库（线上）或本地演示（试传）' }),
      showSettings ? renderSourceSettings() : null,
    );
  }

  function renderSourceSettings() {
    const gh = config.github;
    const wrap = el('div', { class: 'up__settings' });
    wrap.append(
      segmented(SOURCE_MODES.map((m) => ({ label: m.writes ? `${m.name.split('（')[0]} ✎` : m.name.split('（')[0], value: m.id })), {
        value: config.mode,
        onChange: async (value) => {
          config = { ...config, mode: value };
          saveConfig(config);
          source = createDataSource(config);
          showSettings = value === 'github';
          await reload();
          render();
        },
      }),
      config.mode === 'github' ? el('div', { class: 'field-grid' }, [
        field('owner', input({ value: gh.owner, placeholder: 'GitHub 用户名', oninput: (e) => { gh.owner = e.target.value.trim(); } })),
        field('repo', input({ value: gh.repo, placeholder: '仓库名', oninput: (e) => { gh.repo = e.target.value.trim(); } })),
        field('branch', input({ value: gh.branch, placeholder: 'main', oninput: (e) => { gh.branch = e.target.value.trim() || 'main'; } })),
        field('Token', input({ value: gh.token, type: 'password', placeholder: 'github_pat_…', oninput: (e) => { gh.token = e.target.value.trim(); } }), '只存在本机浏览器；需要 Contents: Read and write'),
      ]) : null,
      el('div', { class: 'up__row' }, [
        button('保存并测试', {
          onClick: async () => {
            saveConfig(config);
            source = createDataSource(config);
            const health = await source.health();
            toast(health.detail, { tone: health.ok && health.writable ? 'ok' : 'bad', timeout: 5200 });
            await reload();
            render();
          },
        }),
        el('a', { class: 'link', href: 'admin.html', text: '完整内容管理 →' }),
      ]),
      el('p', { class: 'up__hint', text: describeConfig(config).github }),
    );
    return wrap;
  }

  /* ------------------------------------------------------------- 位置 */

  function renderLocation() {
    clear(locationHost);
    if (!menu) {
      locationHost.append(emptyState('菜单还没加载完'));
      return;
    }
    const canteenOptions = menu.canteens
      .filter((canteen) => canteen.status !== 'discontinued')
      .map((canteen) => ({ value: canteen.id, label: canteen.name }));
    if (!prefs.canteenId || !canteenOptions.some((o) => o.value === prefs.canteenId)) {
      prefs.canteenId = canteenOptions[0]?.value || '';
    }

    const floors = menu.canteens.find((c) => c.id === prefs.canteenId)?.floors || [];
    const floorItems = [{ label: '未标注', value: '' }]
      .concat(floors.map((f) => ({ label: f.label || f.floor, value: f.floor })));
    if (prefs.floor && !floorItems.some((item) => item.value === prefs.floor)) prefs.floor = '';

    const stalls = (menu.stalls || []).filter((stall) => (
      stall.canteenId === prefs.canteenId && (stall.floor || '') === (prefs.floor || '')
    ));

    const stallInput = input({
      value: prefs.stallName,
      placeholder: '例如：自选窗口 / 二楼自选',
      oninput: (e) => { prefs.stallName = e.target.value.trim(); persistPrefs(); renderSubmit(); },
    });

    mount(
      locationHost,
      sectionTitle('在哪', el('span', { class: 'pill', text: '记上次的选择' })),
      field('饭堂', select(canteenOptions, {
        value: prefs.canteenId,
        onChange: (value) => { prefs.canteenId = value; prefs.floor = ''; prefs.stallName = ''; persistPrefs(); render(); },
      })),
      el('div', { class: 'up__block-inner' }, [
        el('div', { class: 'up__label', text: '楼层' }),
        segmented(floorItems, {
          value: prefs.floor,
          onChange: (value) => { prefs.floor = value; prefs.stallName = ''; persistPrefs(); render(); },
        }),
      ]),
      el('div', { class: 'up__block-inner' }, [
        el('div', { class: 'up__label', text: '窗口' }),
        stalls.length ? el('div', { class: 'chip-row' }, stalls.map((stall) => el('button', {
          class: `chip${prefs.stallName === stall.name ? ' is-active' : ''}`,
          type: 'button',
          onclick: () => { prefs.stallName = stall.name; state.windowType = stall.windowType || '自选'; persistPrefs(); render(); },
        }, [
          el('span', { text: stall.name }),
          stall.windowType === '自选' ? el('span', { class: 'chip__count', text: '自选' }) : null,
          stall.todayDishCount ? el('span', { class: 'chip__count', text: `今日 ${stall.todayDishCount}` }) : null,
        ]))) : el('p', { class: 'up__hint', text: '这个楼层还没有窗口记录，直接输入名字即可，提交时自动建档' }),
        field('窗口名', stallInput, '新窗口会在提交时自动建成「自选」窗口'),
      ]),
      el('div', { class: 'up__block-inner' }, [
        el('div', { class: 'up__label', text: '日期（自选菜只当天有效）' }),
        segmented([
          { label: '今天', value: 'today' },
          { label: '昨天', value: 'yesterday' },
          { label: '自定义', value: 'custom' },
        ], {
          value: state.useCustomDate ? 'custom' : (state.date === dateKey() ? 'today' : 'yesterday'),
          onChange: (value) => {
            state.useCustomDate = value === 'custom';
            if (value === 'today') state.date = dateKey();
            if (value === 'yesterday') state.date = dateKey(Date.now() - 86400000);
            if (value === 'custom') state.date = state.customDate;
            render();
          },
        }),
        state.useCustomDate ? input({
          type: 'date',
          value: state.customDate,
          onchange: (e) => { state.customDate = e.target.value; state.date = e.target.value; renderSubmit(); },
        }) : el('p', { class: 'up__hint', text: `本次记录日期：${state.date}（${dateLabel(state.date)}）` }),
      ]),
    );
  }

  /* ------------------------------------------------------------- 照片 */

  function renderPhotos() {
    clear(photoHost);
    const fileInput = el('input', {
      type: 'file',
      accept: imageAccept(),
      multiple: true,
      class: 'up__file',
      onchange: async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        toast(`正在压缩 ${files.length} 张照片…`);
        for (const file of files) {
          try {
            const asset = await prepareImage(file);
            state.entries.push({ asset, name: '', priceText: '', key: `${Date.now()}-${Math.random()}` });
          } catch (error) {
            toast(`${file.name}：${error.message}`, { tone: 'bad' });
          }
        }
        event.target.value = '';
        renderPhotos();
        renderSubmit();
      },
    });

    const rows = state.entries.map((entry, index) => {
      const thumb = el('div', { class: 'up__thumb' }, [el('img', { src: entry.asset.dataUrl, alt: '' })]);
      const nameInput = input({
        value: entry.name,
        placeholder: '菜名（必填）',
        oninput: (e) => {
          entry.name = e.target.value;
          nameInput.classList.toggle('is-invalid', !entry.name.trim());
          renderSubmit();
        },
      });
      if (!entry.name.trim()) nameInput.classList.add('is-invalid');
      const priceInput = input({
        value: entry.priceText,
        placeholder: '价格（可选，如 ¥12）',
        oninput: (e) => { entry.priceText = e.target.value; },
      });
      return el('div', { class: 'up__entry' }, [
        thumb,
        el('div', { class: 'up__entry-body' }, [
          nameInput,
          priceInput,
          el('div', { class: 'up__entry-meta', text: `${entry.asset.width}×${entry.asset.height} · ${Math.round(entry.asset.bytes / 1024)}KB` }),
        ]),
        el('button', {
          class: 'icon-btn icon-btn--danger',
          type: 'button',
          title: '移除',
          text: '✕',
          onclick: () => { state.entries.splice(index, 1); renderPhotos(); renderSubmit(); },
        }),
      ]);
    });

    const todayList = prefs.stallName && menu
      ? (menu.dishes || []).filter((dish) => dish.date === state.date
        && dish.canteenId === prefs.canteenId
        && (dish.floor || '') === (prefs.floor || '')
        && dish.stallName === prefs.stallName)
      : [];

    mount(
      photoHost,
      sectionTitle('照片', el('span', { class: 'pill', text: `${state.entries.length} 张` })),
      el('label', { class: 'up__picker' }, [
        el('span', { class: 'up__picker-icon', text: '📷' }),
        el('span', { class: 'up__picker-text', text: state.entries.length ? '继续加照片' : '拍照 / 从相册选择（可多选）' }),
        fileInput,
      ]),
      rows.length ? el('div', { class: 'up__entries' }, rows) : el('p', { class: 'up__hint', text: '选好照片后，逐张填上菜名即可提交' }),
      el('div', { class: 'up__window-photo' }, [
        el('div', { class: 'up__label', text: '窗口照片（可选，一张就够）' }),
        state.windowPhoto
          ? el('div', { class: 'up__entry' }, [
            el('div', { class: 'up__thumb' }, [el('img', { src: state.windowPhoto.dataUrl, alt: '' })]),
            el('div', { class: 'up__entry-body' }, [el('div', { class: 'up__value', text: '将作为该窗口的封面图' })]),
            el('button', {
              class: 'icon-btn icon-btn--danger', type: 'button', text: '✕',
              onclick: () => { state.windowPhoto = null; renderPhotos(); },
            }),
          ])
          : el('label', { class: 'up__picker up__picker--small' }, [
            el('span', { class: 'up__picker-text', text: '给窗口拍一张' }),
            el('input', {
              type: 'file',
              accept: imageAccept(),
              class: 'up__file',
              onchange: async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  state.windowPhoto = await prepareImage(file);
                  renderPhotos();
                } catch (error) {
                  toast(error.message, { tone: 'bad' });
                }
              },
            }),
          ]),
      ]),
      todayList.length
        ? el('div', { class: 'up__today' }, [
          el('div', { class: 'up__label', text: `${dateLabel(state.date)}这个窗口已上传 ${todayList.length} 道` }),
          el('div', { class: 'chip-row' }, todayList.map((dish) => tagPill(dish.name))),
          el('p', { class: 'up__hint', text: '同名菜重复上传会自动去重，只保留最新一条' }),
        ])
        : null,
    );
  }

  /* --------------------------------------------------------- 共同属性 */

  function renderShared() {
    clear(sharedHost);
    if (!menu) return;
    const cuisineItems = menu.cuisines
      .slice()
      .sort((a, b) => b.dishCount - a.dishCount)
      .map((cuisine) => ({ label: cuisine.name, value: cuisine.id, emoji: cuisine.emoji, count: cuisine.dishCount }));

    mount(
      sharedHost,
      sectionTitle('这批菜的共同属性'),
      el('div', { class: 'up__block-inner' }, [
        el('div', { class: 'up__label', text: '菜系（至少 1 个）' }),
        chipRow(cuisineItems, {
          multi: true,
          value: prefs.cuisines,
          onChange: (value) => { prefs.cuisines = value; persistPrefs(); renderSubmit(); },
        }),
      ]),
      el('div', { class: 'up__block-inner' }, [
        el('div', { class: 'up__label', text: '辣度' }),
        segmented([
          { label: '不辣', value: 0 }, { label: '微辣', value: 1 },
          { label: '中辣', value: 2 }, { label: '重辣', value: 3 },
        ], { value: prefs.spicyLevel, onChange: (value) => { prefs.spicyLevel = value; persistPrefs(); } }),
      ]),
      el('div', { class: 'up__block-inner' }, [
        el('div', { class: 'up__label', text: '评价' }),
        segmented([
          { label: '好评', value: '好评' },
          { label: '值得一试', value: '值得一试' },
          { label: '信息较少', value: '信息较少' },
        ], { value: prefs.reviewLabel, onChange: (value) => { prefs.reviewLabel = value; persistPrefs(); } }),
      ]),
    );
  }

  /* ------------------------------------------------------------- 提交 */

  function buildRecords() {
    const base = {
      canteenId: prefs.canteenId,
      floor: prefs.floor || null,
      stallName: prefs.stallName || null,
    };
    const records = [];
    const stallExists = (menu?.stalls || []).some((stall) => (
      stall.canteenId === base.canteenId
      && (stall.floor || null) === base.floor
      && stall.name === base.stallName
    ));
    // 新窗口建档，或给已有窗口换封面图
    if (base.stallName && (!stallExists || state.windowPhoto)) {
      records.push({
        id: newId('w'),
        kind: 'stall',
        createdAt: new Date().toISOString(),
        author: author || '匿名同学',
        payload: {
          canteenId: base.canteenId,
          floor: base.floor,
          name: base.stallName,
          windowType: state.windowType || '自选',
          note: null,
          image: state.windowPhoto ? uploadPathFor(state.windowPhoto) : null,
        },
      });
    }

    state.entries.forEach((entry) => {
      records.push({
        id: newId('d'),
        kind: 'dish',
        createdAt: new Date().toISOString(),
        author: author || '匿名同学',
        payload: {
          canteenId: base.canteenId,
          floor: base.floor,
          stallName: base.stallName || null,
          name: entry.name.trim(),
          priceText: entry.priceText.trim() || null,
          cuisines: prefs.cuisines,
          spicyLevel: prefs.spicyLevel,
          tags: [],
          reviewLabel: prefs.reviewLabel,
          reviewText: null,
          image: uploadPathFor(entry.asset),
          date: state.date, // 关键：自选菜按天有效
          mealSlots: ['lunch', 'dinner'],
          vegetarian: null,
        },
      });
    });
    return records;
  }

  function validateAll(records) {
    if (!menu) return ['菜单还没加载完'];
    const errors = [];
    if (!state.entries.length) errors.push('先选至少一张照片');
    records.forEach((record, index) => {
      const result = validateContribution(record, menu);
      if (!result.ok) {
        const label = record.kind === 'stall' ? '窗口' : `第 ${index + 1} 道菜`;
        result.errors.forEach((error) => errors.push(`${label}：${error}`));
      }
    });
    return errors;
  }

  function renderSubmit() {
    clear(submitHost);
    const records = buildRecords();
    const dishCount = records.filter((r) => r.kind === 'dish').length;
    const writable = source.capabilities.write;
    const errors = validateAll(records);
    const missingNames = state.entries.filter((entry) => !entry.name.trim()).length;

    // 高频上传要一眼看出「还差什么」，而不是点了才知道
    let label = `一次提交 ${dishCount} 道菜`;
    if (busy) label = '提交中…';
    else if (!state.entries.length) label = '先选照片';
    else if (missingNames) label = `还需填 ${missingNames} 个菜名`;
    else if (errors.length) label = '还有信息要补';

    mount(
      submitHost,
      button(label, {
        size: 'lg',
        onClick: () => submit(records),
      }),
      el('p', { class: 'up__hint', text: writable
        ? '照片和内容会在同一个 commit 里提交，线上 1 分钟左右生效'
        : '当前数据源只读：展开上面的「设置」切到 GitHub 仓库或本地演示' }),
      validationErrors.length
        ? el('ul', { class: 'valid is-bad' }, validationErrors.map((error) => el('li', { text: error })))
        : (errors.length && state.entries.length
          ? el('p', { class: 'up__hint up__hint--warn', text: `还差：${errors[0]}${errors.length > 1 ? ` 等 ${errors.length} 项` : ''}` })
          : null),
      lastResult
        ? el('div', { class: 'valid is-ok' }, [
          el('span', { text: `上一次提交成功：${lastResult.dishCount} 道菜` }),
          lastResult.commit
            ? el('a', { href: lastResult.commit, target: '_blank', rel: 'noreferrer', text: '查看 commit' })
            : null,
        ])
        : null,
      el('div', { class: 'up__links' }, [
        el('a', { class: 'link', href: 'index.html', text: '去看抽签 →' }),
        el('a', { class: 'link', href: 'admin.html', text: '完整内容管理 →' }),
      ]),
    );
    const submitButton = submitHost.querySelector('button');
    if (submitButton) submitButton.disabled = busy || !writable || !dishCount || errors.length > 0;
  }

  async function submit(records) {
    validationErrors = validateAll(records);
    if (validationErrors.length) {
      renderSubmit();
      toast('还有几项要补一下', { tone: 'bad' });
      return;
    }
    busy = true;
    renderSubmit();
    try {
      const images = [...state.entries.map((entry) => entry.asset), state.windowPhoto].filter(Boolean);
      const dishCount = records.filter((r) => r.kind === 'dish').length;
      const result = await source.saveMany(records, {
        images,
        message: `content: ${dishCount} 自选菜 @ ${prefs.canteenId} ${prefs.floor || '-'} ${prefs.stallName || ''} ${state.date}`,
      });
      lastResult = { dishCount, commit: result.commit };
      state.entries = [];
      state.windowPhoto = null;
      validationErrors = [];
      await reload();
      toast(`已提交 ${dishCount} 道菜`, { tone: 'ok' });
    } catch (error) {
      toast(error.message, { tone: 'bad', timeout: 6200 });
      console.error('[upload] failed', error);
    } finally {
      busy = false;
      render();
    }
  }

  /* ------------------------------------------------------------- 渲染 */

  function render() {
    renderSource();
    renderLocation();
    renderPhotos();
    renderShared();
    renderSubmit();
  }

  async function boot() {
    render();
    await reload();
    render();
  }

  return { root: container, boot };
}
