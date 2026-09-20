/** 图片处理：压缩到适合提交进仓库的尺寸，产出数据源需要的 asset 结构 */

import { byteSize } from '../core/format.js';

const DEFAULT_MAX_EDGE = 1280;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_MAX_BYTES = 1.6 * 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = dataUrl;
  });
}

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/jpeg';
  const binary = atob(body);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function base64Of(dataUrl) {
  return dataUrl.split(',')[1] || '';
}

function slugifyFileName(name, ext) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  const base = String(name || 'photo').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'photo';
  return `${stamp}-${rand}-${base}.${ext}`;
}

/**
 * 把用户选的图片压缩成 asset：
 *   { name, mime, base64, dataUrl, blob, bytes, width, height, original }
 * 数据源负责把它提交到仓库 / 后端 / localStorage。
 */
export async function prepareImageAsset(file, {
  maxEdge = DEFAULT_MAX_EDGE,
  quality = DEFAULT_QUALITY,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!file) throw new Error('没有选择图片');
  if (!/^image\//.test(file.type)) throw new Error('只支持图片文件');

  const originalDataUrl = await readAsDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  let outQuality = quality;
  let dataUrl = canvas.toDataURL('image/jpeg', outQuality);
  // 还是太大就继续降质量，保证能提交进仓库
  while (base64Of(dataUrl).length * 0.75 > maxBytes && outQuality > 0.4) {
    outQuality -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', outQuality);
  }

  const blob = dataUrlToBlob(dataUrl);
  return {
    name: slugifyFileName(file.name, 'jpg'),
    mime: 'image/jpeg',
    base64: base64Of(dataUrl),
    dataUrl,
    blob,
    bytes: blob.size,
    width,
    height,
    original: { name: file.name, bytes: file.size, width: image.width, height: image.height },
    describe() {
      return `${width}×${height} · ${byteSize(blob.size)}（原图 ${byteSize(file.size)}）`;
    },
  };
}

export function imageAccept() {
  return 'image/png,image/jpeg,image/webp,image/heic';
}
