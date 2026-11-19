import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { asArray } from '../../board';
import { t } from '../../i18n';
import { fetchNui, requestNui } from '../../nui';
import type { AdminBoard, AdminOpen, AdminResult, AdminView } from '../../types';
import { Icon, type IconName } from '../Icon';
import { IconButton, Panel, cx } from '../ui';
import { BoardPreview } from './BoardPreview';

const ARM_MS = 3000;

type MaybeView = AdminView | false | null | undefined;

function ago(seconds: number): string {
  if (seconds < 60) return t('just_now');
  const m = Math.floor(seconds / 60);
  if (m < 60) return t('minutes_ago', m);
  const h = Math.floor(m / 60);
  if (h < 24) return t('hours_ago', h);
  const d = Math.floor(h / 24);
  return d === 1 ? t('yesterday') : t('days_ago', d);
}

interface NameFieldProps {
  name?: string;
  maxLength: number;
  disabled: boolean;
  onSave: (name: string) => void;
}

/** Board name in the detail view, click the pencil to change it. */
function NameField({ name, maxLength, disabled, onSave }: NameFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h2 className={cx('truncate text-lg font-semibold', !name && 'text-muted')}>{name || t('unnamed')}</h2>
        <button
          type="button"
          title={t('rename')}
          disabled={disabled}
          onClick={() => setDraft(name ?? '')}
          className="rounded-md p-1 text-muted transition-colors enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-40"
        >
          <Icon name="pen" size={15} />
        </button>
      </div>
    );
  }

  const save = () => {
    setDraft(null);
    if (draft.trim() !== (name ?? '')) onSave(draft.trim());
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
      className="h-9 w-72 rounded-lg bg-raised px-3 text-base font-semibold text-ink outline-none ring-1 ring-accent/60 placeholder:text-muted/60"
    />
  );
}

