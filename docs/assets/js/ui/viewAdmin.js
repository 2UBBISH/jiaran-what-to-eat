/**
 * 内容管理台视图（admin.html 专用）
 * ---------------------------------------------------------------------------
 * 「在线上传内容」在没有服务端的 GitHub Pages 上怎么落地：
 *   1. 静态模式：只读，直接读 docs/assets/data/*.json
 *   2. GitHub 模式：用 fine-grained Token 调 Contents API，把新内容提交成
 *      docs/assets/data/contributions/<id>.json（图片提交到 docs/assets/uploads/）
 *      -> Actions 自动重建索引并重新部署 Pages，1 分钟左右线上生效
 *   3. Mock 模式：只写本机 localStorage，用来演示/自测，不碰线上
 *   4. HTTP 模式：以后换成自建后端，界面代码不变
 * 所有写操作都先经过 core/menu.js 的同一套校验，坏数据进不了仓库。
 */

import { el, clear, mount } from './dom.js';
import {
  button, chipRow, segmented, field, input, textarea, select,
  toast, emptyState, sectionTitle, tagPill,
} from './components.js';
import { validateContribution } from '../core/menu.js';
import { CONTRACT_SUMMARY } from '../data/contract.js';
import {
  SOURCE_MODES, describeConfig, loadConfig, saveConfig, createDataSource,
} from '../data/index.js';
import { prepareImageAsset, imageAccept } from './image.js';
import { KEYS, getJSON, setJSON } from '../data/local.js';

const AUTHOR_KEY = 'tsc:author';

function newId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

