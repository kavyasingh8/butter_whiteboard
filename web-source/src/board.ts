import { drawOp, drawPattern, onImageSettled } from './draw';
import { hitOp, onImage } from './hit';
import type { BoardMessage, Op, Pattern } from './types';

export const asArray = <T>(value: T[] | Record<string, never> | null | undefined): T[] =>
  Array.isArray(value) ? value : [];

/** A remote in-progress stroke that stops updating is dropped, e.g. when its op was refused. */
const LIVE_STALE_MS = 10000;

function layer(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return ctx;
}

/** Whether two ops are the same drawing, ignoring the id the server gave one of them. */
function sameDrawing(a: Op, b: Op) {
  if (a.t !== b.t) return false;
  switch (a.t) {
    case 's':
    case 'l':
      return b.t === a.t && a.p.join() === b.p.join();
    case 'x':
      return b.t === 'x' && a.x === b.x && a.y === b.y && a.v === b.v;
    case 'i':
      return b.t === 'i' && a.x === b.x && a.y === b.y && a.m === b.m;
  }
}

/**
 * Renders a board's ops onto a canvas. Shared by the editor and the DUI on the prop.
 * Committed ops are baked into an ink layer, in-progress strokes from other players
 * and our own unconfirmed ops are overlays drawn on top of a copy of it.
 *
 * Overlay keys: `r<src>` a remote live stroke, `l<key>` our unconfirmed op,
 * `e<id>` our unconfirmed edit of op `id`, `draft` what we are drawing right now.
 */
export class BoardRenderer {
  private ops: Op[] = [];
  private overlays = new Map<string, Op>();
  private liveSeen = new Map<string, number>();
  private base: CanvasRenderingContext2D;
  private ink: CanvasRenderingContext2D;
  private scratch: CanvasRenderingContext2D;
  private out: CanvasRenderingContext2D | null = null;
  private frame = 0;
  private sweeper = 0;
  private dirtyInk = false;
  private pattern: Pattern = 'plain';
  private offImages: (() => void) | null = null;
  private hidden = new Set<number>();

  constructor(
    readonly width: number,
    readonly height: number,
    private background: string,
    private fonts: string[],
  ) {
    this.base = layer(width, height);
    this.ink = layer(width, height);
    this.scratch = layer(width, height);
    drawPattern(this.base, this.pattern, background);
  }

  /** Starts drawing into `canvas`, or stops drawing when it is null. */
  attach(canvas: HTMLCanvasElement | null) {
    this.offImages?.();
    this.offImages = null;
    window.clearInterval(this.sweeper);
    this.sweeper = 0;
    this.out = canvas?.getContext('2d') ?? null;
    if (!this.out) return;
    // Images that finished loading while detached are picked up by this rebuild.
    this.offImages = onImageSettled(() => this.rebuild());
    this.sweeper = window.setInterval(() => this.dropStaleLive(), 1000);
    this.rebuild();
  }

  dispose() {
    this.attach(null);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  countImages() {
    return this.ops.reduce((n, op) => (op.t === 'i' ? n + 1 : n), 0);
  }

  getOp(id: number) {
    return this.ops.find((op) => op.i === id);
  }

  /** Topmost committed image under a board point. */
  imageAt(x: number, y: number) {
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (op.t === 'i' && onImage(op, x, y)) return op;
    }
    return null;
  }

