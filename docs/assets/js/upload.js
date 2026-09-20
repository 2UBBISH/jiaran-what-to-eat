/** 窗口菜色快传入口（upload.html） */

import { createUploadView } from './ui/viewUpload.js';
import { qs } from './ui/dom.js';
import { toast } from './ui/components.js';
import { initLightbox } from './ui/lightbox.js';

const view = createUploadView({ root: qs('#upload') });

initLightbox();

view.boot().catch((error) => {
  console.error('[upload] boot failed', error);
  toast(`初始化失败：${error.message}`, { tone: 'bad', timeout: 5200 });
});
