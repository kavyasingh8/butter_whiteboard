import { useCallback, useEffect, useMemo, useState } from 'react';
import { BoardRenderer, asArray } from '../board';
import { fetchNui, type NuiMessage } from '../nui';
import type { BoardMessage, ImageOp, LiveMessage, Op, OpenData, Pattern, Tool } from '../types';
import { ImageDialog, type ImageChoice } from './ImageDialog';
import type { PendingImage } from './ImagePlacer';
import { PropertyBar, type SelectionInfo, type ToolStyle } from './PropertyBar';
import type { RemoteCursor } from './RemoteCursors';
import { Stage, type LiveKind } from './Stage';
import { TOOL_GROUPS, ToolRail } from './ToolRail';
import { TopBar } from './TopBar';

// An unconfirmed op is dropped if the server never answers, e.g. when the board is full.
const LOCAL_OP_TIMEOUT = 5000;
// A cursor that stops updating is hidden, e.g. when its player walked off.
const CURSOR_TIMEOUT = 4000;
// Same for someone counted as drawing, matches the renderer dropping their stroke.
const LIVE_TIMEOUT = 10000;

const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  TOOL_GROUPS.flat().map((info) => [info.key.toLowerCase(), info.tool]),
);

function newKey() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function fitImage(choice: ImageChoice, width: number, height: number): PendingImage {
  const ratio = choice.width / choice.height || 1;
  let w = Math.min(choice.width, width * 0.4);
  let h = w / ratio;
  if (h > height * 0.5) {
    h = height * 0.5;
    w = h * ratio;
  }
  return { url: choice.url, ratio, r: 0, w: Math.round(w), h: Math.round(h), x: Math.round((width - w) / 2), y: Math.round((height - h) / 2) };
}

interface BoardState {
  mine: Set<number>;
  redo: number;
  /** Players drawing right now, with when we last heard from them. */
  live: Map<number, number>;
  pattern: Pattern;
  restorable: boolean;
}

function reduceBoard(state: BoardState, msg: BoardMessage): BoardState {
  switch (msg.type) {
    case 'full':
      return { ...state, mine: new Set(asArray(msg.mine)), redo: msg.redo ?? 0, pattern: msg.bg ?? state.pattern, restorable: msg.restorable === true };
    case 'add': {
      const live = new Map(state.live);
      live.delete(msg.src);
      if (!msg.mine || msg.op.i === undefined) return { ...state, live };
      return { ...state, live, mine: new Set(state.mine).add(msg.op.i), redo: msg.redo };
    }
    case 'remove': {
      const mine = new Set(state.mine);
      mine.delete(msg.id);
      return { ...state, mine, redo: msg.redo };
    }
    case 'clear':
      return { ...state, mine: new Set(), redo: 0, live: new Map(), restorable: msg.restorable === true };
    case 'background':
      return { ...state, pattern: msg.bg };
    case 'update':
      return state;
    case 'live': {
      if (msg.kind === 'cursor') return state;
      const live = new Map(state.live);
      if (msg.kind === 'end') live.delete(msg.src);
      else live.set(msg.src, Date.now());
      return { ...state, live };
    }
  }
}

function dropStale<T>(entries: Map<number, T>, at: (value: T) => number, cutoff: number) {
  let next: Map<number, T> | null = null;
  for (const [key, value] of entries) {
    if (at(value) >= cutoff) continue;
    next ??= new Map(entries);
    next.delete(key);
  }
  return next ?? entries;
}

type CursorMap = Record<number, RemoteCursor & { at: number }>;

function reduceCursor(cursors: CursorMap, msg: Extract<LiveMessage, { kind: 'cursor' }>): CursorMap {
  const next = { ...cursors };
  if (msg.data) next[msg.src] = { src: msg.src, name: msg.data.n, x: msg.data.p[0], y: msg.data.p[1], at: Date.now() };
  else delete next[msg.src];
  return next;
}

