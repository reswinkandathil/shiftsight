import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'assets');
const userLogoPath = path.join(assetsDir, 'user-logo.png');
const brandMarkPath = path.join(assetsDir, 'brand-mark.svg');

fs.mkdirSync(assetsDir, { recursive: true });

function writeUserLogoAssets() {
  const iconPngPath = path.join(assetsDir, 'icon.png');
  const trayPngPath = path.join(assetsDir, 'tray.png');
  const icoPngPath = path.join(assetsDir, 'icon-256.png');

  fs.copyFileSync(userLogoPath, iconPngPath);
  execFileSync('sips', ['-c', '300', '500', userLogoPath, '--out', trayPngPath], {
    stdio: 'ignore'
  });
  execFileSync('sips', ['-z', '256', '256', userLogoPath, '--out', icoPngPath], {
    stdio: 'ignore'
  });
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoFromPng(fs.readFileSync(icoPngPath)));
  fs.rmSync(icoPngPath, { force: true });

  if (process.platform === 'darwin') {
    const iconset = path.join(assetsDir, 'icon.iconset');
    fs.rmSync(iconset, { recursive: true, force: true });
    fs.mkdirSync(iconset, { recursive: true });

    const iconMap = new Map([
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024]
    ]);

    for (const [file, size] of iconMap) {
      execFileSync('sips', ['-z', String(size), String(size), userLogoPath, '--out', path.join(iconset, file)], {
        stdio: 'ignore'
      });
    }

    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assetsDir, 'icon.icns')]);
    fs.rmSync(iconset, { recursive: true, force: true });
  }
}

function renderSvgToPng(svgPath, outputPath, size) {
  const tempDir = fs.mkdtempSync(path.join(assetsDir, '.icon-render-'));
  const previewPath = path.join(tempDir, `${path.basename(svgPath)}.png`);

  try {
    execFileSync('qlmanage', ['-t', '-s', String(size), '-o', tempDir, svgPath], {
      stdio: 'ignore'
    });

    if (!fs.existsSync(previewPath)) {
      throw new Error(`Quick Look did not render ${path.basename(svgPath)}.`);
    }

    fs.copyFileSync(previewPath, outputPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeBrandIconAssets() {
  const iconPngPath = path.join(assetsDir, 'icon.png');
  const icoPngPath = path.join(assetsDir, 'icon-256.png');

  renderSvgToPng(brandMarkPath, iconPngPath, 1024);
  execFileSync('sips', ['-z', '512', '512', iconPngPath, '--out', iconPngPath], {
    stdio: 'ignore'
  });

  renderSvgToPng(brandMarkPath, icoPngPath, 1024);
  execFileSync('sips', ['-z', '256', '256', icoPngPath, '--out', icoPngPath], {
    stdio: 'ignore'
  });
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoFromPng(fs.readFileSync(icoPngPath)));
  fs.rmSync(icoPngPath, { force: true });

  if (!fs.existsSync(path.join(assetsDir, 'tray.png'))) {
    fs.writeFileSync(path.join(assetsDir, 'tray.png'), png(72, 36, trayPaint));
  }

  if (process.platform === 'darwin') {
    const iconset = path.join(assetsDir, 'icon.iconset');
    fs.rmSync(iconset, { recursive: true, force: true });
    fs.mkdirSync(iconset, { recursive: true });

    const iconMap = new Map([
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024]
    ]);

    for (const [file, size] of iconMap) {
      const output = path.join(iconset, file);
      renderSvgToPng(brandMarkPath, output, 1024);
      execFileSync('sips', ['-z', String(size), String(size), output, '--out', output], {
        stdio: 'ignore'
      });
    }

    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assetsDir, 'icon.icns')]);
    fs.rmSync(iconset, { recursive: true, force: true });
  }
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(width, height, paint) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 4;
      const [r, g, b, a] = paint(x, y, width, height);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function smoothStep(edge0, edge1, value) {
  const x = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / lengthSquared));
  const x = ax + t * vx;
  const y = ay + t * vy;
  return Math.hypot(px - x, py - y);
}

function lineAlpha(px, py, ax, ay, bx, by, width) {
  return smoothStep(width, width * 0.62, segmentDistance(px, py, ax, ay, bx, by));
}

function mixChannel(a, b, amount) {
  return Math.round(a * (1 - amount) + b * amount);
}

function cubicPoint(t, ax, ay, bx, by, cx, cy, dx, dy) {
  const mt = 1 - t;
  const x = mt ** 3 * ax + 3 * mt ** 2 * t * bx + 3 * mt * t ** 2 * cx + t ** 3 * dx;
  const y = mt ** 3 * ay + 3 * mt ** 2 * t * by + 3 * mt * t ** 2 * cy + t ** 3 * dy;
  return [x, y];
}

function curveAlpha(px, py, points, width) {
  let alpha = 0;
  let [lastX, lastY] = cubicPoint(0, ...points);

  for (let index = 1; index <= 48; index += 1) {
    const [x, y] = cubicPoint(index / 48, ...points);
    alpha = Math.max(alpha, lineAlpha(px, py, lastX, lastY, x, y, width));
    lastX = x;
    lastY = y;
  }

  return alpha;
}

