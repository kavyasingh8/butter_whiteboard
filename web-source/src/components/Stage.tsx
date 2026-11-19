import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { BoardRenderer } from '../board';
import { LINE_HEIGHT, NOTE_COLOR, fontFor, textLayout } from '../draw';
import { clampDelta, measure, opBounds, translateOp } from '../hit';
import { t } from '../i18n';
import type { ImageOp, Op, Settings, ShapeKind, ShapeOp, StrokeOp, TextOp, Tool } from '../types';
import { ImagePlacer, type PendingImage } from './ImagePlacer';
import type { ToolStyle } from './PropertyBar';
import { RemoteCursors, type RemoteCursor } from './RemoteCursors';
import { cx } from './ui';

const DRAFT = 'draft';
const LIVE_INTERVAL = 50;
const CURSOR_INTERVAL = 100;
const MIN_POINT_GAP = 1.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.15;
const SHAPES: Tool[] = ['line', 'arrow', 'rect', 'ellipse'];
const ROTATE_SNAP = 15;

export type LiveKind = 'start' | 'move' | 'shape' | 'end' | 'cursor';

interface StageProps {
  renderer: BoardRenderer;
  settings: Settings;
  tool: Tool;
  style: ToolStyle;
  pendingImage: PendingImage | null;
  selected: number | null;
  cursors: RemoteCursor[];
  canEdit: (id: number) => boolean;
  onSelect: (id: number | null) => void;
  onEdit: (id: number, op: Op) => void;
  onDelete: (id: number) => void;
  onPendingImage: (image: PendingImage) => void;
  onPickImage: (op: ImageOp) => void;
  onCommit: (op: Op) => void;
  onLive: (kind: LiveKind, data?: unknown) => void;
}

type Gesture =
  | { kind: 'stroke'; op: StrokeOp; sent: number }
  | { kind: 'shape'; op: ShapeOp; x: number; y: number; dirty: boolean }
  | { kind: 'move'; id: number; origin: Op; op: Op; x: number; y: number }
  /** Turns a text around its centre, given in screen pixels. */
  | { kind: 'rotate'; id: number; origin: TextOp; op: TextOp; cx: number; cy: number }
  | { kind: 'pan'; startX: number; startY: number; view: View };

interface TextDraft {
  x: number;
  y: number;
  value: string;
  /** The committed text being retyped, it keeps its own look. */
  edit?: TextOp;
}

/** Zoom factor and pan offset of the board inside the stage, in screen pixels. */
interface View {
  z: number;
  x: number;
  y: number;
}

const HOME: View = { z: 1, x: 0, y: 0 };

/** Snaps lines to 45 degree steps and boxes to squares. */
function constrain(kind: ShapeKind, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (kind === 'rect' || kind === 'ellipse') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return [x1 + Math.sign(dx || 1) * side, y1 + Math.sign(dy || 1) * side];
  }
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return [x1 + Math.cos(angle) * length, y1 + Math.sin(angle) * length];
}

function normalizeAngle(deg: number) {
  const r = Math.round(deg) % 360;
  return r > 180 ? r - 360 : r <= -180 ? r + 360 : r;
}

/** Keeps the zoomed board covering the whole stage. */
function clampView(view: View, width: number, height: number): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, view.z));
  return {
    z,
    x: Math.min(0, Math.max(width - width * z, view.x)),
    y: Math.min(0, Math.max(height - height * z, view.y)),
  };
}

