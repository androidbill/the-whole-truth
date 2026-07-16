// Generates PWA icons (pure Node, no deps): gradient rounded square
// with a white speech bubble and three dots.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

// ---- minimal PNG encoder ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- drawing helpers ----
const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (v) => Math.max(0, Math.min(1, v))
// soft edge: returns coverage 0..1 given signed distance in px (negative = inside)
const soft = (d) => clamp01(0.5 - d)

function roundedRectDist(x, y, size, r) {
  const hx = size / 2
  const qx = Math.abs(x - hx) - (hx - r)
  const qy = Math.abs(y - hx) - (hx - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}
function circleDist(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r
}
function inTriangle(px, py, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
  const d1 = sign([px, py], a, b)
  const d2 = sign([px, py], b, c)
  const d3 = sign([px, py], c, a)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}
// distance from point to line segment (for capsule strokes)
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

// gradient stops: purple -> magenta -> pink
const C1 = [124, 58, 237]
const C2 = [192, 38, 211]
const C3 = [219, 39, 119]
function gradAt(t) {
  if (t < 0.5) {
    const u = t / 0.5
    return [lerp(C1[0], C2[0], u), lerp(C1[1], C2[1], u), lerp(C1[2], C2[2], u)]
  }
  const u = (t - 0.5) / 0.5
  return [lerp(C2[0], C3[0], u), lerp(C2[1], C3[1], u), lerp(C2[2], C3[2], u)]
}

function drawIcon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4)
  const S = size
  const bubbleR = S * 0.28
  const bcx = S * 0.5
  const bcy = S * 0.42
  const tail = [
    [S * 0.4, S * 0.6],
    [S * 0.6, S * 0.64],
    [S * 0.36, S * 0.8],
  ]
  // bold checkmark inside the bubble: two capsule strokes
  const ck = {
    a: [S * 0.375, S * 0.43],
    b: [S * 0.465, S * 0.525],
    c: [S * 0.635, S * 0.325],
    w: S * 0.047,
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      const px = x + 0.5
      const py = y + 0.5
      // background
      let bgA
      if (maskable) bgA = 1
      else bgA = soft(roundedRectDist(px, py, S, S * 0.22))
      const t = (x + y) / (2 * S)
      const [r, g, b] = gradAt(t)
      let R = r
      let G = g
      let B = b
      // subtle vignette highlight top-left
      const hl = clamp01(1 - Math.hypot(x - S * 0.3, y - S * 0.25) / (S * 0.9)) * 22
      R += hl
      G += hl
      B += hl
      // white bubble (circle + tail)
      let white = soft(circleDist(px, py, bcx, bcy, bubbleR))
      if (white < 1 && inTriangle(px, py, ...tail)) white = 1
      if (white > 0) {
        R = lerp(R, 255, white)
        G = lerp(G, 255, white)
        B = lerp(B, 255, white)
      }
      // gradient checkmark punched into the bubble
      const dCheck = Math.min(
        segDist(px, py, ck.a[0], ck.a[1], ck.b[0], ck.b[1]),
        segDist(px, py, ck.b[0], ck.b[1], ck.c[0], ck.c[1])
      ) - ck.w
      const check = soft(dCheck)
      if (check > 0) {
        R = lerp(R, r, check)
        G = lerp(G, g, check)
        B = lerp(B, b, check)
      }
      buf[i] = Math.round(clamp01(R / 255) * 255)
      buf[i + 1] = Math.round(clamp01(G / 255) * 255)
      buf[i + 2] = Math.round(clamp01(B / 255) * 255)
      buf[i + 3] = Math.round(bgA * 255)
    }
  }
  return png(S, S, buf)
}

for (const [file, size, opts] of [
  ['icon-512.png', 512, {}],
  ['icon-192.png', 192, {}],
  ['icon-180.png', 180, { maskable: true }],
  ['icon-maskable-512.png', 512, { maskable: true }],
]) {
  writeFileSync(join(OUT, file), drawIcon(size, opts))
  console.log('wrote', file)
}