interface ActionButtonProps {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

function ActionButton({ icon, label, disabled, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-raised px-3 text-sm font-medium text-ink transition-colors enabled:hover:bg-hover disabled:opacity-40"
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}

interface ConfirmButtonProps {
  icon: IconName;
  label: string;
  confirm: string;
  disabled?: boolean;
  onConfirm: () => void;
}

/** Needs a second click within a few seconds. */
function ConfirmButton({ icon, label, confirm, disabled, onConfirm }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      className={cx(
        'flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors disabled:opacity-40',
        armed ? 'bg-danger text-white' : 'bg-danger/10 text-danger enabled:hover:bg-danger/20',
      )}
    >
      <Icon name={armed ? 'check' : icon} size={16} />
      {armed ? confirm : label}
    </button>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-raised px-3 py-2.5">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate text-sm font-semibold text-ink">{children}</div>
    </div>
  );
}

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  const ratio = Math.min(1, used / Math.max(1, max));
  const tone = ratio > 0.9 ? 'bg-danger' : ratio > 0.7 ? 'bg-amber-400' : 'bg-accent';
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-ink">
          {used.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-hover">
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

interface AdminPanelProps {
  data: AdminOpen;
  onClose: () => void;
}

export function AdminPanel({ data, onClose }: AdminPanelProps) {
  const { settings } = data;
  const [view, setView] = useState<AdminView>(data.view);
  const [clockOffset, setClockOffset] = useState(() => data.view.now - Date.now() / 1000);
  const [search, setSearch] = useState('');
  const [model, setModel] = useState('all');
  const [selected, setSelected] = useState<number | undefined>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);

  const boards = asArray<AdminBoard>(view.boards);
  const now = Date.now() / 1000 + clockOffset;

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return boards.filter((b) => {
      if (model !== 'all' && b.model !== model) return false;
      if (!q) return true;
      return [`#${b.id}`, b.name ?? '', b.ownerName, b.owner, b.area ?? '', settings.models[b.model] ?? b.model].some((s) =>
        s.toLowerCase().includes(q),
      );
    });
  }, [boards, search, model, settings.models]);

  const current = list.find((b) => b.id === selected) ?? list[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onClose();
      fetchNui('adminClose');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (request: () => Promise<MaybeView>) => {
    setBusy(true);
    try {
      const fresh = await request();
      if (fresh) {
        setView(fresh);
        setClockOffset(fresh.now - Date.now() / 1000);
      }
      setRevision((r) => r + 1);
    } finally {
      setBusy(false);
    }
  };

  const boardAction = (event: string, id: number, extra?: Record<string, unknown>) =>
    run(async () => (await requestNui<AdminResult>(event, { id, ...extra }))?.view);
  const totalOps = boards.reduce((n, b) => n + b.ops, 0);

  return (
    <div className="fixed inset-0 grid animate-fade-in place-items-center bg-black/55 p-8">
      <Panel className="flex h-full max-h-[820px] w-full max-w-[1240px] flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <div className="mr-1 grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
            <Icon name="board" />
          </div>
          <div className="mr-auto">
            <h1 className="text-[15px] font-semibold leading-tight">{t('admin_title')}</h1>
            <p className="text-xs text-muted">
              {t('admin_count', boards.length, totalOps.toLocaleString())}
            </p>
          </div>
          <IconButton
            icon="refresh"
            label={t('refresh')}
            disabled={busy}
            onClick={() => run(() => requestNui<AdminView | false>('adminRefresh'))}
          />
          <button
            type="button"
            onClick={() => {
              onClose();
              fetchNui('adminPlace');
            }}
            className="flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent/85"
          >
            <Icon name="plus" size={16} />
            {t('place_board')}
          </button>
          <IconButton
            icon="close"
            label={t('close')}
            hint="Esc"
            onClick={() => {
              onClose();
              fetchNui('adminClose');
            }}
          />
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr]">
          <aside className="flex min-h-0 flex-col border-r border-line">
            <div className="flex flex-col gap-2 border-b border-line p-3">
              <label className="flex h-9 items-center gap-2 rounded-lg bg-raised px-3 text-muted focus-within:ring-1 focus-within:ring-accent/60">
                <Icon name="search" size={15} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('search_placeholder')}
                  className="w-full select-text bg-transparent text-sm text-ink outline-none placeholder:text-muted/60"
                />
              </label>
              <div className="flex flex-wrap gap-1">
                {['all', ...Object.keys(settings.models)].map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setModel(id)}
                    className={cx(
                      'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                      model === id ? 'bg-accent text-white' : 'bg-raised text-muted hover:text-ink',
                    )}
                  >
                    {id === 'all' ? t('all') : settings.models[id]}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {list.length === 0 && (
                <p className="p-8 text-center text-sm text-muted">{boards.length === 0 ? t('no_boards') : t('no_match')}</p>
              )}
              {list.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelected(b.id)}
                  className={cx(
                    'mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    current?.id === b.id ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-raised',
                  )}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-hover text-xs font-semibold tabular-nums text-muted">
                    #{b.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{b.name || b.ownerName}</span>
                    <span className="block truncate text-xs text-muted">
                      {b.name ? `${b.ownerName} · ` : ''}
                      {b.area || settings.models[b.model] || b.model}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted">
                    <span className={cx('block font-medium', b.ops > 0 && 'text-ink')}>{b.ops === 0 ? t('empty') : t('ops', b.ops)}</span>
                    {b.updated && <span className="block text-[11px]">{ago(now - b.updated)}</span>}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-5">
            {current ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <NameField
                    key={current.id}
                    name={current.name}
                    maxLength={settings.nameLength ?? 32}
                    disabled={busy}
                    onSave={(name) => boardAction('adminRename', current.id, { name })}
                  />
                  <span className="rounded-md bg-hover px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted">#{current.id}</span>
                  <span className="rounded-md bg-raised px-2 py-0.5 text-xs font-medium text-muted">
                    {settings.models[current.model] ?? current.model}
                  </span>
                </div>

                <BoardPreview boardId={current.id} revision={revision} settings={settings} />

                <div className="grid grid-cols-4 gap-2">
                  <Stat label={t('owner')}>{current.ownerName}</Stat>
                  <Stat label={t('citizen_id')}>
                    <span className="select-text font-mono">{current.owner}</span>
                  </Stat>
                  <Stat label={t('location')}>{current.area || '-'}</Stat>
                  <Stat label={t('last_edited')}>{current.updated ? ago(now - current.updated) : '-'}</Stat>
                </div>

                <div className="grid grid-cols-2 gap-4 rounded-lg bg-raised/60 p-4">
                  <Usage label={t('usage_drawings')} used={current.ops} max={view.limits.ops} />
                  <Usage label={t('usage_points')} used={current.points} max={view.limits.points} />
                </div>

                <div className="flex gap-2">
                  <ActionButton icon="teleport" label={t('teleport')} onClick={() => fetchNui('adminTeleport', { id: current.id })} />
                  <ActionButton icon="pin" label={t('set_waypoint')} onClick={() => fetchNui('adminWaypoint', { id: current.id })} />
                  <ConfirmButton
                    icon="eraser"
                    label={t('clear_drawing')}
                    confirm={t('click_to_clear')}
                    disabled={busy || current.ops === 0}
                    onConfirm={() => boardAction('adminClear', current.id)}
                  />
                  <ConfirmButton
                    icon="trash"
                    label={t('delete_board')}
                    confirm={t('click_to_delete')}
                    disabled={busy}
                    onConfirm={() => boardAction('adminRemove', current.id)}
                  />
                </div>
                <p className="font-mono text-[11px] text-muted">
                  {current.x.toFixed(2)}, {current.y.toFixed(2)}, {current.z.toFixed(2)} · {t('heading', current.heading.toFixed(0))}
                  {current.width ? ` · ${t('wide', current.width.toFixed(1))}` : ''}
                  {current.bucket ? ` · ${t('bucket', current.bucket)}` : ''}
                </p>
              </div>
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted">{t('pick_board')}</div>
            )}
          </main>
        </div>
      </Panel>
    </div>
  );
}