export function createAdminView({ root, onMenuReload }) {
  let config = loadConfig();
  let source = createDataSource(config);
  let menu = null;
  let contributions = [];
  let health = null;
  let busy = false;
  let lastResult = null;

  const draft = {
    kind: 'dish',
    author: getJSON(AUTHOR_KEY, '') || '',
    dish: {
      canteenId: '', floor: '', stallName: '', name: '', priceText: '',
      cuisines: [], spicyLevel: 0, tags: [], reviewLabel: '好评', reviewText: '', image: null, imageAsset: null,
    },
    canteen: { id: '', name: '', category: '食堂', floors: [], note: '' },
    note: { targetDishId: '', text: '' },
  };

  const sourceHost = el('section', { class: 'admin__section card' });
  const formHost = el('section', { class: 'admin__section card' });
  const listHost = el('section', { class: 'admin__section card' });
  const ioHost = el('section', { class: 'admin__section card' });
  const docHost = el('section', { class: 'admin__section card' });

  const container = el('div', { class: 'view view--admin' }, [
    el('header', { class: 'hero hero--compact' }, [
      el('div', { class: 'hero__eyebrow', text: '内容管理 · 前后端分离' }),
      el('h1', { class: 'hero__title', text: '在线上传内容' }),
      el('p', { class: 'hero__sub', text: '提交后会写入仓库的 contributions 目录，Actions 自动重建索引并重新部署' }),
    ]),
    sourceHost,
    formHost,
    listHost,
    ioHost,
    docHost,
  ]);
  root.append(container);

  /* ------------------------------------------------------- 数据源配置 */

  function renderSource() {
    clear(sourceHost);
    const info = describeConfig(config);
    const healthText = health
      ? el('div', { class: `health ${health.ok ? 'is-ok' : 'is-bad'}` }, [
        el('span', { class: 'health__dot' }),
        el('span', { text: health.detail }),
      ])
      : el('div', { class: 'health' }, [el('span', { class: 'health__dot' }), el('span', { text: '未测试' })]);

    const modeSelect = select(SOURCE_MODES.map((mode) => ({
      value: mode.id,
      label: `${mode.name}${mode.writes ? ' ✎' : ''}`,
    })), {
      value: config.mode,
      onChange: (value) => {
        config = { ...config, mode: value };
        saveConfig(config);
        source = createDataSource(config);
        health = null;
        renderSource();
        refresh();
      },
    });

    const gh = config.github;
    const ghFields = el('div', { class: 'field-grid' }, [
      field('owner', input({
        value: gh.owner, placeholder: 'GitHub 用户名或组织',
        oninput: (e) => { gh.owner = e.target.value.trim(); },
      })),
      field('repo', input({
        value: gh.repo, placeholder: '仓库名',
        oninput: (e) => { gh.repo = e.target.value.trim(); },
      })),
      field('branch', input({
        value: gh.branch, placeholder: 'main',
        oninput: (e) => { gh.branch = e.target.value.trim() || 'main'; },
      })),
      field('Token（fine-grained，仅 Contents: Read and write）', input({
        value: gh.token, type: 'password', placeholder: 'github_pat_…',
        oninput: (e) => { gh.token = e.target.value.trim(); },
      }), '只存在这台设备的 localStorage，不会上传到任何服务器'),
    ]);

    const httpFields = el('div', { class: 'field-grid' }, [
      field('后端地址', input({
        value: config.http.baseUrl, placeholder: 'https://api.example.com',
        oninput: (e) => { config.http.baseUrl = e.target.value.trim(); },
      }), '端点约定见 assets/js/data/httpSource.js'),
    ]);

    mount(
      sourceHost,
      sectionTitle('数据源'),
      el('div', { class: 'admin__row' }, [
        el('div', { class: 'admin__row-main' }, [modeSelect]),
        el('div', { class: 'admin__row-side' }, [
          button('保存配置', {
            variant: 'soft',
            onClick: () => {
              saveConfig(config);
              source = createDataSource(config);
              toast('配置已保存（刷新后仍生效）', { tone: 'ok' });
              renderSource();
            },
          }),
          button('测试连接', { onClick: () => testConnection() }),
        ]),
      ]),
      healthText,
      config.mode === 'github' ? ghFields : null,
      config.mode === 'http' ? httpFields : null,
      el('p', { class: 'admin__note', text: SOURCE_MODES.find((m) => m.id === config.mode)?.desc || '' }),
      el('p', { class: 'admin__note admin__note--muted', text: `当前：${info.mode} · ${info.github} · ${info.http}` }),
    );
  }

  async function testConnection() {
    busy = true;
    toast('正在测试连接…');
    health = await source.health();
    busy = false;
    renderSource();
  }

  /* ------------------------------------------------------- 上传表单 */

  function currentRecord() {
    const id = draft.existingId || newId();
    if (draft.kind === 'dish') {
      const d = draft.dish;
      return {
        id,
        kind: 'dish',
        createdAt: new Date().toISOString(),
        author: draft.author || '匿名同学',
        payload: {
          canteenId: d.canteenId,
          floor: d.floor || null,
          stallName: d.stallName || null,
          name: d.name,
          priceText: d.priceText || null,
          cuisines: d.cuisines,
          spicyLevel: d.spicyLevel,
          tags: d.tags,
          reviewLabel: d.reviewLabel,
          reviewText: d.reviewText || null,
          image: d.image || null,
          mealSlots: ['lunch', 'dinner'],
          vegetarian: null,
        },
      };
    }
    if (draft.kind === 'canteen') {
      const c = draft.canteen;
      return {
        id,
        kind: 'canteen',
        createdAt: new Date().toISOString(),
        author: draft.author || '匿名同学',
        payload: {
          id: c.id || null, name: c.name, category: c.category || '食堂',
          floors: c.floors, note: c.note || null,
        },
      };
    }
    return {
      id,
      kind: 'note',
      createdAt: new Date().toISOString(),
      author: draft.author || '匿名同学',
      payload: { targetDishId: draft.note.targetDishId, text: draft.note.text },
    };
  }

  function renderForm() {
    if (!menu) {
      clear(formHost);
      formHost.append(emptyState('菜单还没加载完'));
      return;
    }
    clear(formHost);

    const kindRow = segmented([
      { label: '新增菜品', value: 'dish' },
      { label: '新增饭堂', value: 'canteen' },
      { label: '补充说明', value: 'note' },
    ], {
      value: draft.kind,
      onChange: (value) => { draft.kind = value; draft.existingId = null; renderForm(); },
    });

    const authorField = field('你的昵称（可选）', input({
      value: draft.author,
      placeholder: '匿名同学',
      oninput: (e) => { draft.author = e.target.value.trim(); setJSON(AUTHOR_KEY, draft.author); },
    }), '会记录在提交内容里，方便溯源');

    formHost.append(sectionTitle('新增内容'), el('div', { class: 'admin__row' }, [kindRow]), authorField);

    // 表单主体：用事件委托统一刷新校验，避免每个控件都手写一遍回调
    const formBody = el('div', { class: 'form-body' });
    if (draft.kind === 'dish') formBody.append(renderDishForm());
    if (draft.kind === 'canteen') formBody.append(renderCanteenForm());
    if (draft.kind === 'note') formBody.append(renderNoteForm());
    formBody.addEventListener('input', () => refreshValidation());
    formBody.addEventListener('change', () => refreshValidation());
    formBody.addEventListener('click', (event) => {
      if (event.target.closest('.chip, .segmented__item')) refreshValidation();
    });
    formHost.append(formBody);

    // 实时校验：只更新校验区与按钮状态，不整体重渲染（否则输入框会失焦）
    const recordPreview = el('pre', { class: 'code' });
    const validationHost = el('div', { class: 'validation-host' });
    const submitButton = button('提交到线上', {
      onClick: () => {
        const fresh = refreshValidation();
        submitRecord(fresh.record, fresh.validation);
      },
    });

    function refreshValidation() {
      const record = currentRecord();
      const validation = validateContribution(record, menu);
      clear(validationHost);
      validationHost.append(validation.ok
        ? el('div', { class: 'valid is-ok', text: '✓ 校验通过，可以提交' })
        : el('ul', { class: 'valid is-bad' }, validation.errors.map((error) => el('li', { text: error }))));
      recordPreview.textContent = JSON.stringify(record, null, 2);
      submitButton.disabled = !validation.ok || busy || !source.capabilities.write;
      return { record, validation };
    }

    formHost.append(
      validationHost,
      el('details', { class: 'draft-preview' }, [
        el('summary', { text: '查看将要提交的 JSON' }),
        recordPreview,
      ]),
      el('div', { class: 'admin__submit' }, [
        submitButton,
        source.capabilities.write ? null : el('span', {
          class: 'admin__note',
          text: '当前数据源只读：把上面的数据源切到「本地演示」或「GitHub 仓库」即可提交',
        }),
      ]),
    );
    refreshValidation();
  }

  function renderDishForm() {
    const d = draft.dish;
    const canteenOptions = menu.canteens.map((canteen) => ({ value: canteen.id, label: canteen.name }));
    const cuisineItems = menu.cuisines
      .slice()
      .sort((a, b) => b.dishCount - a.dishCount)
      .map((cuisine) => ({ label: cuisine.name, value: cuisine.id, emoji: cuisine.emoji }));

    const imagePreview = el('div', { class: 'upload__preview' }, d.image
      ? [el('img', { src: d.image, alt: '预览' })]
      : [el('span', { class: 'upload__hint', text: '未选择图片' })]);
    const imageInfo = el('span', { class: 'admin__note', text: d.imageAsset ? d.imageAsset.describe() : '图片会在浏览器里压缩后提交（≤1280px / JPEG）' });

    const fileInput = el('input', {
      type: 'file',
      accept: imageAccept(),
      class: 'upload__input',
      onchange: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          toast('正在压缩图片…');
          const asset = await prepareImageAsset(file);
          draft.dish.imageAsset = asset;
          draft.dish.image = asset.dataUrl;
          clear(imagePreview);
          imagePreview.append(el('img', { src: asset.dataUrl, alt: '预览' }));
          imageInfo.textContent = asset.describe();
          renderForm();
        } catch (error) {
          toast(error.message, { tone: 'bad' });
        }
      },
    });

    return el('div', { class: 'form' }, [
      el('div', { class: 'field-grid' }, [
        field('饭堂 *', select(canteenOptions, {
          value: d.canteenId,
          placeholder: '选择饭堂',
          onChange: (value) => { d.canteenId = value; renderForm(); },
        })),
        field('楼层', select([
          { value: '', label: '未标注' },
          { value: '1F', label: '一层' },
          { value: '2F', label: '二层' },
          { value: '3F', label: '三层' },
        ], { value: d.floor, onChange: (value) => { d.floor = value; } })),
        field('窗口', input({
          value: d.stallName, placeholder: '例如：锅仔 / 最左边的炸鸡窗口',
          oninput: (e) => { d.stallName = e.target.value; },
        })),
        field('菜名 *', input({
          value: d.name, placeholder: '例如：羊肉锅（不辣）',
          oninput: (e) => { d.name = e.target.value; },
        })),
        field('价格（照抄窗口价签即可）', input({
          value: d.priceText, placeholder: '例如：¥18 / 20-30 / 10元以下',
          oninput: (e) => { d.priceText = e.target.value; },
        })),
        field('辣度', segmented([
          { label: '不辣', value: 0 }, { label: '微辣', value: 1 },
          { label: '中辣', value: 2 }, { label: '重辣', value: 3 },
        ], { value: d.spicyLevel, onChange: (value) => { d.spicyLevel = value; } })),
      ]),
      el('div', { class: 'form__block' }, [
        el('div', { class: 'form__label', text: '菜系 *（至少 1 个，可多选）' }),
        chipRow(cuisineItems, {
          multi: true, value: d.cuisines,
          onChange: (value) => { d.cuisines = value; },
        }),
      ]),
      el('div', { class: 'form__block' }, [
        el('div', { class: 'form__label', text: '标签' }),
        chipRow(menu.taxonomy.tags.map((tag) => ({ label: tag.name, value: tag.name })), {
          multi: true, value: d.tags,
          onChange: (value) => { d.tags = value; },
        }),
      ]),
      el('div', { class: 'field-grid' }, [
        field('评价', select(menu.taxonomy.reviewLevels.map((level) => ({
          value: level.label, label: `${level.label}（权重 ${level.drawWeight}）`,
        })), { value: d.reviewLabel, onChange: (value) => { d.reviewLabel = value; } })),
        field('真实体验 *', textarea({
          value: d.reviewText, placeholder: '价格、分量、口味、推荐吃法…',
          oninput: (e) => { d.reviewText = e.target.value; },
        })),
      ]),
      el('div', { class: 'form__block' }, [
        el('div', { class: 'form__label', text: '图片（可选）' }),
        el('div', { class: 'upload' }, [imagePreview, el('div', { class: 'upload__side' }, [fileInput, imageInfo])]),
      ]),
    ]);
  }

  function renderCanteenForm() {
    const c = draft.canteen;
    return el('div', { class: 'form' }, [
      el('div', { class: 'field-grid' }, [
        field('饭堂名 *', input({
          value: c.name, placeholder: '例如：桃李园',
          oninput: (e) => { c.name = e.target.value; },
        })),
        field('英文 id（可留空自动生成）', input({
          value: c.id, placeholder: 'tao_li_yuan',
          oninput: (e) => { c.id = e.target.value.trim(); },
        }), '小写字母/数字/下划线，用于菜品关联'),
        field('分类', input({
          value: c.category, placeholder: '食堂 / 餐厅 / 咖啡简餐 / 便利店',
          oninput: (e) => { c.category = e.target.value; },
        })),
      ]),
      el('div', { class: 'form__block' }, [
        el('div', { class: 'form__label', text: '有哪些楼层' }),
        chipRow([
          { label: '一层', value: '1F' }, { label: '二层', value: '2F' }, { label: '三层', value: '3F' },
        ], { multi: true, value: c.floors, onChange: (value) => { c.floors = value; } }),
      ]),
      field('备注', textarea({
        value: c.note, placeholder: '位置、营业时间、特色窗口…',
        oninput: (e) => { c.note = e.target.value; },
      })),
    ]);
  }

  function renderNoteForm() {
    const n = draft.note;
    const options = menu.dishes
      .slice()
      .sort((a, b) => a.canteenId.localeCompare(b.canteenId))
      .map((dish) => ({
        value: dish.id,
        label: `${dish.name}（${menu.canteens.find((c) => c.id === dish.canteenId)?.name || dish.canteenId}）`,
      }));
    return el('div', { class: 'form' }, [
      field('选择菜品 *', select(options, {
        value: n.targetDishId, placeholder: '搜索并选择菜品',
        onChange: (value) => { n.targetDishId = value; },
      })),
      field('补充说明 *', textarea({
        value: n.text, placeholder: '例如：现在已经涨价到 20 元了 / 换窗口了',
        oninput: (e) => { n.text = e.target.value; },
      }), '会显示在原菜品卡片下方'),
    ]);
  }

  async function submitRecord(record, validation) {
    if (!validation.ok) {
      toast('还有校验错误，先改一下', { tone: 'bad' });
      return;
    }
    busy = true;
    try {
      let payload = record;
      if (draft.kind === 'dish' && draft.dish.imageAsset) {
        toast('正在上传图片…');
        const uploaded = await source.uploadImage(draft.dish.imageAsset, {
          message: `content: upload image for ${record.id}`,
        });
        payload = {
          ...record,
          payload: { ...record.payload, image: uploaded.url || record.payload.image },
        };
      }
      const result = await source.saveContribution(payload, { message: `content: add ${payload.kind} ${payload.id}` });
      lastResult = { ...result, record: payload };
      toast('提交成功', { tone: 'ok' });
      draft.existingId = null;
      draft.dish.imageAsset = null;
      draft.dish.image = null;
      draft.dish.name = '';
      draft.dish.priceText = '';
      draft.dish.reviewText = '';
      await refresh();
      onMenuReload?.();
    } catch (error) {
      toast(error.message, { tone: 'bad', timeout: 5200 });
      if (error.hint) console.warn('[admin]', error.code, error.hint);
    } finally {
      busy = false;
      renderForm();
    }
  }

  /* ------------------------------------------------------- 已上传列表 */

  function renderList() {
    clear(listHost);
    listHost.append(sectionTitle('已上传内容', el('span', { class: 'pill', text: `${contributions.length} 条` })));

    if (lastResult?.url) {
      listHost.append(el('div', { class: 'valid is-ok' }, [
        el('span', { text: '刚刚提交成功：' }),
        el('a', { href: lastResult.commit || lastResult.url, target: '_blank', rel: 'noreferrer', text: '查看 commit' }),
        el('span', { text: ' · Pages 大约 1 分钟后自动更新' }),
      ]));
    }

    if (!contributions.length) {
      listHost.append(emptyState('还没有线上内容', '用上面的表单提交第一条，或在下方导入 JSON'));
      return;
    }

    listHost.append(el('div', { class: 'admin__list' }, contributions.map((item) => el('div', { class: 'admin__item' }, [
      el('div', { class: 'admin__item-main' }, [
        el('div', { class: 'admin__item-title' }, [
          el('strong', { text: item.title || item.id }),
          tagPill({ dish: '菜品', canteen: '饭堂', note: '补充说明' }[item.kind] || item.kind, 'tag'),
        ]),
        el('div', { class: 'admin__item-meta', text: `${item.author} · ${item.createdAt ? item.createdAt.slice(0, 16).replace('T', ' ') : ''}` }),
        el('div', { class: 'admin__item-path', text: item.path }),
      ]),
      el('div', { class: 'admin__item-actions' }, [
        el('button', {
          class: 'icon-btn',
          type: 'button',
          title: '载入到表单修改',
          text: '✎',
          onclick: () => loadIntoDraft(item),

        }),
        el('button', {
          class: 'icon-btn icon-btn--danger',
          type: 'button',
          title: '删除',
          text: '🗑',
          onclick: () => removeContribution(item),
        }),
      ]),
    ]))));
  }

  function loadIntoDraft(item) {
    const record = item.record;
    if (!record) { toast('这条内容没有详情', { tone: 'bad' }); return; }
    draft.existingId = record.id;
    draft.kind = record.kind;
    draft.author = record.author || draft.author;
    if (record.kind === 'dish') {
      draft.dish = {
        canteenId: record.payload.canteenId,
        floor: record.payload.floor || '',
        stallName: record.payload.stallName || '',
        name: record.payload.name || '',
        priceText: record.payload.priceText || '',
        cuisines: record.payload.cuisines || [],
        spicyLevel: record.payload.spicyLevel ?? 0,
        tags: record.payload.tags || [],
        reviewLabel: record.payload.reviewLabel || '好评',
        reviewText: record.payload.reviewText || '',
        image: record.payload.image || null,
        imageAsset: null,
      };
    } else if (record.kind === 'canteen') {
      draft.canteen = {
        id: record.payload.id || '', name: record.payload.name || '',
        category: record.payload.category || '食堂', floors: record.payload.floors || [], note: record.payload.note || '',
      };
    } else {
      draft.note = { targetDishId: record.payload.targetDishId, text: record.payload.text };
    }
    renderForm();
    toast('已载入表单（用同一 id 提交即覆盖）', { tone: 'ok' });
  }

  async function removeContribution(item) {
    if (!source.capabilities.remove) {
      toast('当前数据源不支持删除', { tone: 'bad' });
      return;
    }
    if (!window.confirm(`确定删除「${item.title || item.id}」？`)) return;
    try {
      await source.deleteContribution(item.id);
      toast('已删除', { tone: 'ok' });
      await refresh();
      onMenuReload?.();
    } catch (error) {
      toast(error.message, { tone: 'bad' });
    }
  }

  /* --------------------------------------------------------- 导入导出 */

  function renderIO() {
    clear(ioHost);
    const exportButton = button('导出全部内容', {
      variant: 'soft',
      onClick: () => {
        const bundle = {
          exportedAt: new Date().toISOString(),
          source: describeConfig(config),
          contributions,
        };
        download(`canteen-contributions-${Date.now()}.json`, JSON.stringify(bundle, null, 2));
        toast('已导出', { tone: 'ok' });
      },
    });

    const importInput = el('input', {
      type: 'file',
      accept: 'application/json',
      class: 'upload__input',
      onchange: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const records = Array.isArray(parsed) ? parsed : (parsed.contributions || [parsed]);
          const results = { ok: 0, bad: 0, errors: [] };
          for (const record of records) {
            const validation = validateContribution(record.record || record, menu);
            if (!validation.ok) {
              results.bad += 1;
              results.errors.push(`${record.id || '?'}: ${validation.errors[0]}`);
              continue;
            }
            if (source.capabilities.write) {
              await source.saveContribution(validation.value);
            }
            results.ok += 1;
          }
          toast(`导入完成：成功 ${results.ok} 条，失败 ${results.bad} 条`, {
            tone: results.bad ? 'info' : 'ok', timeout: 5200,
          });
          if (results.errors.length) console.warn('[admin] 导入失败明细', results.errors);
          await refresh();
          onMenuReload?.();
        } catch (error) {
          toast(`导入失败：${error.message}`, { tone: 'bad' });
        }
      },
    });

    const mockCount = (getJSON(KEYS.mockContributions, []) || []).length;

    ioHost.append(
      sectionTitle('导入 / 导出'),
      el('p', { class: 'admin__note', text: '没有 Token 也能用：导出 JSON 后手动放到 docs/assets/data/contributions/ 再提交，效果一样。' }),
      el('div', { class: 'admin__row admin__row--wrap' }, [
        exportButton,
        el('label', { class: 'btn btn--ghost' }, [el('span', { text: '导入 JSON' }), importInput]),
        button('清空本机演示数据', {
          variant: 'ghost',
          onClick: () => {
            if (!mockCount) { toast('本机没有演示数据'); return; }
            if (!window.confirm(`清空 ${mockCount} 条本机演示数据？`)) return;
            setJSON(KEYS.mockContributions, []);
            refresh();
            onMenuReload?.();
            toast('已清空', { tone: 'ok' });
          },
        }),
      ]),
      el('p', { class: 'admin__note admin__note--muted', text: `本机演示数据：${mockCount} 条` }),
    );
  }

  function renderDoc() {
    if (docHost.childElementCount) return;
    docHost.append(
      sectionTitle('数据源契约（换后端只改这里）'),
      el('ul', { class: 'contract' }, CONTRACT_SUMMARY.map((row) => el('li', {}, [
        el('code', { text: row.method }),
        el('span', { text: row.desc }),
      ]))),
      el('p', { class: 'admin__note', text: '实现同一个契约即可把后端换成自建 REST / Supabase / 云函数，前端页面无需改动。' }),
      el('p', { class: 'admin__note admin__note--muted', text: 'Token 安全：建议使用 fine-grained Token，仅授权本仓库的 Contents: Read and write，用完可随时吊销。' }),
    );
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------ 刷新 */

  async function refresh() {
    try {
      const { menu: loaded } = await source.loadMenu();
      menu = loaded;
      contributions = await source.listContributions().catch(() => []);
    } catch (error) {
      menu = null;
      contributions = [];
      toast(`读取数据失败：${error.message}`, { tone: 'bad', timeout: 5200 });
    }
    renderForm();
    renderList();
    renderIO();
  }

  async function boot() {
    renderSource();
    renderDoc();
    await refresh();
    health = await source.health();
    renderSource();
  }

  return { root: container, boot, refresh };
}