export function Editor({ data }: { data: OpenData }) {
  const { settings } = data;
  const [perms, setPerms] = useState({ canClear: data.canClear, canRename: data.canRename === true });
  const { canClear } = perms;
  const { canvas, tools, images } = settings;

  const renderer = useMemo(
    () => new BoardRenderer(canvas.width, canvas.height, canvas.background, tools.fonts),
    [canvas.width, canvas.height, canvas.background, tools.fonts],
  );
  const [board, setBoard] = useState<BoardState>(() => ({
    mine: new Set(),
    redo: 0,
    live: new Map(),
    pattern: asArray(canvas.patterns)[0] ?? 'plain',
    restorable: false,
  }));
  const [name, setName] = useState(data.name);
  const [cursors, setCursors] = useState<CursorMap>({});
  const [tool, setTool] = useState<Tool>('pen');
  const [style, setStyle] = useState<ToolStyle>({
    color: tools.palette[0] ?? '#111418',
    size: tools.sizes[1] ?? tools.sizes[0] ?? 6,
    highlightSize: tools.sizes[tools.sizes.length - 1] ?? 24,
    opacity: 1,
    fill: false,
    textSize: tools.textSizes[1] ?? tools.textSizes[0] ?? 36,
    font: 1,
    note: false,
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);

  const apply = useCallback(
    (msg: BoardMessage) => {
      if (msg.type === 'live' && msg.kind === 'cursor') return setCursors((c) => reduceCursor(c, msg));
      renderer.apply(msg);
      setBoard((state) => reduceBoard(state, msg));
      // Someone else may have deleted or undone what we had selected.
      setSelected((id) => (id !== null && !renderer.getOp(id) ? null : id));
    },
    [renderer],
  );

  useEffect(() => {
    if (data.board) apply(data.board);
    const onMessage = (e: MessageEvent<NuiMessage>) => {
      if (e.data?.action === 'board') apply(e.data.data);
      else if (e.data?.action === 'name' && e.data.data.id === data.boardId) setName(e.data.data.name);
      else if (e.data?.action === 'perms' && e.data.data.id === data.boardId) {
        setPerms({ canClear: e.data.data.canClear, canRename: e.data.data.canRename });
      }
    };
    const onFonts = () => renderer.rebuild();
    window.addEventListener('message', onMessage);
    document.fonts.addEventListener('loadingdone', onFonts);
    return () => {
      window.removeEventListener('message', onMessage);
      document.fonts.removeEventListener('loadingdone', onFonts);
    };
  }, [data.board, data.boardId, apply, renderer]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setCursors((current) => {
        const stale = Object.values(current).filter((c) => c.at < now - CURSOR_TIMEOUT);
        if (stale.length === 0) return current;
        const next = { ...current };
        for (const c of stale) delete next[c.src];
        return next;
      });
      setBoard((state) => {
        const live = dropStale(state.live, (at) => at, now - LIVE_TIMEOUT);
        return live === state.live ? state : { ...state, live };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const commit = useCallback(
    (op: Op) => {
      const key = newKey();
      const overlay = `l${key}`;
      renderer.setOverlay(overlay, op);
      fetchNui('addOp', { op, key });
      setTimeout(() => {
        if (renderer.getOverlay(overlay) === op) renderer.setOverlay(overlay, null);
      }, LOCAL_OP_TIMEOUT);
    },
    [renderer],
  );

  // The op stays hidden until the server confirms the edit, the new version shows as an overlay meanwhile.
  const commitEdit = useCallback(
    (id: number, op: Op) => {
      const overlay = `e${id}`;
      renderer.hide(id);
      renderer.setOverlay(overlay, op);
      fetchNui('editOp', { id, op });
      setTimeout(() => {
        if (renderer.getOverlay(overlay) !== op) return;
        renderer.setOverlay(overlay, null);
        renderer.show(id);
      }, LOCAL_OP_TIMEOUT);
    },
    [renderer],
  );

  // Hidden straight away, shown again if the server refuses.
  const deleteOp = useCallback(
    (id: number) => {
      renderer.hide(id);
      setSelected(null);
      fetchNui('deleteOp', { id });
      setTimeout(() => {
        if (renderer.getOp(id)) renderer.show(id);
      }, LOCAL_OP_TIMEOUT);
    },
    [renderer],
  );

  const sendLive = useCallback((kind: LiveKind, payload?: unknown) => fetchNui('live', { kind, data: payload }), []);

  const close = useCallback(() => fetchNui('close'), []);
  const undo = useCallback(() => fetchNui('undo'), []);
  const redo = useCallback(() => fetchNui('redo'), []);
  const canEdit = useCallback((id: number) => canClear || board.mine.has(id), [canClear, board.mine]);

  const selectTool = useCallback(
    (next: Tool) => {
      setTool(next);
      setSelected(null);
      // With images on the board the player may want to edit one instead of adding another.
      if (next === 'image' && !pendingImage && renderer.countImages() === 0) setDialogOpen(true);
    },
    [pendingImage, renderer],
  );

  const pickImage = useCallback(
    (op: ImageOp) => {
      if (op.i === undefined || !canEdit(op.i)) return;
      renderer.hide(op.i);
      setTool('image');
      setPendingImage({ url: op.m, x: op.x, y: op.y, w: op.w, h: op.h, r: op.r ?? 0, ratio: op.w / op.h || 1, editing: op.i });
    },
    [renderer, canEdit],
  );

  const cancelImage = useCallback(() => {
    if (pendingImage?.editing !== undefined) renderer.show(pendingImage.editing);
    setPendingImage(null);
  }, [pendingImage, renderer]);

  const placeImage = useCallback(() => {
    if (!pendingImage) return;
    const { url, x, y, w, h, r, editing } = pendingImage;
    const op: ImageOp = { t: 'i', m: url, x, y, w, h, r: r || undefined };
    if (editing !== undefined) commitEdit(editing, op);
    else commit(op);
    setPendingImage(null);
    if (editing === undefined) setTool('pen');
  }, [pendingImage, commit, commitEdit]);

  // Deletes the selected op, or the pinned image being edited.
  const deleteSelection = useCallback(() => {
    const editing = pendingImage?.editing;
    if (editing !== undefined) {
      setPendingImage(null);
      return deleteOp(editing);
    }
    if (selected !== null) deleteOp(selected);
  }, [pendingImage, selected, deleteOp]);

  const selectedOp = selected === null ? undefined : (renderer.getOverlay(`e${selected}`) ?? renderer.getOp(selected));
  const selection: SelectionInfo | null = selectedOp ? { color: selectedOp.t === 'i' ? undefined : selectedOp.c } : null;

  const recolor = (color: string) => {
    setStyle((s) => ({ ...s, color }));
    if (selected === null || !selectedOp || selectedOp.t === 'i' || selectedOp.c === color) return;
    commitEdit(selected, { ...selectedOp, c: color });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (dialogOpen || tag === 'INPUT' || tag === 'TEXTAREA') return;
      const key = e.key.toLowerCase();

      if (e.ctrlKey && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected !== null || pendingImage?.editing !== undefined) deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        if (pendingImage) cancelImage();
        else if (selected !== null) setSelected(null);
        else close();
        return;
      }
      if (e.key === 'Enter' && pendingImage) return placeImage();
      if (e.ctrlKey || e.altKey) return;
      const next = TOOL_KEYS[key];
      if (!next || (next === 'image' && !images.enabled)) return;
      // Keeps the key from being typed into the image dialog that this may open.
      e.preventDefault();
      selectTool(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, pendingImage, selected, images.enabled, close, undo, redo, placeImage, cancelImage, selectTool, deleteSelection]);

  const changePattern = (pattern: Pattern) => {
    if (pattern !== board.pattern) fetchNui('background', { pattern });
  };

  const rail = <ToolRail tool={tool} imagesEnabled={images.enabled} onSelect={selectTool} />;

  const topBar = (
    <TopBar
      boardId={data.boardId}
      name={name}
      nameLength={settings.nameLength ?? 32}
      liveCount={board.live.size}
      patterns={asArray(canvas.patterns)}
      pattern={board.pattern}
      canClear={canClear}
      canRename={perms.canRename}
      canUndo={board.mine.size > 0}
      canRedo={board.redo > 0}
      canRestore={board.restorable}
      onPattern={changePattern}
      onRename={(next) => fetchNui('rename', { name: next })}
      onUndo={undo}
      onRedo={redo}
      onClear={() => fetchNui('clear')}
      onRestore={() => fetchNui('restore')}
      onClose={close}
    />
  );

  const stage = (
    <>
      <Stage
        renderer={renderer}
        settings={settings}
        tool={tool}
        style={style}
        pendingImage={pendingImage}
        selected={selected}
        cursors={Object.values(cursors)}
        canEdit={canEdit}
        onSelect={setSelected}
        onEdit={commitEdit}
        onDelete={deleteOp}
        onPendingImage={setPendingImage}
        onPickImage={pickImage}
        onCommit={commit}
        onLive={sendLive}
      />
      {dialogOpen && (
        <ImageDialog
          images={images}
          remaining={images.maxPerBoard - renderer.countImages()}
          onCancel={() => {
            setDialogOpen(false);
            if (!pendingImage) setTool('pen');
          }}
          onConfirm={(choice) => {
            setDialogOpen(false);
            setPendingImage(fitImage(choice, canvas.width, canvas.height));
          }}
        />
      )}
    </>
  );

  const propertyBar = (
    <PropertyBar
      tool={tool}
      style={style}
      tools={tools}
      selection={selection}
      placingImage={pendingImage !== null}
      editingImage={pendingImage?.editing !== undefined}
      onStyle={(patch) => setStyle((s) => ({ ...s, ...patch }))}
      onRecolor={recolor}
      onDelete={deleteSelection}
      onAddImage={() => setDialogOpen(true)}
      onPlaceImage={placeImage}
      onCancelImage={() => {
        const editing = pendingImage?.editing !== undefined;
        cancelImage();
        if (!editing) setTool('pen');
      }}
    />
  );

  // Zoomed in: the camera faces the board and the canvas sits right over its surface.
  const { frame } = data;
  if (frame) {
    const left = `${frame.x * 100}vw`;
    const width = `${frame.w * 100}vw`;
    return (
      <div className="fixed inset-0 animate-fade-in">
        <div className="absolute z-20" style={{ left, width, bottom: `calc(${(1 - frame.y) * 100}vh + 10px)` }}>
          {topBar}
        </div>
        <div
          className="absolute z-20 -translate-y-1/2"
          style={{ right: `calc(${(1 - frame.x) * 100}vw + 12px)`, top: `${(frame.y + frame.h / 2) * 100}vh` }}
        >
          {rail}
        </div>
        <div className="absolute" style={{ left, width, top: `${frame.y * 100}vh`, height: `${frame.h * 100}vh` }}>
          {stage}
        </div>
        <div className="absolute z-20" style={{ left, width, top: `calc(${(frame.y + frame.h) * 100}vh + 10px)` }}>
          {propertyBar}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 grid animate-fade-in place-items-center bg-black/55">
      <div className="flex items-center gap-3">
        <div className="relative z-20">{rail}</div>
        <div
          className="flex flex-col gap-2.5"
          style={{ width: `min(calc(100vw - 150px), calc((100vh - 170px) * ${canvas.width / canvas.height}))` }}
        >
          <div className="relative z-20">{topBar}</div>
          <div className="board-frame relative rounded-[14px] p-[7px]">
            <div className="relative overflow-hidden rounded-[8px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">{stage}</div>
          </div>
          {propertyBar}
        </div>
      </div>
    </div>
  );
}
