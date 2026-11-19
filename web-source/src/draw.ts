import type { ImageOp, Op, Pattern, ShapeOp, StrokeOp, TextOp } from './types';

type ImageState = 'loading' | 'ready' | 'error';
interface ImageEntry {
  img: HTMLImageElement;
  state: ImageState;
}

/** Most images kept loaded. A board holds a dozen at most, this leaves room for previews and admin browsing. */
const MAX_IMAGES = 96;

// Kept in least recently used order, the first entry is evicted first.
const images = new Map<string, ImageEntry>();
const imageListeners = new Set<() => void>();

/** Runs `fn` whenever any board image finishes loading or fails. */
export function onImageSettled(fn: () => void) {
  imageListeners.add(fn);
  return () => {
    imageListeners.delete(fn);
  };
}

function getImage(url: string): ImageEntry {
  const cached = images.get(url);
  if (cached) {
    images.delete(url);
    images.set(url, cached);
    return cached;
  }

  if (images.size >= MAX_IMAGES) {
    const oldest = images.keys().next().value;
    if (oldest !== undefined) images.delete(oldest);
  }

  const img = new Image();
  const entry: ImageEntry = { img, state: 'loading' };
  const settle = (state: ImageState) => {
    entry.state = state;
    imageListeners.forEach((fn) => fn());
  };
  img.onload = () => settle('ready');
  img.onerror = () => settle('error');
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  images.set(url, entry);
  return entry;
}

/** Loads an image for previewing, resolving with its natural size. */
export function probeImage(url: string): Promise<{ width: number; height: number }> {
  // A failed link gets another try, the player may have fixed a typo upstream.
  if (images.get(url)?.state === 'error') images.delete(url);
  const entry = getImage(url);
  return new Promise((resolve, reject) => {
    const check = () => {
      if (entry.state === 'loading') return;
      off();
      if (entry.state === 'ready') resolve({ width: entry.img.naturalWidth, height: entry.img.naturalHeight });
      else reject(new Error('failed'));
    };
    const off = onImageSettled(check);
    check();
  });
}

function drawStroke(ctx: CanvasRenderingContext2D, op: StrokeOp) {
  const p = op.p;
  const count = p.length / 2;
  if (count < 1) return;

  ctx.globalCompositeOperation = op.e ? 'destination-out' : 'source-over';
  // One path per stroke, so a translucent stroke stays even where it overlaps itself.
  ctx.globalAlpha = op.e ? 1 : (op.a ?? 1);
  ctx.strokeStyle = op.c;
  ctx.fillStyle = op.c;
  ctx.lineWidth = op.w;

  if (count === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], op.w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 1; i < count - 1; i++) {
    const x = p[i * 2];
    const y = p[i * 2 + 1];
    ctx.quadraticCurveTo(x, y, (x + p[i * 2 + 2]) / 2, (y + p[i * 2 + 3]) / 2);
  }
  ctx.lineTo(p[count * 2 - 2], p[count * 2 - 1]);
  ctx.stroke();
}

function drawShape(ctx: CanvasRenderingContext2D, op: ShapeOp) {
  const [x1, y1, x2, y2] = op.p;
  ctx.globalAlpha = op.a ?? 1;
  ctx.strokeStyle = op.c;
  ctx.fillStyle = op.c;
  ctx.lineWidth = op.w;
  ctx.beginPath();
  // Filled shapes skip the outline, it would draw darker over a translucent fill.
  const paint = () => (op.fl ? ctx.fill() : ctx.stroke());

  switch (op.k) {
    case 'line':
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      return;
    case 'arrow': {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const length = Math.hypot(x2 - x1, y2 - y1);
      const head = Math.min(Math.max(14, op.w * 3.2), length);
      // Stop the shaft inside the head so the round cap does not poke through the tip.
      const inset = head * 0.6;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - Math.cos(angle) * inset, y2 - Math.sin(angle) * inset);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
      ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'rect':
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      paint();
      return;
    case 'ellipse':
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      paint();
  }
}

export function fontFor(size: number, fontIndex: number, fonts: string[]) {
  return `600 ${size}px "${fonts[fontIndex - 1] ?? 'Inter'}", sans-serif`;
}

export const LINE_HEIGHT = 1.2;
export const NOTE_COLOR = '#fff1a6';
const NOTE_PAD = 0.4;

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  width: number;
  height: number;
  /** Space around the text taken by a sticky note. */
  pad: number;
}

