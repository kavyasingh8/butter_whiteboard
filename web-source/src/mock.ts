// Dev-only stand-in for the game client and server, used by `npm run dev`.
import { emitNui, setBrowserHandler } from './nui';
import type { AdminView, Op, Pattern, Settings } from './types';

const ME = 1;
const FRIEND = 2;

const settings: Settings = {
  canvas: { width: 1280, height: 720, background: '#f6f7f4', patterns: ['plain', 'grid', 'lines', 'dots'] },
  tools: {
    minSize: 2,
    maxSize: 48,
    sizes: [3, 6, 12, 24],
    textSizes: [24, 36, 56, 84],
    maxTextLength: 120,
    maxTextLines: 6,
    highlighterOpacity: 0.35,
    palette: ['#111418', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599', '#e64980', '#795548', '#868e96'],
    fonts: ['Inter', 'Permanent Marker', 'Caveat'],
  },
  images: {
    enabled: true,
    maxPerBoard: 12,
    maxUrlLength: 400,
    minSize: 32,
    domains: ['i.imgur.com', 'cdn.discordapp.com', 'media.discordapp.net', 'r2.fivemanage.com', 'i.ibb.co', 'picsum.photos'],
  },
};

const sampleImage =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f7cff"/><stop offset="1" stop-color="#8d5bff"/></linearGradient></defs><rect width="400" height="260" fill="url(#g)"/><circle cx="300" cy="80" r="40" fill="#ffd166"/><path d="M0 260 L120 130 L210 210 L280 150 L400 260Z" fill="#1b2a4a" opacity=".75"/></svg>',
  );

let seq = 0;
let ops: Op[] = [];
let pattern: Pattern = 'lines';
let boardName: string | undefined = 'Heist planning';
let lastClear: Op[] = [];
const mine = new Set<number>();
const redo: Op[] = [];

function add(op: Op, src: number, clientKey?: string) {
  const stored = { ...op, i: ++seq } as Op;
  ops.push(stored);
  if (src === ME) mine.add(seq);
  emitNui({ action: 'board', data: { type: 'add', op: stored, src, mine: src === ME, clientKey, redo: redo.length } });
}

function seed() {
  const seeds: Op[] = [
    { t: 'x', c: '#111418', v: 'Heist plan', f: 2, s: 56, x: 130, y: 40 },
    { t: 'i', m: sampleImage, x: 820, y: 70, w: 360, h: 234 },
    { t: 'l', k: 'rect', c: '#1971c2', w: 6, p: [130, 160, 470, 300] },
    { t: 'x', c: '#1971c2', v: 'Vault entrance', f: 3, s: 36, x: 160, y: 205 },
    { t: 'l', k: 'arrow', c: '#e03131', w: 6, p: [480, 230, 800, 190] },
    { t: 'l', k: 'ellipse', c: '#2f9e44', w: 5, p: [150, 380, 450, 520] },
    { t: 'x', c: '#2f9e44', v: 'Getaway car', f: 3, s: 36, x: 220, y: 432 },
    { t: 'x', c: '#111418', v: 'Meet at 22:00\nBring the van', f: 3, s: 24, n: true, x: 560, y: 380 },
    { t: 's', c: '#f08c00', w: 24, a: 0.35, p: [150, 110, 300, 110, 450, 112] },
  ];
  for (const op of seeds) ops.push({ ...op, i: ++seq } as Op);
}

/** The fake second player's pointer wanders over the board. */
function friendCursor() {
  let step = 0;
  setInterval(() => {
    step += 1;
    const x = 640 + Math.cos(step / 12) * 380;
    const y = 360 + Math.sin(step / 7) * 220;
    emitNui({ action: 'board', data: { type: 'live', src: FRIEND, kind: 'cursor', data: { p: [Math.round(x), Math.round(y)], n: 'Dean Hollis' } } });
  }, 150);
}

function friendScribble() {
  const y = 560 + Math.random() * 80;
  const points: number[] = [];
  for (let x = 560; x <= 1100; x += 12) points.push(x, Math.round(y + Math.sin(x / 30) * 18));
  let sent = 6;
  emitNui({ action: 'board', data: { type: 'live', src: FRIEND, kind: 'start', data: { c: '#9c36b5', w: 6, p: points.slice(0, sent) } } });
  const timer = setInterval(() => {
    if (sent >= points.length) {
      clearInterval(timer);
      emitNui({ action: 'board', data: { type: 'live', src: FRIEND, kind: 'end' } });
      add({ t: 's', c: '#9c36b5', w: 6, p: points }, FRIEND);
      return;
    }
    emitNui({ action: 'board', data: { type: 'live', src: FRIEND, kind: 'move', data: points.slice(sent, sent + 6) } });
    sent += 6;
  }, 50);
}

type Payload = { op?: Op; key?: string; pattern?: Pattern; id?: number; name?: string };