  /** Topmost committed op under a board point that can be picked up. */
  opAt(x: number, y: number) {
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (op.i !== undefined && hitOp(op, x, y, this.fonts)) return op;
    }
    return null;
  }

  /** Leaves a committed op out of the render, e.g. while it is being edited. */
  hide(id: number) {
    if (this.hidden.has(id)) return;
    this.hidden.add(id);
    this.rebuild();
  }

  show(id: number) {
    if (!this.hidden.delete(id)) return;
    this.rebuild();
  }

  setPattern(pattern: Pattern | undefined) {
    const next = pattern ?? 'plain';
    if (next === this.pattern) return;
    this.pattern = next;
    drawPattern(this.base, next, this.background);
    this.schedule();
  }

  setOverlay(key: string, op: Op | null) {
    if (op) this.overlays.set(key, op);
    else this.overlays.delete(key);
    this.schedule();
  }

  getOverlay(key: string) {
    return this.overlays.get(key);
  }

  /** Redraws every committed op on the next frame, e.g. after an image or font loads. */
  rebuild() {
    this.dirtyInk = true;
    this.schedule();
  }

  apply(msg: BoardMessage) {
    switch (msg.type) {
      case 'full':
        this.ops = asArray(msg.ops).slice();
        this.dropConfirmedLocal();
        for (const id of this.hidden) if (!this.getOp(id)) this.hidden.delete(id);
        this.setPattern(msg.bg);
        this.rebuild();
        return;
      case 'add':
        this.overlays.delete(`r${msg.src}`);
        this.liveSeen.delete(`r${msg.src}`);
        if (msg.clientKey) this.overlays.delete(`l${msg.clientKey}`);
        this.ops.push(msg.op);
        if (!this.dirtyInk) drawOp(this.ink, msg.op, this.fonts);
        this.schedule();
        return;
      case 'update': {
        if (msg.op.i === undefined) return;
        this.overlays.delete(`e${msg.op.i}`);
        this.hidden.delete(msg.op.i);
        const index = this.ops.findIndex((op) => op.i === msg.op.i);
        if (index === -1) return;
        // Edited ops come to the front, as on the server.
        this.ops.splice(index, 1);
        this.ops.push(msg.op);
        this.rebuild();
        return;
      }
      case 'remove': {
        this.overlays.delete(`e${msg.id}`);
        this.hidden.delete(msg.id);
        const index = this.ops.findIndex((op) => op.i === msg.id);
        if (index === -1) return this.schedule();
        this.ops.splice(index, 1);
        this.rebuild();
        return;
      }
      case 'clear':
        this.ops = [];
        this.overlays.clear();
        this.liveSeen.clear();
        this.hidden.clear();
        this.rebuild();
        return;
      case 'background':
        this.setPattern(msg.bg);
        return;
      case 'live':
        this.applyLive(msg);
    }
  }

  /** After a full download, our unconfirmed ops that it already holds are not drawn twice. */
  private dropConfirmedLocal() {
    for (const [key, local] of this.overlays) {
      if (key.startsWith('l') && this.ops.some((op) => sameDrawing(op, local))) this.overlays.delete(key);
    }
  }

  private dropStaleLive() {
    const cutoff = Date.now() - LIVE_STALE_MS;
    let dropped = false;
    for (const [key, at] of this.liveSeen) {
      if (at >= cutoff) continue;
      this.liveSeen.delete(key);
      this.overlays.delete(key);
      dropped = true;
    }
    if (dropped) this.schedule();
  }

  private applyLive(msg: Extract<BoardMessage, { type: 'live' }>) {
    const key = `r${msg.src}`;
    if (msg.kind !== 'end' && msg.kind !== 'cursor') this.liveSeen.set(key, Date.now());
    switch (msg.kind) {
      case 'start':
        this.setOverlay(key, { t: 's', c: msg.data.c, w: msg.data.w, e: msg.data.e, a: msg.data.a, p: msg.data.p.slice() });
        return;
      case 'move': {
        const op = this.overlays.get(key);
        if (op?.t !== 's') return;
        op.p.push(...msg.data);
        this.schedule();
        return;
      }
      case 'shape':
        this.setOverlay(key, msg.data);
        return;
      case 'end':
        this.liveSeen.delete(key);
        this.setOverlay(key, null);
    }
  }

  schedule() {
    if (this.frame || !this.out) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private bakeInk() {
    this.ink.clearRect(0, 0, this.width, this.height);
    for (const op of this.ops) if (op.i === undefined || !this.hidden.has(op.i)) drawOp(this.ink, op, this.fonts);
    this.dirtyInk = false;
  }

  private render() {
    const out = this.out;
    if (!out) return;
    if (this.dirtyInk) this.bakeInk();

    let ink = this.ink.canvas;
    if (this.overlays.size > 0) {
      this.scratch.clearRect(0, 0, this.width, this.height);
      this.scratch.drawImage(ink, 0, 0);
      for (const op of this.overlays.values()) drawOp(this.scratch, op, this.fonts);
      ink = this.scratch.canvas;
    }

    const { width, height } = out.canvas;
    out.clearRect(0, 0, width, height);
    out.drawImage(this.base.canvas, 0, 0, width, height);
    out.drawImage(ink, 0, 0, width, height);
  }
}
