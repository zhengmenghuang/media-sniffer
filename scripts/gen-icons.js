/**
 * 生成 SVG 图标并导出为 PNG（使用 Canvas）
 * 由于浏览器插件环境限制，这里提供一个简单的 Node 脚本来生成图标占位
 * 实际使用可替换为你自己的图标
 */

const fs = require('fs');
const path = require('path');

// 简单 SVG 图标（渔网+播放按钮）
function createSVG(size) {
  const r = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#5b6ef5"/>
      <stop offset="100%" style="stop-color:#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r * 0.25}" fill="url(#bg)"/>
  <text x="${r}" y="${r * 1.35}" text-anchor="middle" font-size="${r * 0.95}" font-family="Arial">🎯</text>
</svg>`;
}

const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, '..', 'src', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of sizes) {
  const svg = createSVG(size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.svg`), svg);
  console.log(`Created icon${size}.svg`);
}

console.log('SVG icons created. Convert to PNG using: https://svgtopng.com/ or ImageMagick');
console.log('Command: magick icon16.svg icon16.png && magick icon48.svg icon48.png && magick icon128.svg icon128.png');
