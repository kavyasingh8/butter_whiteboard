export type Pattern = 'plain' | 'grid' | 'lines' | 'dots';
export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse';

export interface StrokeOp {
  t: 's';
  i?: number;
  c: string;
  w: number;
  e?: boolean;
  /** Opacity below 1, unset when opaque. */
  a?: number;
  p: number[];
}

export interface ShapeOp {
  t: 'l';
  i?: number;
  k: ShapeKind;
  c: string;
  w: number;
  p: number[];
  a?: number;
  /** Filled, rectangles and ellipses only. */
  fl?: boolean;
}

export interface TextOp {
  t: 'x';
  i?: number;
  c: string;
  /** May span several lines. */
  v: string;
  /** Drawn on a sticky note. */
  n?: boolean;
  f: number;
  s: number;
  x: number;
  y: number;
  /** Clockwise rotation in degrees around the text's centre. */
  r?: number;
}

export interface ImageOp {
  t: 'i';
  i?: number;
  m: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Clockwise rotation in degrees around the image's centre. */
  r?: number;
}

export type Op = StrokeOp | ShapeOp | TextOp | ImageOp;

export interface Settings {
  canvas: { width: number; height: number; background: string; patterns: Pattern[] };
  tools: {
    minSize: number;
    maxSize: number;
    sizes: number[];
    textSizes: number[];
    maxTextLength: number;
    maxTextLines?: number;
    highlighterOpacity?: number;
    palette: string[];
    fonts: string[];
  };
  images: { enabled: boolean; maxPerBoard: number; maxUrlLength: number; minSize: number; domains: string[] };
  limits?: { pointsPerStroke: number };
  /** Max characters in a board name. */
  nameLength?: number;
}

export type LiveMessage =
  | { type: 'live'; src: number; kind: 'start'; data: { c: string; w: number; e?: boolean; a?: number; p: number[] } }
  | { type: 'live'; src: number; kind: 'move'; data: number[] }
  | { type: 'live'; src: number; kind: 'shape'; data: ShapeOp }
  | { type: 'live'; src: number; kind: 'end' }
  /** Another player's pointer in the editor, false when they left. */
  | { type: 'live'; src: number; kind: 'cursor'; data: { p: [number, number]; n: string } | false };

export type BoardMessage =
  | { type: 'full'; ops: Op[]; mine: number[]; redo: number; bg?: Pattern; restorable?: boolean }
  | { type: 'add'; op: Op; src: number; mine: boolean; clientKey?: string; redo: number }
  | { type: 'remove'; id: number; redo: number }
  | { type: 'update'; op: Op }
  | { type: 'clear'; restorable?: boolean }
  | { type: 'background'; bg: Pattern }
  | LiveMessage;

/** Where the board's surface sits on screen when the camera is zoomed in, as fractions of the viewport. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Locale = Record<string, string> | unknown[];

export interface OpenData {
  boardId: number;
  name?: string;
  frame?: Frame | null;
  settings: Settings;
  locale?: Locale;
  me: number;
  canClear: boolean;
  canRename?: boolean;
  board: Extract<BoardMessage, { type: 'full' }> | null;
}

export interface AdminBoard {
  id: number;
  name?: string;
  owner: string;
  ownerName: string;
  model: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Free panels only, in metres. */
  width?: number;
  /** Routing bucket it was placed in, only players in it can see it. */
  bucket: number;
  ops: number;
  points: number;
  /** Unix seconds of the last change. */
  updated?: number;
  /** Street and zone, filled in by the client. */
  area?: string;
}

export interface AdminView {
  boards: AdminBoard[] | Record<string, never>;
  /** Server clock, unix seconds. */
  now: number;
  limits: { ops: number; points: number };
}

export interface AdminOpen {
  settings: Settings & { models: Record<string, string> };
  view: AdminView;
  locale?: Locale;
}

export interface AdminResult {
  ok: boolean;
  view: AdminView | false;
}

export interface AdminPreviewData {
  id: number;
  ops: Op[] | Record<string, never>;
  bg?: Pattern;
  missing: boolean;
  /** The server is rate limiting previews, ask again in a moment. */
  busy?: boolean;
}

export type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | ShapeKind | 'text' | 'image';
