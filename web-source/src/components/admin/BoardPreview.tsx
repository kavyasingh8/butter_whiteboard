import { useEffect, useRef, useState } from 'react';
import { BoardRenderer, asArray } from '../../board';
import { t } from '../../i18n';
import { fetchNui, type NuiMessage } from '../../nui';
import type { Settings } from '../../types';

interface BoardPreviewProps {
  boardId: number;
  /** Bumped when the board changes, to download it again. */
  revision: number;
  settings: Settings;
}

type PreviewState = 'loading' | 'ready' | 'missing';

const FETCH_DELAY = 200;
const RETRY_DELAY = 2000;

/** Read-only render of a board, downloaded from the server on demand. */
export function BoardPreview({ boardId, revision, settings }: BoardPreviewProps) {
  const { width, height, background } = settings.canvas;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderer] = useState(() => new BoardRenderer(width, height, background, settings.tools.fonts));
  const [state, setState] = useState<PreviewState>('loading');

  useEffect(() => {
    renderer.attach(canvasRef.current);
    // Text drawn before the web fonts arrive uses a fallback, so redraw once they load.
    void document.fonts.ready.then(() => renderer.rebuild());
    return () => renderer.dispose();
  }, [renderer]);

  // Bumped when the server was too busy to answer, to ask again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState('loading');
    renderer.apply({ type: 'full', ops: [], mine: [], redo: 0 });
    // Clicking quickly through the list only downloads the board that stays picked.
    const timer = setTimeout(() => fetchNui('adminPreview', { id: boardId }), attempt === 0 ? FETCH_DELAY : RETRY_DELAY);
    return () => clearTimeout(timer);
  }, [boardId, revision, attempt, renderer]);

  useEffect(() => setAttempt(0), [boardId, revision]);

  useEffect(() => {
    const onMessage = (e: MessageEvent<NuiMessage>) => {
      const msg = e.data;
      if (msg?.action !== 'adminPreview' || msg.data.id !== boardId) return;
      if (msg.data.busy) return setAttempt((n) => n + 1);
      if (msg.data.missing) return setState('missing');
      renderer.apply({ type: 'full', ops: asArray(msg.data.ops), mine: [], redo: 0, bg: msg.data.bg });
      setState('ready');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [boardId, renderer]);

  return (
    <div className="board-frame rounded-[12px] p-[6px]">
      <div className="relative overflow-hidden rounded-[7px]" style={{ aspectRatio: `${width} / ${height}` }}>
        <canvas ref={canvasRef} width={width} height={height} className="block h-full w-full" />
        {state !== 'ready' && (
          <div className="absolute inset-0 grid place-items-center bg-panel/75 text-sm text-muted">
            {state === 'loading' ? t('loading_drawing') : t('board_missing')}
          </div>
        )}
      </div>
    </div>
  );
}
