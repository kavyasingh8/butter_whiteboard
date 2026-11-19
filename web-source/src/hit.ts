import { textLayout } from './draw';
import type { ImageOp, Op } from './types';

/** Extra reach around thin lines, in board units, so they are easy to click. */
const TOLERANCE = 8;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function measure() {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  return measureCtx;
}

function segmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointBounds(p: number[], pad: number): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** Whether a board point lies inside a box turned `deg` degrees around its centre. */
function onRotated(b: Bounds, deg: number, x: number, y: number) {
  const a = (-deg * Math.PI) / 180;
  const dx = x - (b.x + b.w / 2);
  const dy = y - (b.y + b.h / 2);
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

/** Whether a board point lies on a rotated image. */
export function onImage(op: ImageOp, x: number, y: number) {
  return onRotated(op, op.r ?? 0, x, y);
}

/** Box around an op before its rotation, for the selection outline. */
export function opBounds(op: Op, fonts: string[]): Bounds | null {
  switch (op.t) {
    case 's':
      return pointBounds(op.p, op.w / 2);
    case 'l':
      // Arrow heads reach past the end point.
      return pointBounds(op.p, op.k === 'arrow' ? Math.max(op.w * 3.2, 14) / 2 : op.w / 2);
    case 'x': {
      const ctx = measure();
      if (!ctx) return null;
      const { width, height, pad } = textLayout(ctx, op, fonts);
      return { x: op.x - pad, y: op.y - pad, w: width + pad * 2, h: height + pad * 2 };
    }
    case 'i':
      return { x: op.x, y: op.y, w: op.w, h: op.h };
  }
}

function inside(b: Bounds, x: number, y: number) {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** Whether a board point is on the visible part of an op. Eraser strokes never are. */
export function hitOp(op: Op, x: number, y: number, fonts: string[]): boolean {
  switch (op.t) {
    case 's': {
      if (op.e) return false;
      const reach = op.w / 2 + TOLERANCE;
      const p = op.p;
      if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
      for (let i = 0; i < p.length - 2; i += 2) {
        if (segmentDistance(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
      }
      return false;
    }
    case 'l': {
      const [x1, y1, x2, y2] = op.p;
      const reach = op.w / 2 + TOLERANCE;
      if (op.k === 'line' || op.k === 'arrow') return segmentDistance(x, y, x1, y1, x2, y2) <= reach;
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      if (op.k === 'rect') {
        const outer = { x: left - reach, y: top - reach, w: w + reach * 2, h: h + reach * 2 };
        const inner = { x: left + reach, y: top + reach, w: w - reach * 2, h: h - reach * 2 };
        return inside(outer, x, y) && (op.fl === true || inner.w <= 0 || inner.h <= 0 || !inside(inner, x, y));
      }
      const rx = w / 2;
      const ry = h / 2;
      if (rx < 1 || ry < 1) return segmentDistance(x, y, x1, y1, x2, y2) <= reach;
      const r = Math.hypot((x - left - rx) / rx, (y - top - ry) / ry);
      if (op.fl && r <= 1) return true;
      return Math.abs(r - 1) * Math.min(rx, ry) <= reach;
    }
    case 'x': {
      const b = opBounds(op, fonts);
      return b !== null && onRotated(b, op.r ?? 0, x, y);
    }
    case 'i':
      return onImage(op, x, y);
  }
}

/** How far stroke and shape points may sit past the board edge before the server clamps them. */
const POINT_MARGIN = 64;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Limits a drag so the op stays where the server accepts it whole. Past these
 * limits the server clamps each point on its own, which would bend the drawing.
 */
export function clampDelta(op: Op, dx: number, dy: number, width: number, height: number, minImage: number): [number, number] {
  if (op.t === 's' || op.t === 'l') {
    const b = pointBounds(op.p, 0);
    return [
      clamp(dx, -POINT_MARGIN - b.x, width + POINT_MARGIN - (b.x + b.w)),
      clamp(dy, -POINT_MARGIN - b.y, height + POINT_MARGIN - (b.y + b.h)),
    ];
  }
  if (op.t === 'x') return [clamp(dx, -op.x, width - op.x), clamp(dy, -op.y, height - op.y)];
  return [clamp(dx, minImage - op.w - op.x, width - minImage - op.x), clamp(dy, minImage - op.h - op.y, height - minImage - op.y)];
}

/** A copy of an op moved by dx, dy board units. */
export function translateOp<T extends Op>(op: T, dx: number, dy: number): T {
  if (op.t === 's' || op.t === 'l') {
    return { ...op, p: op.p.map((v, i) => Math.round(v + (i % 2 === 0 ? dx : dy))) } as T;
  }
  return { ...op, x: Math.round(op.x + dx), y: Math.round(op.y + dy) } as T;
}
