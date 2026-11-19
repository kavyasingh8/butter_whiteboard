import { BoardRenderer } from './board';
import type { BoardMessage, Settings } from './types';

type DuiMessage = { type: 'settings'; settings: Settings } | BoardMessage;

const canvas = document.getElementById('board') as HTMLCanvasElement;
canvas.width = window.innerWidth || 1024;
canvas.height = window.innerHeight || 576;

let board: BoardRenderer | null = null;
let lastSettings = '';

window.addEventListener('message', (event: MessageEvent<string | DuiMessage>) => {
  const raw = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
  const msg: DuiMessage | null = JSON.parse(raw);
  if (!msg) return;
  if (msg.type === 'settings') {
    // The game resends settings while the page warms up. Rebuilding for the same
    // ones would drop live strokes that arrived in between.
    if (board && raw === lastSettings) return;
    lastSettings = raw;
    const { canvas: c, tools } = msg.settings;
    board?.dispose();
    board = new BoardRenderer(c.width, c.height, c.background, tools.fonts);
    board.attach(canvas);
    return;
  }
  board?.apply(msg);
});

document.fonts.addEventListener('loadingdone', () => board?.rebuild());
