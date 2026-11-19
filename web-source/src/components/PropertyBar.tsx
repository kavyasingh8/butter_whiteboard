import { t } from '../i18n';
import type { Settings, Tool } from '../types';
import { ColorPicker } from './ColorPicker';
import { Icon } from './Icon';
import { Button, Chip, Divider, Panel, cx } from './ui';

export interface ToolStyle {
  color: string;
  size: number;
  highlightSize: number;
  /** Marker and shape opacity, 0.1 to 1. */
  opacity: number;
  fill: boolean;
  textSize: number;
  font: number;
  note: boolean;
}

/** What the select tool currently holds, if anything. */
export interface SelectionInfo {
  color?: string;
}

interface PropertyBarProps {
  tool: Tool;
  style: ToolStyle;
  tools: Settings['tools'];
  selection: SelectionInfo | null;
  placingImage: boolean;
  editingImage: boolean;
  onStyle: (patch: Partial<ToolStyle>) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
  onAddImage: () => void;
  onPlaceImage: () => void;
  onCancelImage: () => void;
}

function Swatches({ palette, color, onPick }: { palette: string[]; color: string; onPick: (c: string) => void }) {
  const custom = !palette.includes(color);
  return (
    <div className="flex items-center gap-1.5">
      {palette.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onPick(c)}
          className={cx(
            'h-6 w-6 rounded-full transition-transform duration-100 hover:scale-110',
            c === color ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : 'ring-1 ring-inset ring-white/10',
          )}
          style={{ background: c }}
        />
      ))}
      <ColorPicker color={color} active={custom} onPick={onPick} />
    </div>
  );
}

interface SizePickerProps {
  sizes: number[];
  size: number;
  color: string;
  min: number;
  max: number;
  onPick: (s: number) => void;
}

function SizePicker({ sizes, size, color, min, max, onPick }: SizePickerProps) {
  return (
    <div className="flex items-center gap-1">
      {sizes.map((s) => (
        <Chip key={s} active={s === size} title={`${s}px`} onClick={() => onPick(s)}>
          <span
            className="rounded-full"
            style={{
              width: Math.min(18, 3 + s * 0.6),
              height: Math.min(18, 3 + s * 0.6),
              background: color,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.25)',
            }}
          />
        </Chip>
      ))}
      <input
        type="range"
        min={min}
        max={max}
        value={size}
        onChange={(e) => onPick(Number(e.target.value))}
        className="ml-2 w-20 accent-accent"
      />
      <span className="w-9 text-right text-xs tabular-nums text-muted">{size}px</span>
    </div>
  );
}