export function Stage(props: StageProps) {
  const { renderer, settings, tool, style, pendingImage, selected, onLive, onCommit } = props;
  const { width: W, height: H } = settings.canvas;
  const maxPoints = settings.limits?.pointsPerStroke ?? 2500;
  const maxLines = settings.tools.maxTextLines ?? 6;
  const outerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastCursor = useRef(0);
  const [pxPerUnit, setPxPerUnit] = useState(1);
  const [view, setView] = useState<View>(HOME);
  const [dragOp, setDragOp] = useState<Op | null>(null);
  const [text, setTextState] = useState<TextDraft | null>(null);
  // Blur and pointerdown can both try to commit the same draft, the ref makes the first one win.
  const textRef = useRef<TextDraft | null>(null);
  const setText = (draft: TextDraft | null) => {
    textRef.current = draft;
    setTextState(draft);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderer.attach(canvas);
    // clientWidth ignores the zoom transform, so this is the unzoomed scale.
    const observer = new ResizeObserver(() => setPxPerUnit(canvas.clientWidth / W));
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      renderer.attach(null);
    };
  }, [renderer, W]);

  // Streams the in-progress op to other players in small batches.
  useEffect(() => {
    const timer = setInterval(() => {
      const g = gesture.current;
      if (!g) return;
      if (g.kind === 'stroke' && g.sent < g.op.p.length) {
        onLive('move', g.op.p.slice(g.sent));
        g.sent = g.op.p.length;
      } else if (g.kind === 'shape' && g.dirty) {
        onLive('shape', g.op);
        g.dirty = false;
      }
    }, LIVE_INTERVAL);
    return () => clearInterval(timer);
  }, [onLive]);

  const cancelText = () => {
    const editing = textRef.current?.edit?.i;
    if (editing !== undefined) renderer.show(editing);
    setText(null);
  };

  // Switching tools drops a half-typed text.
  useEffect(cancelText, [tool]);

  const toBoard = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H];
  };

  const stageSize = () => [outerRef.current?.clientWidth ?? 0, outerRef.current?.clientHeight ?? 0];

  const startStroke = (x: number, y: number) => {
    const eraser = tool === 'eraser';
    const highlighter = tool === 'highlighter';
    const alpha = highlighter ? (settings.tools.highlighterOpacity ?? 0.35) : style.opacity;
    const op: StrokeOp = {
      t: 's',
      c: eraser ? '#000000' : style.color,
      w: highlighter ? style.highlightSize : style.size,
      e: eraser || undefined,
      a: !eraser && alpha < 1 ? alpha : undefined,
      p: [Math.round(x), Math.round(y)],
    };
    gesture.current = { kind: 'stroke', op, sent: 2 };
    renderer.setOverlay(DRAFT, op);
    onLive('start', { c: op.c, w: op.w, e: op.e, a: op.a, p: op.p.slice() });
  };

  const finishGesture = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;

    if (g.kind === 'pan') return;
    if (g.kind === 'move' || g.kind === 'rotate') {
      setDragOp(null);
      if (g.op !== g.origin) props.onEdit(g.id, g.op);
      return;
    }

    renderer.setOverlay(DRAFT, null);
    if (g.kind === 'shape') {
      const [x1, y1, x2, y2] = g.op.p;
      if (Math.hypot(x2 - x1, y2 - y1) < 3) return onLive('end');
      return onCommit({ ...g.op, p: g.op.p.map(Math.round) });
    }
    onCommit(g.op);
  };

  const commitText = (draft: TextDraft | null) => {
    if (!draft || textRef.current !== draft) return;
    const value = draft.value.trim();
    const { edit } = draft;
    if (edit?.i !== undefined && value && value !== edit.v) {
      setText(null);
      return props.onEdit(edit.i, { ...edit, v: value });
    }
    if (edit?.i !== undefined && !value) {
      setText(null);
      return props.onDelete(edit.i);
    }
    if (edit || !value) return cancelText();
    setText(null);
    onCommit({
      t: 'x', c: style.color, v: value, f: style.font, s: style.textSize, n: style.note || undefined,
      x: Math.round(draft.x), y: Math.round(draft.y),
    });
  };

  /** Reopens a committed text in the textarea, if the player may change it. */
  const editTextAt = (x: number, y: number) => {
    const hit = renderer.opAt(x, y);
    if (hit?.t !== 'x' || hit.i === undefined || !props.canEdit(hit.i)) return false;
    // A move that the server hasn't confirmed yet is the newest version.
    const pending = renderer.getOverlay(`e${hit.i}`);
    const op = pending?.t === 'x' ? pending : hit;
    props.onSelect(null);
    renderer.hide(hit.i);
    setText({ x: op.x, y: op.y, value: op.v, edit: op });
    return true;
  };

  const pick = (x: number, y: number, e: ReactPointerEvent<HTMLDivElement>) => {
    const op = renderer.opAt(x, y);
    if (!op || op.i === undefined || !props.canEdit(op.i)) return props.onSelect(null);
    if (op.t === 'i') {
      props.onSelect(null);
      return props.onPickImage(op);
    }
    props.onSelect(op.i);
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind: 'move', id: op.i, origin: op, op, x, y };
  };

  const startRotate = (e: ReactPointerEvent<HTMLSpanElement>, op: TextOp) => {
    if (e.button !== 0 || op.i === undefined) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // The bounding box of a rotated element still shares its centre.
    const rect = selectionRef.current?.getBoundingClientRect();
    if (!rect) return;
    gesture.current = { kind: 'rotate', id: op.i, origin: op, op, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Right or middle drag pans a zoomed board.
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, view };
      return;
    }
    if (e.button !== 0) return;
    const [x, y] = toBoard(e);

    if (tool === 'select') return pick(x, y, e);

    if (tool === 'image') {
      const op = pendingImage ? null : renderer.imageAt(x, y);
      if (op) props.onPickImage(op);
      return;
    }

    if (tool === 'text') {
      if (textRef.current?.value.trim()) return commitText(textRef.current);
      if (editTextAt(x, y)) return;
      setText({ x, y: y - style.textSize / 2, value: '' });
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    if (SHAPES.includes(tool)) {
      const fill = (tool === 'rect' || tool === 'ellipse') && style.fill;
      const op: ShapeOp = {
        t: 'l', k: tool as ShapeKind, c: style.color, w: style.size, p: [x, y, x, y],
        a: style.opacity < 1 ? style.opacity : undefined, fl: fill || undefined,
      };
      gesture.current = { kind: 'shape', op, x, y, dirty: false };
      renderer.setOverlay(DRAFT, op);
      return;
    }
    startStroke(x, y);
  };

  const moveCursor = (e: ReactPointerEvent) => {
    const el = cursorRef.current;
    const rect = outerRef.current?.getBoundingClientRect();
    if (!el || !rect) return;
    el.style.transform = `translate(${e.clientX - rect.left}px, ${e.clientY - rect.top}px)`;
  };

  const sendCursor = (x: number, y: number) => {
    const now = performance.now();
    if (now - lastCursor.current < CURSOR_INTERVAL) return;
    lastCursor.current = now;
    onLive('cursor', [Math.round(x), Math.round(y)]);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    moveCursor(e);
    const g = gesture.current;
    const [x, y] = toBoard(e);
    // Strokes and shapes already show where we are.
    if (!g) return sendCursor(x, y);

    switch (g.kind) {
      case 'pan': {
        const [width, height] = stageSize();
        setView(clampView({ ...g.view, x: g.view.x + e.clientX - g.startX, y: g.view.y + e.clientY - g.startY }, width, height));
        return;
      }
      case 'move': {
        if (g.op === g.origin) renderer.hide(g.id);
        const [dx, dy] = clampDelta(g.origin, x - g.x, y - g.y, W, H, settings.images.minSize);
        g.op = translateOp(g.origin, dx, dy);
        renderer.setOverlay(`e${g.id}`, g.op);
        setDragOp(g.op);
        sendCursor(x, y);
        return;
      }
      case 'rotate': {
        let r = (Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * 180) / Math.PI + 90;
        if (e.shiftKey) r = Math.round(r / ROTATE_SNAP) * ROTATE_SNAP;
        r = normalizeAngle(r);
        if (r === (g.op.r ?? 0)) return;
        if (g.op === g.origin) renderer.hide(g.id);
        g.op = { ...g.origin, r: r || undefined };
        renderer.setOverlay(`e${g.id}`, g.op);
        setDragOp(g.op);
        return;
      }
      case 'shape': {
        const [x2, y2] = e.shiftKey ? constrain(g.op.k, g.x, g.y, x, y) : [x, y];
        g.op.p = [g.x, g.y, x2, y2];
        g.dirty = true;
        renderer.schedule();
        return;
      }
      case 'stroke': {
        const p = g.op.p;
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < MIN_POINT_GAP) return;
        p.push(Math.round(x), Math.round(y));
        renderer.schedule();
        // Very long strokes are split so each piece stays under the server's point limit.
        if (p.length / 2 >= maxPoints) {
          finishGesture();
          startStroke(x, y);
        }
      }
    }
  };

  // Zooms around the pointer, so the spot under it stays put.
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const rect = outerRef.current?.getBoundingClientRect();
    if (!rect || gesture.current) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const z = Math.min(MAX_ZOOM, Math.max(1, view.z * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)));
    const ratio = z / view.z;
    setView(clampView({ z, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }, rect.width, rect.height));
  };

  const brush = tool === 'pen' || tool === 'eraser' || tool === 'highlighter';
  const brushSize = tool === 'highlighter' ? style.highlightSize : style.size;
  const ring = Math.max(6, brushSize * pxPerUnit * view.z);
  const selectedOp = selected === null ? undefined : (dragOp ?? renderer.getOverlay(`e${selected}`) ?? renderer.getOp(selected));
  const selection = selectedOp ? opBounds(selectedOp, settings.tools.fonts) : null;
  const look = text?.edit
    ? { color: text.edit.c, font: text.edit.f, size: text.edit.s, note: !!text.edit.n }
    : { color: style.color, font: style.font, size: style.textSize, note: style.note };
  const textFont = look.size * pxPerUnit;
  const notePad = look.note ? textFont * 0.4 : 0;
  const selectedText = selectedOp?.t === 'x' ? selectedOp : null;
  const textAngle = text?.edit?.r;
  // Rotates the edit box around the same point the canvas turns the text around.
  const textOrigin = (() => {
    const ctx = textAngle && text?.edit ? measure() : null;
    if (!ctx || !text?.edit) return undefined;
    const { width, height } = textLayout(ctx, { ...text.edit, v: text.value || ' ' }, settings.tools.fonts);
    return `${notePad + (width / 2) * pxPerUnit}px ${notePad + textFont * ((LINE_HEIGHT - 1) / 2) + (height / 2) * pxPerUnit}px`;
  })();

  return (
    <div
      ref={outerRef}
      className={cx(
        'group relative h-full w-full touch-none overflow-hidden',
        brush && 'cursor-none',
        SHAPES.includes(tool) && 'cursor-crosshair',
        tool === 'text' && 'cursor-text',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      onPointerLeave={() => onLive('cursor', false)}
      onDoubleClick={(e) => {
        if (tool !== 'select') return;
        const [x, y] = toBoard(e);
        editTextAt(x, y);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={onWheel}
    >
      <div
        className="relative h-full w-full origin-top-left"
        style={{ transform: view.z > 1 ? `translate(${view.x}px, ${view.y}px) scale(${view.z})` : undefined }}
      >
        <canvas ref={canvasRef} width={W} height={H} className="block h-full w-full" />

        {selection && (
          <div
            ref={selectionRef}
            className="pointer-events-none absolute rounded-sm outline-dashed outline-2 outline-offset-2 outline-accent"
            style={{
              left: `${(selection.x / W) * 100}%`,
              top: `${(selection.y / H) * 100}%`,
              width: `${(selection.w / W) * 100}%`,
              height: `${(selection.h / H) * 100}%`,
              transform: selectedText?.r ? `rotate(${selectedText.r}deg)` : undefined,
            }}
          >
            {selectedText && (
              <>
                <div className="absolute -top-6 left-1/2 h-4 w-0.5 -translate-x-1/2 bg-accent" />
                <span
                  title={t('rotate_hint')}
                  onPointerDown={(e) => startRotate(e, selectedText)}
                  className="pointer-events-auto absolute -top-8 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border-2 border-accent bg-white"
                />
              </>
            )}
          </div>
        )}

        {text && (
          <textarea
            // Focused a frame later, the click that placed it would otherwise blur it straight away.
            ref={(el) => {
              if (!el) return;
              requestAnimationFrame(() => {
                if (document.activeElement === el) return;
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
              });
            }}
            key={`${text.x},${text.y}`}
            value={text.value}
            maxLength={settings.tools.maxTextLength}
            placeholder={t('text_placeholder')}
            wrap="off"
            rows={text.value.split('\n').length}
            cols={Math.max(14, ...text.value.split('\n').map((line) => line.length + 2))}
            onChange={(e) => {
              if (e.target.value.split('\n').length <= maxLines) setText({ ...text, value: e.target.value });
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={() => commitText(text)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitText(text);
              }
              if (e.key === 'Escape') cancelText();
            }}
            className="absolute m-0 resize-none overflow-hidden whitespace-pre border-0 bg-transparent caret-accent outline-dashed outline-1 outline-offset-4 outline-accent/70 placeholder:text-black/25"
            style={{
              left: `${(text.x / W) * 100}%`,
              top: `${(text.y / H) * 100}%`,
              font: fontFor(textFont, look.font, settings.tools.fonts),
              lineHeight: LINE_HEIGHT,
              // Lines up the first line with the canvas, which draws from the top of the em box.
              marginTop: -textFont * ((LINE_HEIGHT - 1) / 2) - notePad,
              marginLeft: -notePad,
              padding: notePad,
              background: look.note ? NOTE_COLOR : undefined,
              color: look.color,
              transform: textAngle ? `rotate(${textAngle}deg)` : undefined,
              transformOrigin: textOrigin,
            }}
          />
        )}

        {pendingImage && (
          <ImagePlacer
            image={pendingImage}
            boardWidth={W}
            boardHeight={H}
            minSize={settings.images.minSize}
            getScale={() => 1 / (pxPerUnit * view.z)}
            onChange={props.onPendingImage}
          />
        )}

        <RemoteCursors cursors={props.cursors} width={W} height={H} zoom={view.z} />
      </div>

      {brush && (
        <div ref={cursorRef} className="pointer-events-none absolute left-0 top-0 hidden group-hover:block">
          <div
            className={cx('rounded-full border', tool === 'eraser' ? 'border-neutral-500 bg-white/60' : 'border-white/80')}
            style={{
              width: ring,
              height: ring,
              marginLeft: -ring / 2,
              marginTop: -ring / 2,
              background: tool === 'eraser' ? undefined : style.color,
              opacity: tool === 'highlighter' ? 0.6 : undefined,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
            }}
          />
        </div>
      )}

      {view.z > 1 && (
        <button
          type="button"
          title={t('zoom_hint')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setView(HOME)}
          className="absolute bottom-2 right-2 z-10 rounded-md bg-panel/90 px-2 py-1 text-xs font-medium tabular-nums text-ink shadow-panel hover:bg-hover"
        >
          {t('zoom_reset', `${Math.round(view.z * 100)}%`)}
        </button>
      )}
    </div>
  );
}