function circleAlpha(nx, ny, cx, cy, radius, softness = 0.012) {
  return smoothStep(radius, radius - softness, Math.hypot(nx - cx, ny - cy));
}

function scaleAroundCenter(value, amount) {
  return (value - 0.5) / amount + 0.5;
}

function lensAlpha(nx, ny) {
  const left = 0.07;
  const right = 0.93;
  const t = (nx - left) / (right - left);

  if (t < 0 || t > 1) {
    return 0;
  }

  const arc = Math.sin(Math.PI * t);
  const centerY = 0.535 + (t - 0.5) * 0.012;
  const top = centerY - 0.305 * Math.pow(arc, 0.72);
  const bottom = centerY + 0.258 * Math.pow(arc, 0.78);
  const verticalAlpha =
    smoothStep(-0.004, 0.006, ny - top) * smoothStep(-0.004, 0.006, bottom - ny);
  const tipAlpha = smoothStep(0, 0.018, t) * smoothStep(0, 0.018, 1 - t);

  return verticalAlpha * tipAlpha;
}

function referenceEyeAlpha(nx, ny, scale = 1) {
  const outer = lensAlpha(nx, ny);
  const centerCutout = circleAlpha(nx, ny, 0.5, 0.535, 0.225 / scale, 0.012 / scale);
  const eyeBody = Math.max(0, outer - centerCutout);
  const disk = circleAlpha(nx, ny, 0.455, 0.555, 0.178 / scale, 0.012 / scale);
  const bite = circleAlpha(nx, ny, 0.555, 0.51, 0.158 / scale, 0.012 / scale);
  const crescent = Math.max(0, disk - bite) * centerCutout;
  const bar = lineAlpha(nx, ny, 0.475, 0.535, 0.595, 0.535, 0.022 / scale) * centerCutout;

  return Math.max(eyeBody, crescent, bar);
}

function iconPaint(x, y, width, height) {
  const nx = (x + 0.5) / width;
  const ny = (y + 0.5) / height;
  const markX = scaleAroundCenter(nx, 0.7);
  const markY = scaleAroundCenter(ny, 0.7);
  const rx = Math.min(nx, 1 - nx);
  const ry = Math.min(ny, 1 - ny);
  const radius = Math.min(rx, ry);
  const cornerAlpha = smoothStep(0.02, 0.11, radius);
  const mark = referenceEyeAlpha(markX, markY);
  const base = [123, 207, 244, Math.round(255 * cornerAlpha)];
  const ink = [9, 24, 42];

  return [
    mixChannel(base[0], ink[0], mark),
    mixChannel(base[1], ink[1], mark),
    mixChannel(base[2], ink[2], mark),
    base[3]
  ];
}

function trayPaint(x, y, width, height) {
  const nx = (x + 0.5) / width;
  const ny = (y + 0.5) / height;
  const markX = scaleAroundCenter(nx, 0.98);
  const markY = scaleAroundCenter(ny, 1.1);
  const alpha = Math.round(255 * referenceEyeAlpha(markX, markY, 1));
  return [0, 0, 0, alpha];
}

function icoFromPng(pngBuffer) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0;
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBuffer.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, pngBuffer]);
}

if (fs.existsSync(brandMarkPath)) {
  writeBrandIconAssets();
  console.log('Generated ShiftSight app icons from assets/brand-mark.svg.');
  process.exit(0);
}

const iconPng = png(512, 512, iconPaint);
const trayPng = png(72, 36, trayPaint);
const icoPng = png(256, 256, iconPaint);

fs.writeFileSync(path.join(assetsDir, 'icon.png'), iconPng);
fs.writeFileSync(path.join(assetsDir, 'tray.png'), trayPng);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoFromPng(icoPng));

if (process.platform === 'darwin') {
  const iconset = path.join(assetsDir, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });

  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of sizes) {
    const file = path.join(iconset, `icon_${size}x${size}.png`);
    fs.writeFileSync(file, png(size, size, iconPaint));
  }

  const copyMap = new Map([
    ['icon_32x32.png', 'icon_16x16@2x.png'],
    ['icon_64x64.png', 'icon_32x32@2x.png'],
    ['icon_256x256.png', 'icon_128x128@2x.png'],
    ['icon_512x512.png', 'icon_256x256@2x.png'],
    ['icon_1024x1024.png', 'icon_512x512@2x.png']
  ]);

  for (const [source, target] of copyMap) {
    fs.copyFileSync(path.join(iconset, source), path.join(iconset, target));
  }

  try {
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assetsDir, 'icon.icns')]);
    fs.rmSync(iconset, { recursive: true, force: true });
  } catch (error) {
    console.warn('iconutil is unavailable, leaving icon.iconset in assets.');
  }
}

console.log('Generated ShiftSight placeholder icons.');
