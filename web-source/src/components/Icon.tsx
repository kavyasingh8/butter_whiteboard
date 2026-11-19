// Inline stroke icons, so the UI has no icon font or CDN dependency.
const paths = {
  select: 'M5 3l13 7.5-5.6 1.4L15.8 18l-2.6 1.4-3.4-6.1L5 17Z',
  highlighter: 'M9 11l-5 5v4h4l5-5M9 11l6-6a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8l-6 6M9 11l4 4M14 21h6',
  fill: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM4 14 14 4M4 20 20 4M10 20 20 10',
  note: 'M5 4h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM20 14h-5a1 1 0 0 0-1 1v5',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  eraser: 'M7 21h10M5.6 15.6l7.8-7.8a2 2 0 0 1 2.8 0l2.8 2.8a2 2 0 0 1 0 2.8L13 19.4a2 2 0 0 1-1.4.6H9.4a2 2 0 0 1-1.4-.6l-2.4-2.4a1.2 1.2 0 0 1 0-1.4ZM9 12l6 6',
  line: 'M5 19 19 5',
  arrow: 'M5 19 19 5M9 5h10v10',
  rect: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z',
  ellipse: 'M12 4c5 0 9 3.6 9 8s-4 8-9 8-9-3.6-9-8 4-8 9-8Z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  image: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM4 16l4.6-4.6a1.5 1.5 0 0 1 2 0L16 17M14 14l1.6-1.6a1.5 1.5 0 0 1 2 0L20 15M15 9h.01',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'M5 12.5 10 17l9-10',
  plain: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
  grid: 'M4 4h16v16H4ZM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16',
  lines: 'M4 4h16v16H4ZM4 9h16M4 14h16M8 4v16',
  dots: 'M4 4h16v16H4ZM8.5 8.5h.01M15.5 8.5h.01M8.5 15.5h.01M15.5 15.5h.01M12 12h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 5.2a3 3 0 0 1 0 5.6',
  refresh: 'M20 11a8 8 0 0 0-14.8-4M4 4v4h4M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  teleport: 'M13 4h6v6M19 4l-8 8M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4',
  board: 'M4 5h16v11H4ZM12 16v4M8 20h8',
} as const;

export type IconName = keyof typeof paths;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  );
}
