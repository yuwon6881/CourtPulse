import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import {
  buildCourtPulseTileSvg,
  COURTPULSE_BRAND,
  COURTPULSE_MARK_GEOMETRY,
} from './brandMark.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface WebAppManifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  background_color?: string;
  theme_color?: string;
  icons?: ManifestIcon[];
}

function readPngMetadata(buf: Buffer, label: string): {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  topLeftAlpha: number | null;
} {
  assert.equal(
    buf.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    `${label} must have valid PNG signature`
  );
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);

  let topLeftAlpha: number | null = null;
  if (colorType === 6 && bitDepth === 8) {
    // Concatenate IDAT chunks to verify top-left pixel (0,0) transparency on rounded icons.
    const idatParts: Buffer[] = [];
    let offset = 8;
    while (offset + 8 <= buf.length) {
      const length = buf.readUInt32BE(offset);
      const chunkType = buf.subarray(offset + 4, offset + 8).toString('ascii');
      const dataStart = offset + 8;
      if (chunkType === 'IDAT') {
        idatParts.push(buf.subarray(dataStart, dataStart + length));
      } else if (chunkType === 'IEND') {
        break;
      }
      offset = dataStart + length + 4;
    }
    const raw = inflateSync(Buffer.concat(idatParts));
    // For pixel (0,0), neighbors are 0 under every PNG filter (0..4), so byte 4 is exact alpha.
    topLeftAlpha = raw.readUInt8(4);
  }

  return { width, height, bitDepth, colorType, topLeftAlpha };
}

function readPngFile(filePath: string) {
  return readPngMetadata(readFileSync(filePath), path.basename(filePath));
}

test('manifest.webmanifest defines required mobile PWA fields and separate any/maskable icons', () => {
  const manifestPath = path.join(PUBLIC_DIR, 'manifest.webmanifest');
  assert.ok(existsSync(manifestPath), 'public/manifest.webmanifest must exist');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WebAppManifest;
  assert.equal(manifest.name, 'CourtPulse');
  assert.equal(manifest.short_name, 'CourtPulse');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color?.toLowerCase(), COURTPULSE_BRAND.themeColor);
  assert.equal(
    manifest.background_color?.toLowerCase(),
    COURTPULSE_BRAND.backgroundColor
  );

  const icons = manifest.icons ?? [];
  assert.ok(icons.length >= 4, 'manifest should declare 192 and 512 icons for any and maskable');

  for (const icon of icons) {
    assert.notEqual(
      icon.purpose,
      'any maskable',
      'never combine "any maskable" in one icon entry'
    );
    const localFile = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ''));
    assert.ok(existsSync(localFile), `manifest icon ${icon.src} must exist under public/`);
    const [expectedW, expectedH] = icon.sizes.split('x').map(Number);
    const meta = readPngFile(localFile);
    assert.equal(meta.width, expectedW, `${icon.src} width should match ${icon.sizes}`);
    assert.equal(meta.height, expectedH, `${icon.src} height should match ${icon.sizes}`);
    if (icon.purpose === 'any') {
      assert.equal(meta.colorType, 6, `${icon.src} ("any") should retain RGBA rounded corners`);
      assert.equal(meta.topLeftAlpha, 0, `${icon.src} ("any") should have transparent corner outside squircle`);
    }
    if (icon.purpose === 'maskable') {
      assert.ok(
        meta.colorType !== 6 && meta.colorType !== 4,
        `${icon.src} ("maskable") must be opaque full-bleed with no alpha channel`
      );
    }
  }

  for (const purpose of ['any', 'maskable']) {
    for (const size of ['192x192', '512x512']) {
      assert.ok(
        icons.some((i) => i.purpose === purpose && i.sizes === size && i.type === 'image/png'),
        `manifest must include a ${size} PNG icon with purpose "${purpose}"`
      );
    }
  }
});

test('apple-touch-icon, favicon.ico, favicon-32x32.png, and favicon.svg exist with valid formats and zero drift', () => {
  const appleIcon = path.join(PUBLIC_DIR, 'apple-touch-icon.png');
  assert.ok(existsSync(appleIcon), 'public/apple-touch-icon.png must exist');
  const appleMeta = readPngFile(appleIcon);
  assert.equal(appleMeta.width, 180);
  assert.equal(appleMeta.height, 180);
  assert.ok(
    appleMeta.colorType !== 6 && appleMeta.colorType !== 4,
    'apple-touch-icon.png must be opaque (no alpha channel) so iOS does not render black corners'
  );

  const favicon32 = readPngFile(path.join(PUBLIC_DIR, 'favicon-32x32.png'));
  assert.equal(favicon32.width, 32);
  assert.equal(favicon32.height, 32);
  assert.equal(favicon32.topLeftAlpha, 0);

  const faviconIcoPath = path.join(PUBLIC_DIR, 'favicon.ico');
  assert.ok(existsSync(faviconIcoPath), 'public/favicon.ico must exist for legacy and root requests');
  const icoBuf = readFileSync(faviconIcoPath);
  assert.equal(icoBuf.readUInt16LE(0), 0, 'ICO reserved word must be 0');
  assert.equal(icoBuf.readUInt16LE(2), 1, 'ICO type word must be 1');
  const icoCount = icoBuf.readUInt16LE(4);
  assert.equal(icoCount, 2, 'favicon.ico should embed 16x16 and 32x32 icons');
  const icoSizes: number[] = [];
  for (let i = 0; i < icoCount; i++) {
    const dirOff = 6 + i * 16;
    const w = icoBuf.readUInt8(dirOff) || 256;
    const h = icoBuf.readUInt8(dirOff + 1) || 256;
    assert.equal(w, h);
    icoSizes.push(w);
    const bytesInRes = icoBuf.readUInt32LE(dirOff + 8);
    const imgOff = icoBuf.readUInt32LE(dirOff + 12);
    const payload = icoBuf.subarray(imgOff, imgOff + bytesInRes);
    const entryMeta = readPngMetadata(payload, `favicon.ico[${w}x${h}]`);
    assert.equal(entryMeta.width, w);
    assert.equal(entryMeta.height, h);
  }
  assert.deepEqual(icoSizes.sort((a, b) => a - b), [16, 32]);

  const faviconSvgPath = path.join(PUBLIC_DIR, 'favicon.svg');
  assert.ok(existsSync(faviconSvgPath), 'public/favicon.svg must exist');
  const svg = readFileSync(faviconSvgPath, 'utf8');
  assert.equal(
    svg.trim(),
    buildCourtPulseTileSvg({ size: 0, rounded: true, includeShadow: false }).trim(),
    'public/favicon.svg must match canonical buildCourtPulseTileSvg output'
  );
  assert.doesNotMatch(svg, /<script/i);
});