function OpacityPicker({ opacity, onPick }: { opacity: number; onPick: (o: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted" title={t('opacity')}>
      <span className="h-3.5 w-3.5 rounded-full bg-ink" style={{ opacity }} />
      <input
        type="range"
        min={10}
        max={100}
        step={5}
        value={Math.round(opacity * 100)}
        onChange={(e) => onPick(Number(e.target.value) / 100)}
        className="w-16 accent-accent"
      />
      <span className="w-8 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
    </label>
  );
}

function Toggle({ active, icon, label, onClick }: { active: boolean; icon: 'fill' | 'note'; label: string; onClick: () => void }) {
  return (
    <Chip active={active} title={label} onClick={onClick} className="gap-1.5 px-2.5">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <Icon name={icon} size={15} />
        {label}
      </span>
    </Chip>
  );
}

function TextOptions({ tools, style, onStyle }: Pick<PropertyBarProps, 'tools' | 'style' | 'onStyle'>) {
  return (
    <>
      <div className="flex items-center gap-1">
        {tools.fonts.map((font, i) => (
          <Chip key={font} active={style.font === i + 1} title={font} onClick={() => onStyle({ font: i + 1 })} className="px-3">
            <span style={{ fontFamily: `"${font}"`, fontWeight: 600 }}>{font.split(' ')[0]}</span>
          </Chip>
        ))}
      </div>
      <Divider vertical />
      <div className="flex items-center gap-1">
        {tools.textSizes.map((s) => (
          <Chip key={s} active={style.textSize === s} title={`${s}px`} onClick={() => onStyle({ textSize: s })}>
            <span className="text-xs font-semibold tabular-nums">{s}</span>
          </Chip>
        ))}
      </div>
      <Divider vertical />
      <Toggle active={style.note} icon="note" label={t('note')} onClick={() => onStyle({ note: !style.note })} />
    </>
  );
}

interface ImageOptionsProps {
  placing: boolean;
  editing: boolean;
  onAdd: () => void;
  onPlace: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function ImageOptions({ placing, editing, onAdd, onPlace, onCancel, onDelete }: ImageOptionsProps) {
  if (!placing) {
    return (
      <>
        <span className="text-sm text-muted">{t('image_hint')}</span>
        <div className="ml-auto">
          <Button variant="primary" onClick={onAdd}>
            <Icon name="link" size={16} />
            {t('add_image')}
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <span className="text-sm text-muted">{t('image_edit_hint')}</span>
      <div className="ml-auto flex items-center gap-1">
        {editing && (
          <Button variant="danger" onClick={onDelete}>
            <Icon name="trash" size={16} />
            {t('delete')}
          </Button>
        )}
        <Button onClick={onCancel}>{t('cancel')}</Button>
        <Button variant="primary" onClick={onPlace}>
          <Icon name="check" size={16} />
          {editing ? t('save') : t('pin_to_board')}
        </Button>
      </div>
    </>
  );
}

function SelectOptions({ selection, palette, onRecolor, onDelete }: {
  selection: SelectionInfo | null;
  palette: string[];
  onRecolor: (color: string) => void;
  onDelete: () => void;
}) {
  if (!selection) return <span className="text-sm text-muted">{t('select_hint')}</span>;
  return (
    <>
      {selection.color && (
        <>
          <Swatches palette={palette} color={selection.color} onPick={onRecolor} />
          <Divider vertical />
        </>
      )}
      <span className="truncate text-sm text-muted">{t('selected_hint')}</span>
      <div className="ml-auto">
        <Button variant="danger" onClick={onDelete}>
          <Icon name="trash" size={16} />
          {t('delete')}
        </Button>
      </div>
    </>
  );
}

const SHAPE_TOOLS: Tool[] = ['line', 'arrow', 'rect', 'ellipse'];

export function PropertyBar(props: PropertyBarProps) {
  const { tool, style, tools, onStyle } = props;

  if (tool === 'image') {
    return (
      <Panel className="flex h-[52px] items-center gap-3 px-4">
        <ImageOptions
          placing={props.placingImage}
          editing={props.editingImage}
          onAdd={props.onAddImage}
          onPlace={props.onPlaceImage}
          onCancel={props.onCancelImage}
          onDelete={props.onDelete}
        />
      </Panel>
    );
  }

  if (tool === 'select') {
    return (
      <Panel className="flex h-[52px] items-center gap-3 px-3">
        <SelectOptions selection={props.selection} palette={tools.palette} onRecolor={props.onRecolor} onDelete={props.onDelete} />
      </Panel>
    );
  }

  const showColor = tool !== 'eraser';
  const highlighter = tool === 'highlighter';
  const showOpacity = tool === 'pen' || SHAPE_TOOLS.includes(tool);
  const canFill = tool === 'rect' || tool === 'ellipse';
  return (
    <Panel className="flex h-[52px] items-center gap-3 px-3">
      {showColor && <Swatches palette={tools.palette} color={style.color} onPick={(color) => onStyle({ color })} />}
      {showColor && <Divider vertical />}
      {tool === 'text' ? (
        <TextOptions tools={tools} style={style} onStyle={onStyle} />
      ) : (
        <SizePicker
          sizes={tools.sizes}
          size={highlighter ? style.highlightSize : style.size}
          color={tool === 'eraser' ? '#c4c9d2' : style.color}
          min={tools.minSize}
          max={tools.maxSize}
          onPick={(size) => onStyle(highlighter ? { highlightSize: size } : { size })}
        />
      )}
      {showOpacity && (
        <>
          <Divider vertical />
          <OpacityPicker opacity={style.opacity} onPick={(opacity) => onStyle({ opacity })} />
        </>
      )}
      {canFill && <Toggle active={style.fill} icon="fill" label={t('fill')} onClick={() => onStyle({ fill: !style.fill })} />}
    </Panel>
  );
}
