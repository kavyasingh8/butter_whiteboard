export interface RemoteCursor {
  src: number;
  name: string;
  x: number;
  y: number;
}

interface RemoteCursorsProps {
  cursors: RemoteCursor[];
  width: number;
  height: number;
  /** Stage zoom, undone on each cursor so it keeps its size. */
  zoom: number;
}

/** A steady colour per player, so the same person always has the same pointer. */
function cursorColor(src: number) {
  return `hsl(${(src * 137.5) % 360}, 80%, 52%)`;
}

/** Where everyone else in the editor is pointing. */
export function RemoteCursors({ cursors, width, height, zoom }: RemoteCursorsProps) {
  return (
    <>
      {cursors.map((c) => {
        const color = cursorColor(c.src);
        return (
          <div
            key={c.src}
            className="pointer-events-none absolute left-0 top-0 z-10 origin-top-left transition-[left,top] duration-100 ease-linear"
            style={{ left: `${(c.x / width) * 100}%`, top: `${(c.y / height) * 100}%`, transform: `scale(${1 / zoom})` }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" className="drop-shadow" aria-hidden>
              <path d="M5 3l13 7.5-5.6 1.4L15.8 18l-2.6 1.4-3.4-6.1L5 17Z" fill={color} stroke="white" strokeWidth="1.5" />
            </svg>
            <span
              className="ml-3 block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white shadow"
              style={{ background: color }}
            >
              {c.name}
            </span>
          </div>
        );
      })}
    </>
  );
}