/** Size of a text op on the board. Sets the context's font as a side effect. */
export function textLayout(ctx: CanvasRenderingContext2D, op: TextOp, fonts: string[]): TextLayout {
  ctx.font = fontFor(op.s, op.f, fonts);
  const lines = op.v.split('\n');
  const lineHeight = op.s * LINE_HEIGHT;
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
  return { lines, lineHeight, width, height: op.s + (lines.length - 1) * lineHeight, pad: op.n ? op.s * NOTE_PAD : 0 };
}

function drawText(ctx: CanvasRenderingContext2D, op: TextOp, fonts: string[]) {
  const { lines, lineHeight, width, height, pad } = textLayout(ctx, op, fonts);
  if (op.r) {
    const cx = op.x + width / 2;
    const cy = op.y + height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((op.r * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  if (op.n) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = NOTE_COLOR;
    ctx.fillRect(op.x - pad, op.y - pad, width + pad * 2, height + pad * 2);
    ctx.restore();
  }
  ctx.fillStyle = op.c;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, op.x, op.y + i * lineHeight));
}

export const PRINT_COLOR = '#fbf7ee';

function drawImage(ctx: CanvasRenderingContext2D, op: ImageOp) {
  const { img, state } = getImage(op.m);
  const mat = Math.min(8, Math.min(op.w, op.h) * 0.04);

  if (op.r) {
    const cx = op.x + op.w / 2;
    const cy = op.y + op.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((op.r * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // A warm print lifted off the board, so it stands apart from the white surface.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = PRINT_COLOR;
  ctx.fillRect(op.x, op.y, op.w, op.h);
  ctx.restore();
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = PRINT_COLOR;
  ctx.fillRect(op.x, op.y, op.w, op.h);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(op.x + 0.5, op.y + 0.5, op.w - 1, op.h - 1);

  const ix = op.x + mat;
  const iy = op.y + mat;
  const iw = op.w - mat * 2;
  const ih = op.h - mat * 2;

  if (state === 'ready') {
    ctx.drawImage(img, ix, iy, iw, ih);
  } else {
    ctx.fillStyle = '#e4e1d9';
    ctx.fillRect(ix, iy, iw, ih);
    if (state === 'error') {
      ctx.fillStyle = '#8f8a80';
      ctx.font = '600 16px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Image unavailable', op.x + op.w / 2, op.y + op.h / 2);
    }
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
  drawTape(ctx, op);
}

/** A strip of translucent tape across the top edge of a print. */
function drawTape(ctx: CanvasRenderingContext2D, op: ImageOp) {
  const w = Math.min(op.w * 0.35, 110);
  const h = Math.max(10, Math.min(28, w * 0.28));
  ctx.save();
  ctx.translate(op.x + op.w / 2, op.y);
  ctx.rotate(-0.04);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
  ctx.shadowBlur = 2;
  ctx.fillStyle = 'rgba(238, 230, 200, 0.75)';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

export function drawOp(ctx: CanvasRenderingContext2D, op: Op, fonts: string[]) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  switch (op.t) {
    case 's':
      drawStroke(ctx, op);
      break;
    case 'l':
      drawShape(ctx, op);
      break;
    case 'x':
      drawText(ctx, op, fonts);
      break;
    case 'i':
      drawImage(ctx, op);
      break;
  }
  ctx.restore();
}

export function drawPattern(ctx: CanvasRenderingContext2D, pattern: Pattern, background: string) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  if (pattern === 'grid') {
    for (let x = 40; x < width; x += 40) {
      ctx.fillStyle = x % 200 === 0 ? 'rgba(40, 80, 150, 0.16)' : 'rgba(40, 80, 150, 0.08)';
      ctx.fillRect(x, 0, 1, height);
    }
    for (let y = 40; y < height; y += 40) {
      ctx.fillStyle = y % 200 === 0 ? 'rgba(40, 80, 150, 0.16)' : 'rgba(40, 80, 150, 0.08)';
      ctx.fillRect(0, y, width, 1);
    }
    return;
  }

  if (pattern === 'lines') {
    ctx.fillStyle = 'rgba(50, 100, 190, 0.2)';
    for (let y = 72; y < height; y += 36) ctx.fillRect(0, y, width, 1.5);
    ctx.fillStyle = 'rgba(220, 60, 60, 0.32)';
    ctx.fillRect(96, 0, 2, height);
    return;
  }

  if (pattern === 'dots') {
    ctx.fillStyle = 'rgba(30, 40, 60, 0.2)';
    for (let y = 32; y < height; y += 32) {
      for (let x = 32; x < width; x += 32) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
