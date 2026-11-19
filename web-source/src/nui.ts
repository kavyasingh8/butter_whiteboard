import type { AdminOpen, AdminPreviewData, BoardMessage, OpenData } from './types';

export const isBrowser = !window.GetParentResourceName;
const resource = window.GetParentResourceName?.() ?? 'butter_whiteboard';

export type NuiMessage =
  | { action: 'open'; data: OpenData }
  | { action: 'admin'; data: AdminOpen }
  | { action: 'adminPreview'; data: AdminPreviewData }
  | { action: 'name'; data: { id: number; name?: string } }
  | { action: 'perms'; data: { id: number; canClear: boolean; canRename: boolean } }
  | { action: 'close' }
  | { action: 'board'; data: BoardMessage };

type BrowserHandler = (event: string, data: unknown) => unknown;
let browserHandler: BrowserHandler | null = null;

/** Routes NUI callbacks to the dev mock when running outside the game. */
export function setBrowserHandler(handler: BrowserHandler) {
  browserHandler = handler;
}

/** Fire and forget NUI callback. */
export function fetchNui(event: string, data: unknown = {}) {
  void requestNui(event, data).catch(() => {});
}

/** NUI callback whose answer is needed, resolves to null if it fails. */
export async function requestNui<T>(event: string, data: unknown = {}): Promise<T | null> {
  if (isBrowser) return ((await browserHandler?.(event, data)) ?? null) as T | null;
  const res = await fetch(`https://${resource}/${event}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(data),
  });
  return (await res.json()) as T;
}

export function emitNui(message: NuiMessage) {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
}
