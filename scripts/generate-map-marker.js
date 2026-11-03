/**
 * 生成 P01 地图标记图标（一次性资产生成脚本，不参与运行时）。
 *
 * 为什么不用 assets/icons/feather 里的 svg：微信 <map> 的 marker.iconPath
 * 只认位图，svg 不渲染。这里用最小 PNG 编码器画一个品牌色圆点 + 尾巴，
 * 避免引入图片处理依赖。
 *
 * 用法：node scripts/generate-map-marker.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WIDTH = 36;
const HEIGHT = 44;
const BRAND = [255, 122, 69]; // #FF7A45，与 app.wxss --color-brand 一致

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** 圆形头部 + 下方三角尾巴，外部全透明。 */
function inPin(x, y) {
  const cx = WIDTH / 2;
  const cy = 16;
  const radius = 13;
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  if (dx * dx + dy * dy <= radius * radius) return true;
  // 尾巴：从圆底部收到 (cx, HEIGHT - 2) 的三角
  if (y >= cy && y <= HEIGHT - 2) {
    const progress = (y - cy) / (HEIGHT - 2 - cy);
    const halfWidth = radius * (1 - progress);
    return Math.abs(x + 0.5 - cx) <= halfWidth;
  }
  return false;
}

function inHole(x, y) {
  const dx = x + 0.5 - WIDTH / 2;
  const dy = y + 0.5 - 16;
  return dx * dx + dy * dy <= 25; // 中心白色小孔，便于在地图底色上辨认
}

function buildPixels() {
  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowStart = y * (WIDTH * 4 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = rowStart + 1 + x * 4;
      if (!inPin(x, y)) {
        raw[offset] = 0; raw[offset + 1] = 0; raw[offset + 2] = 0; raw[offset + 3] = 0;
      } else if (inHole(x, y)) {
        raw[offset] = 255; raw[offset + 1] = 255; raw[offset + 2] = 255; raw[offset + 3] = 255;
      } else {
        raw[offset] = BRAND[0]; raw[offset + 1] = BRAND[1]; raw[offset + 2] = BRAND[2];
        raw[offset + 3] = 255;
      }
    }
  }
  return raw;
}

function buildPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  header[10] = 0; header[11] = 0; header[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(buildPixels(), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const target = path.join(__dirname, '..', 'miniprogram', 'assets', 'icons', 'map-marker.png');
fs.writeFileSync(target, buildPng());
process.stdout.write(`written ${target}\n`);
