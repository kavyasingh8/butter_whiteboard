import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { PRINT_COLOR } from '../draw';
import { t } from '../i18n';

export interface PendingImage {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ratio: number;
  /** Clockwise rotation in degrees. */
  r: number;
  /** Id of the pinned image being edited, unset for a new one. */
  editing?: number;
}

interface ImagePlacerProps {
  image: PendingImage;
  boardWidth: number;
  boardHeight: number;
  minSize: number;
  /** Board units per screen pixel. */
  getScale: () => number;
  onChange: (image: PendingImage) => void;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Handle = Corner | 'move' | 'rotate';
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const cornerClass: Record<Corner, string> = {
  nw: '-left-1.5 -top-1.5 cursor-nwse-resize',
  ne: '-right-1.5 -top-1.5 cursor-nesw-resize',
  sw: '-bottom-1.5 -left-1.5 cursor-nesw-resize',
  se: '-bottom-1.5 -right-1.5 cursor-nwse-resize',
};
const ROTATE_SNAP = 15;

interface Drag {
  handle: Handle;
  startX: number;
  startY: number;
  /** Screen centre of the image, for rotating. */
  centerX: number;
  centerY: number;
  origin: PendingImage;
}

function rotate(x: number, y: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

function normalizeAngle(deg: number) {
  const r = Math.round(deg) % 360;
  return r > 180 ? r - 360 : r <= -180 ? r + 360 : r;
}

/** Floating image the player positions before it is pinned to the board. */
export function ImagePlacer({ image, boardWidth, boardHeight, minSize, getScale, onChange }: ImagePlacerProps) {
  const drag = useRef<Drag | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const begin = (e: ReactPointerEvent, handle: Handle) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // The bounding box of a rotated element still shares its centre.
    const rect = boxRef.current?.getBoundingClientRect();
    drag.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      centerX: rect ? rect.left + rect.width / 2 : e.clientX,
      centerY: rect ? rect.top + rect.height / 2 : e.clientY,
      origin: image,
    };
  };

  const resize = (d: Drag, corner: Corner, dx: number, dy: number, free: boolean) => {
    const o = d.origin;
    // Work in the image's own axes so corners follow the pointer when it is tilted.
    const [lx, ly] = rotate(dx, dy, -o.r);
    const west = corner.includes('w');
    const north = corner.includes('n');
    let w = Math.max(minSize, o.w + (west ? -lx : lx));
    let h = Math.max(minSize, o.h + (north ? -ly : ly));
    if (!free) {
      // Keep the picture's proportions, following whichever axis moved further.
      if (w / o.w > h / o.h) h = w / o.ratio;
      else w = h * o.ratio;
    }
    w = Math.min(w, boardWidth);
    h = Math.min(h, boardHeight);

    // The opposite corner stays where it is.
    const sx = west ? 1 : -1;
    const sy = north ? 1 : -1;
    const [fx, fy] = rotate((sx * o.w) / 2, (sy * o.h) / 2, o.r);
    const [nx, ny] = rotate((sx * w) / 2, (sy * h) / 2, o.r);
    const cx = o.x + o.w / 2 + fx - nx;
    const cy = o.y + o.h / 2 + fy - ny;
    return { ...o, w: Math.round(w), h: Math.round(h), x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) };
  };

  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const o = d.origin;

    if (d.handle === 'rotate') {
      let r = (Math.atan2(e.clientY - d.centerY, e.clientX - d.centerX) * 180) / Math.PI + 90;
      if (e.shiftKey) r = Math.round(r / ROTATE_SNAP) * ROTATE_SNAP;
      onChange({ ...o, r: normalizeAngle(r) });
      return;
    }

    const scale = getScale();
    const dx = (e.clientX - d.startX) * scale;
    const dy = (e.clientY - d.startY) * scale;
    if (d.handle === 'move') {
      onChange({ ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
      return;
    }
    onChange(resize(d, d.handle, dx, dy, e.shiftKey));
  };

  const end = () => {
    drag.current = null;
  };

  return (
    <div
      ref={boxRef}
      className="absolute z-10 cursor-move touch-none select-none"
      style={{
        left: `${(image.x / boardWidth) * 100}%`,
        top: `${(image.y / boardHeight) * 100}%`,
        width: `${(image.w / boardWidth) * 100}%`,
        height: `${(image.h / boardHeight) * 100}%`,
        transform: image.r ? `rotate(${image.r}deg)` : undefined,
      }}
      onPointerDown={(e) => begin(e, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="h-full w-full shadow-[0_6px_18px_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.25)]"
        style={{ background: PRINT_COLOR, padding: `${(Math.min(8, Math.min(image.w, image.h) * 0.04) / image.w) * 100}%` }}
      >
        <img src={image.url} alt="" draggable={false} referrerPolicy="no-referrer" className="h-full w-full" />
      </div>
      <div className="pointer-events-none absolute -inset-px rounded-sm outline outline-2 outline-accent" />
      <div className="pointer-events-none absolute -top-6 left-1/2 h-6 w-0.5 -translate-x-1/2 bg-accent" />
      <span
        title={t('rotate_hint')}
        onPointerDown={(e) => begin(e, 'rotate')}
        className="absolute -top-8 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border-2 border-accent bg-white"
      />
      {CORNERS.map((corner) => (
        <span
          key={corner}
          onPointerDown={(e) => begin(e, corner)}
          className={`absolute h-3 w-3 rounded-sm border-2 border-accent bg-white ${cornerClass[corner]}`}
        />
      ))}
    </div>
  );
}
