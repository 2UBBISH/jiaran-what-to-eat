/** 内容管理台入口（admin.html） */

import { createAdminView } from './ui/viewAdmin.js';
import { qs } from './ui/dom.js';
import { toast } from './ui/components.js';
import { initLightbox } from './ui/lightbox.js';

const root = qs('#admin');
const view = createAdminView({
  root,
  onMenuReload: () => toast('页面数据已刷新', { tone: 'ok' }),
});

initLightbox();

view.boot().catch((error) => {
  console.error('[admin] boot failed', error);
  toast(`初始化失败：${error.message}`, { tone: 'bad', timeout: 5200 });
});