test('maskable geometry stays comfortably inside Android adaptive and W3C safe zones, and CourtPulseMark uses canonical source', () => {
  const g = COURTPULSE_MARK_GEOMETRY;
  // Local upright extreme extents relative to (0, 0), before opticalPivotY shift and maskableScale:
  // - Outer pulse arc radius 96 centered at y=-52, stroke 16 -> top y = -156
  // - Center feather tip -> y = +169
  // - Outer feather corners -> (+-95, +150)
  const samplePoints: Array<[number, number]> = [
    [0, -156],
    [0, 169],
    [-95, 149],
    [95, 149],
    [-69.1 - 8, -118.7 - 8],
    [69.1 + 8, -118.7 - 8],
  ];
  const androidAdaptiveViewportRadius = (g.viewBoxSize / 2) * (72 / 108); // ~170.67px
  const w3cMaskableSafeRadius = (g.viewBoxSize / 2) * 0.8; // 204.8px

  for (const [x, y] of samplePoints) {
    const shiftedY = y + g.opticalPivotY;
    const r = Math.hypot(x * g.maskableScale, shiftedY * g.maskableScale);
    assert.ok(
      r < androidAdaptiveViewportRadius,
      `point (${x}, ${y}) scaled radius ${r.toFixed(1)} must stay inside Android 66.7% viewport (${androidAdaptiveViewportRadius.toFixed(1)})`
    );
    assert.ok(
      r < w3cMaskableSafeRadius,
      `point (${x}, ${y}) scaled radius ${r.toFixed(1)} must stay inside W3C 80% safe zone (${w3cMaskableSafeRadius})`
    );
  }

  const componentSrc = readFileSync(
    path.join(ROOT_DIR, 'src/components/ui/CourtPulseMark.tsx'),
    'utf8'
  );
  assert.match(componentSrc, /from ['"]\.\.\/\.\.\/utils\/brandMark\.ts['"]/);
});

test('index.html links manifest, favicons, apple-touch-icon, and mobile PWA meta tags', () => {
  const html = readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, new RegExp(`<meta\\s+name="theme-color"\\s+content="${COURTPULSE_BRAND.themeColor}"\\s*/?>`, 'i'));
  assert.match(html, /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/?>/);
  assert.match(html, /<link\s+rel="icon"\s+href="\/favicon\.ico"[^>]*\/?>/);
  assert.match(html, /<link\s+rel="icon"\s+type="image\/png"\s+sizes="32x32"\s+href="\/favicon-32x32\.png"\s*\/?>/);
  assert.match(html, /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/favicon\.svg"\s*\/?>/);
  assert.match(html, /<link\s+rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"\s*\/?>/);
  assert.match(html, /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*\/?>/);
  assert.match(html, /<meta\s+name="apple-mobile-web-app-title"\s+content="CourtPulse"\s*\/?>/);
  assert.doesNotMatch(html, /data:image\/svg\+xml/, 'inline data-URI favicon should be replaced by static icon assets');
});

test('firebase.json sets application/manifest+json Content-Type and no-cache on /manifest.webmanifest', () => {
  const raw = JSON.parse(readFileSync(path.join(ROOT_DIR, 'firebase.json'), 'utf8')) as {
    hosting?: {
      headers?: Array<{
        source: string;
        headers: Array<{ key: string; value: string }>;
      }>;
    };
  };
  const rule = raw.hosting?.headers?.find((h) => h.source === '/manifest.webmanifest');
  assert.ok(rule, 'firebase.json should configure headers for /manifest.webmanifest');
  assert.ok(
    rule.headers.some(
      (h) =>
        h.key.toLowerCase() === 'content-type' &&
        h.value.includes('application/manifest+json')
    )
  );
  assert.ok(
    rule.headers.some(
      (h) => h.key.toLowerCase() === 'cache-control' && h.value.includes('no-cache')
    )
  );
});