const params = new URLSearchParams(window.location.search);

function adminView(): AdminView {
  const now = Math.floor(Date.now() / 1000);
  const board = (id: number, ownerName: string, area: string, model: string, count: number, age: number) => ({
    id, owner: `CID${1000 + id}`, ownerName, model, x: 215.4 + id, y: -810.2, z: 30.7, heading: 160, bucket: 0, ops: count, points: count * 40, updated: now - age, area,
  });
  return {
    now,
    limits: { ops: 2000, points: 120000 },
    boards: [
      { ...board(12, 'Mia Vargas', 'Vespucci Blvd, Little Seoul', 'butter_whiteboard_wall', ops.length, 140), name: boardName },
      board(14, 'Dean Hollis', 'Alta St, Pillbox Hill', 'butter_whiteboard_stand', 0, 7200),
      { ...board(19, 'Ana Ruiz', 'Sinner St, Mission Row', 'panel', 3, 90000), width: 2.4, bucket: 3 },
    ],
  };
}

export function startMock() {
  seed();
  setBrowserHandler((event, raw) => {
    const data = raw as Payload;
    switch (event) {
      case 'addOp':
        if (data.op) setTimeout(() => add(data.op as Op, ME, data.key), 60);
        redo.length = 0;
        return;
      case 'editOp': {
        const index = ops.findIndex((op) => op.i === data.id);
        if (index === -1 || !data.op) return;
        const op = { ...data.op, i: data.id } as Op;
        ops[index] = op;
        setTimeout(() => emitNui({ action: 'board', data: { type: 'update', op } }), 60);
        return;
      }
      case 'deleteOp': {
        const index = ops.findIndex((op) => op.i === data.id);
        if (index === -1) return;
        ops.splice(index, 1);
        mine.delete(data.id as number);
        setTimeout(() => emitNui({ action: 'board', data: { type: 'remove', id: data.id as number, redo: redo.length } }), 60);
        return;
      }
      case 'restore':
        ops = [...lastClear, ...ops];
        lastClear = [];
        emitNui({ action: 'board', data: { type: 'full', ops, mine: [...mine], redo: redo.length, bg: pattern, restorable: false } });
        return;
      case 'rename':
        boardName = data.name || undefined;
        emitNui({ action: 'name', data: { id: 12, name: boardName } });
        return true;
      case 'undo': {
        let index = ops.length - 1;
        while (index >= 0 && !mine.has(ops[index].i ?? -1)) index--;
        if (index === -1) return;
        const [op] = ops.splice(index, 1);
        mine.delete(op.i as number);
        redo.push(op);
        emitNui({ action: 'board', data: { type: 'remove', id: op.i as number, redo: redo.length } });
        return;
      }
      case 'redo': {
        const op = redo.pop();
        if (op) add(op, ME);
        return;
      }
      case 'clear':
        lastClear = ops;
        ops = [];
        mine.clear();
        redo.length = 0;
        emitNui({ action: 'board', data: { type: 'clear', restorable: lastClear.length > 0 } });
        return;
      case 'background':
        if (data.pattern) pattern = data.pattern;
        emitNui({ action: 'board', data: { type: 'background', bg: pattern } });
        return;
      case 'close':
        setTimeout(open, 1200);
        return;
      case 'adminRefresh':
        return adminView();
      case 'adminRename':
        if (data.id === 12) boardName = data.name || undefined;
        return { ok: true, view: adminView() };
      case 'adminClear':
      case 'adminRemove':
        return { ok: true, view: adminView() };
      case 'adminPreview':
        setTimeout(() => {
          const known = data.id === 12;
          emitNui({ action: 'adminPreview', data: { id: data.id ?? 0, ops: known ? ops : [], bg: pattern, missing: false } });
        }, 150);
        return;
      case 'adminClose':
      case 'adminPlace':
        setTimeout(openAdmin, 1200);
    }
  });

  const open = () =>
    emitNui({
      action: 'open',
      data: {
        boardId: 12,
        name: boardName,
        canRename: true,
        // ?zoom previews the layout used when the camera zooms onto the prop.
        frame: params.has('zoom') ? { x: 0.19, y: 0.15, w: 0.62, h: 0.62 * (window.innerWidth / window.innerHeight) * (720 / 1280) } : null,
        settings,
        me: ME,
        canClear: true,
        board: { type: 'full', ops, mine: [...mine], redo: redo.length, bg: pattern },
      },
    });

  const openAdmin = () =>
    emitNui({
      action: 'admin',
      data: {
        settings: { ...settings, models: { butter_whiteboard_wall: 'Wall whiteboard', butter_whiteboard_stand: 'Standing whiteboard', panel: 'Free panel' } },
        view: adminView(),
      },
    });

  setTimeout(params.has('admin') ? openAdmin : open, 200);
  setInterval(friendScribble, 9000);
  friendCursor();
}
