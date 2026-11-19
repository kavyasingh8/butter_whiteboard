import { useEffect, useState } from 'react';
import { t, type StringKey } from '../i18n';
import type { Pattern } from '../types';
import { Icon } from './Icon';
import { Divider, IconButton, Panel, cx } from './ui';

const PATTERN_LABELS: Record<Pattern, StringKey> = {
  plain: 'pattern_plain',
  grid: 'pattern_grid',
  lines: 'pattern_lines',
  dots: 'pattern_dots',
};

interface TopBarProps {
  boardId: number;
  name?: string;
  nameLength: number;
  liveCount: number;
  patterns: Pattern[];
  pattern: Pattern;
  canClear: boolean;
  canRename: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canRestore: boolean;
  onPattern: (pattern: Pattern) => void;
  onRename: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onRestore: () => void;
  onClose: () => void;
}

function ClearButton({ onClear }: { onClear: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) return <IconButton icon="trash" label={t('clear_board')} danger onClick={() => setArmed(true)} />;
  return (
    <button
      type="button"
      onClick={() => {
        setArmed(false);
        onClear();
      }}
      className="flex h-9 items-center gap-1.5 rounded-lg bg-danger px-3 text-sm font-medium text-white transition-colors hover:bg-danger/85"
    >
      <Icon name="trash" size={16} />
      {t('confirm_clear')}
    </button>
  );
}

interface BoardTitleProps {
  boardId: number;
  name?: string;
  maxLength: number;
  canRename: boolean;
  onRename: (name: string) => void;
}

function BoardTitle({ boardId, name, maxLength, canRename, onRename }: BoardTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    const save = () => {
      setDraft(null);
      if (draft.trim() !== (name ?? '')) onRename(draft.trim());
    };
    return (
      <input
        autoFocus
        value={draft}
        maxLength={maxLength}
        placeholder={t('name_placeholder')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setDraft(null);
        }}
        className="h-8 w-56 rounded-md bg-raised px-2 text-sm font-semibold text-ink outline-none ring-1 ring-accent/60 placeholder:text-muted/60"
      />
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-sm font-semibold tracking-tight text-ink">{name || t('whiteboard')}</span>
      <span className="rounded-md bg-hover px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted">#{boardId}</span>
      {canRename && (
        <button
          type="button"
          title={t('rename')}
          onClick={() => setDraft(name ?? '')}
          className="rounded-md p-1 text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <Icon name="pen" size={14} />
        </button>
      )}
    </div>
  );
}

export function TopBar(props: TopBarProps) {
  const { boardId, name, liveCount, patterns, pattern, canClear, canUndo, canRedo, canRestore } = props;

  return (
    <Panel className="flex items-center gap-3 py-1.5 pl-4 pr-1.5">
      <div className="flex min-w-0 items-center gap-3">
        <BoardTitle boardId={boardId} name={name} maxLength={props.nameLength} canRename={props.canRename} onRename={props.onRename} />
        {liveCount > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            {t('drawing', liveCount)}
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {canClear && patterns.length > 1 && (
          <>
            <div className="flex items-center rounded-lg bg-raised p-0.5">
              {patterns.map((p) => {
                const label = PATTERN_LABELS[p] ? t(PATTERN_LABELS[p]) : p;
                return (
                  <button
                    key={p}
                    type="button"
                    title={t('background', label)}
                    onClick={() => props.onPattern(p)}
                    className={cx(
                      'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-100',
                      p === pattern ? 'bg-hover text-ink' : 'text-muted hover:text-ink',
                    )}
                  >
                    <Icon name={p} size={15} />
                    {label}
                  </button>
                );
              })}
            </div>
            <Divider vertical />
          </>
        )}
        {canClear && canRestore && (
          <button
            type="button"
            onClick={props.onRestore}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent/15 px-3 text-sm font-medium text-accent transition-colors hover:bg-accent/25"
          >
            <Icon name="undo" size={16} />
            {t('undo_clear')}
          </button>
        )}
        <IconButton icon="undo" label={t('undo')} hint="Ctrl Z" disabled={!canUndo} onClick={props.onUndo} />
        <IconButton icon="redo" label={t('redo')} hint="Ctrl Y" disabled={!canRedo} onClick={props.onRedo} />
        {canClear && <ClearButton onClear={props.onClear} />}
        <Divider vertical />
        <IconButton icon="close" label={t('close')} hint="Esc" onClick={props.onClose} />
      </div>
    </Panel>
  );
}
