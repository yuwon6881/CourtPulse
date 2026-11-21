// Generates all PWA, iOS, and favicon assets under public/ from src/utils/brandMark.ts.
// Run from project root: `node scripts/generate-icons.mjs`
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildCourtPulseTileSvg } from '../src/utils/brandMark.ts';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  try {
    const siblingSharp = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../FinancialApp/node_modules/sharp'
    );
    sharp = require(siblingSharp);
  } catch {
    sharp = null;
  }
}

async function rasterizeSvgToPng(svg, size, opaque) {
  if (sharp) {
    let pipeline = sharp(Buffer.from(svg)).resize(size, size);
    if (opaque) {
      pipeline = pipeline.removeAlpha();
    }
    return pipeline.png({ compressionLevel: 9 }).toBuffer();
  }

  // Fallback to ImageMagick `convert` when sharp is not installed.
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cp-icon-'));
  const svgPath = path.join(tmpDir, 'mark.svg');
  const pngPath = path.join(tmpDir, 'mark.png');
  try {
    await writeFile(svgPath, svg, 'utf8');
    const outputSpec = opaque ? `PNG24:${pngPath}` : `PNG32:${pngPath}`;
    const args = [
      '-background',
      'none',
      '-density',
      '384',
      `MSVG:${svgPath}`,
      '-resize',
      `${size}x${size}`,
      ...(opaque ? ['-alpha', 'off'] : ['-alpha', 'on']),
      '-strip',
      outputSpec,
    ];
    await execFileAsync('convert', args);
    return await readFile(pngPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Encodes PNG buffers into a standard multi-resolution ICO file (PNG-in-ICO).
 */
function buildIcoFromPngs(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = 1 (icon)
  header.writeUInt16LE(entries.length, 4);

  const dirEntries = [];
  let offset = 6 + entries.length * 16;

  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // color palette count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.png)]);
}

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public'
);
await mkdir(publicDir, { recursive: true });

const roundedLarge = buildCourtPulseTileSvg({
  size: 1024,
  rounded: true,
  includeShadow: false,
});
const roundedCrisp = buildCourtPulseTileSvg({
  size: 512,
  rounded: true,
  includeShadow: false,
});
const squareMaskable = buildCourtPulseTileSvg({
  size: 1024,
  rounded: false,
  includeShadow: false,
});

const jobs = [
  { svg: roundedLarge, size: 192, file: 'icon-192.png', opaque: false },
  { svg: roundedLarge, size: 512, file: 'icon-512.png', opaque: false },
  { svg: roundedCrisp, size: 32, file: 'favicon-32x32.png', opaque: false },
  { svg: squareMaskable, size: 192, file: 'icon-192-maskable.png', opaque: true },
  { svg: squareMaskable, size: 512, file: 'icon-512-maskable.png', opaque: true },
  // iOS Home Screen clips its own superellipse and turns transparent corners black.
  { svg: squareMaskable, size: 180, file: 'apple-touch-icon.png', opaque: true },
];

for (const { svg, size, file, opaque } of jobs) {
  const outPath = path.join(publicDir, file);
  const png = await rasterizeSvgToPng(svg, size, opaque);
  await writeFile(outPath, png);
  console.log(`wrote public/${file} (${size}x${size}${opaque ? ', opaque' : ''})`);
}

const ico16 = await rasterizeSvgToPng(roundedCrisp, 16, false);
const ico32 = await rasterizeSvgToPng(roundedCrisp, 32, false);
await writeFile(
  path.join(publicDir, 'favicon.ico'),
  buildIcoFromPngs([
    { size: 16, png: ico16 },
    { size: 32, png: ico32 },
  ])
);
console.log('wrote public/favicon.ico (16x16, 32x32)');

const faviconSvg = buildCourtPulseTileSvg({
  size: 0,
  rounded: true,
  includeShadow: false,
});

await writeFile(path.join(publicDir, 'favicon.svg'), `${faviconSvg}\n`, 'utf8');
console.log('wrote public/favicon.svg');
