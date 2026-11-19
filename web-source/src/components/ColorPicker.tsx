import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Panel, cx } from './ui';

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex({ h, s, l }: Hsl) {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const HEX = /^#[0-9a-f]{6}$/;

/** Dragging a slider only applies the colour once it rests, so recolouring a selection doesn't flood the server. */
const PICK_DELAY = 200;

interface SliderProps {
  label: string;
  value: number;
  max: number;
  track: string;
  onChange: (value: number) => void;
}

function Slider({ label, value, max, track, onChange }: SliderProps) {
  return (
    <label className="flex items-center gap-2 text-[11px] font-medium text-muted">
      <span className="w-3">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-40 cursor-pointer appearance-none rounded-full"
        style={{ background: track }}
      />
    </label>
  );
}

interface ColorPickerProps {
  color: string;
  active: boolean;
  onPick: (color: string) => void;
}

/**
 * Custom colour swatch with its own picker. FiveM's NUI can't open the browser's
 * native colour dialog, so `<input type="color">` does nothing in game.
 */
export function ColorPicker({ color, active, onPick }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hsl, setHsl] = useState(() => hexToHsl(color));
  const [hex, setHex] = useState(color);
  const rootRef = useRef<HTMLDivElement>(null);
  const pickTimer = useRef(0);
  const pending = useRef<string | null>(null);
  // The latest handler, so a delayed pick never lands on a stale selection.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  /** Applies a colour still waiting on the delay right away. */
  const flush = () => {
    window.clearTimeout(pickTimer.current);
    const value = pending.current;
    pending.current = null;
    if (value) onPickRef.current(value);
  };

  const emit = (value: string) => {
    window.clearTimeout(pickTimer.current);
    pending.current = value;
    pickTimer.current = window.setTimeout(flush, PICK_DELAY);
  };

  const close = () => {
    flush();
    setOpen(false);
  };

  // Switching tools unmounts the picker, the last colour still counts.
  useEffect(() => flush, []);

  useEffect(() => {
    if (!open) return;
    // Runs before a palette swatch's click, so picking a swatch right after wins.
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const toggle = () => {
    if (open) return close();
    setHsl(hexToHsl(color));
    setHex(color);
    setOpen(true);
  };

  const change = (patch: Partial<Hsl>) => {
    const next = { ...hsl, ...patch };
    const value = hslToHex(next);
    setHsl(next);
    setHex(value);
    emit(value);
  };

  const typeHex = (value: string) => {
    setHex(value);
    const clean = value.trim().toLowerCase();
    if (!HEX.test(clean)) return;
    setHsl(hexToHsl(clean));
    emit(clean);
  };

  const { h, s, l } = hsl;
  const preview = open ? hslToHex(hsl) : color;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title={t('custom_colour')}
        onClick={toggle}
        className={cx(
          'block h-6 w-6 rounded-full transition-transform duration-100 hover:scale-110',
          active ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : 'ring-1 ring-inset ring-white/10',
        )}
        style={{ background: active || open ? preview : 'conic-gradient(#f55, #fd5, #5d5, #5df, #55f, #f5d, #f55)' }}
      />
      {open && (
        <Panel className="absolute bottom-full left-1/2 z-30 mb-3 flex -translate-x-1/2 flex-col gap-2.5 p-3">
          <Slider
            label="H"
            value={h}
            max={360}
            track="linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
            onChange={(value) => change({ h: value })}
          />
          <Slider
            label="S"
            value={s}
            max={100}
            track={`linear-gradient(90deg, ${hslToHex({ h, s: 0, l })}, ${hslToHex({ h, s: 100, l })})`}
            onChange={(value) => change({ s: value })}
          />
          <Slider
            label="L"
            value={l}
            max={100}
            track={`linear-gradient(90deg, #000, ${hslToHex({ h, s, l: 50 })}, #fff)`}
            onChange={(value) => change({ l: value })}
          />
          <div className="flex items-center gap-2">
            <span className="h-7 w-7 shrink-0 rounded-md ring-1 ring-inset ring-white/10" style={{ background: preview }} />
            <input
              value={hex}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => typeHex(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Escape') close();
              }}
              className="h-7 w-full rounded-md bg-raised px-2 font-mono text-xs text-ink outline-none ring-1 ring-inset ring-line focus:ring-accent"
            />
          </div>
        </Panel>
      )}
    </div>
  );
}
