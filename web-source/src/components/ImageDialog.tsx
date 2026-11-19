import { useEffect, useState } from 'react';
import { probeImage } from '../draw';
import { t } from '../i18n';
import { isAllowedImageUrl } from '../images';
import type { Settings } from '../types';
import { Icon } from './Icon';
import { Button, Panel } from './ui';

export interface ImageChoice {
  url: string;
  width: number;
  height: number;
}

interface ImageDialogProps {
  images: Settings['images'];
  remaining: number;
  onConfirm: (choice: ImageChoice) => void;
  onCancel: () => void;
}

type Preview =
  | { state: 'idle' }
  | { state: 'invalid' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; width: number; height: number };

export function ImageDialog({ images, remaining, onConfirm, onCancel }: ImageDialogProps) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<Preview>({ state: 'idle' });
  const trimmed = url.trim();

  useEffect(() => {
    if (!trimmed) return setPreview({ state: 'idle' });
    if (!isAllowedImageUrl(trimmed, images)) return setPreview({ state: 'invalid' });

    let cancelled = false;
    setPreview({ state: 'loading' });
    const timer = setTimeout(() => {
      probeImage(trimmed)
        .then((size) => !cancelled && setPreview({ state: 'ready', ...size }))
        .catch(() => !cancelled && setPreview({ state: 'error' }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, images]);

  const full = remaining <= 0;
  const ready = preview.state === 'ready' && !full;
  const confirm = () => {
    if (preview.state === 'ready' && !full) onConfirm({ url: trimmed, width: preview.width, height: preview.height });
  };

  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center bg-black/40 backdrop-blur-[2px]"
      // Only a click on the dimmed backdrop itself closes it, not one on the dialog's edge.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <Panel className="w-[440px] max-w-[92%] p-5">
        <div onPointerDown={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">{t('add_image_title')}</h2>
              <p className="mt-0.5 text-sm text-muted">{t('add_image_text')}</p>
            </div>
            <button type="button" onClick={onCancel} className="-mr-1 -mt-1 rounded-md p-1 text-muted hover:bg-hover hover:text-ink">
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-raised px-3 ring-1 ring-inset ring-line focus-within:ring-accent">
            <Icon name="link" size={16} className="shrink-0 text-muted" />
            <input
              autoFocus
              value={url}
              maxLength={images.maxUrlLength}
              placeholder="https://i.imgur.com/example.png"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') confirm();
                if (e.key === 'Escape') onCancel();
              }}
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted/60"
            />
          </div>

          <div className="relative mt-3 grid h-44 place-items-center overflow-hidden rounded-lg bg-raised/60 ring-1 ring-inset ring-line">
            {preview.state === 'ready' ? (
              <img src={trimmed} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-contain p-2" />
            ) : (
              <PreviewMessage preview={preview} domains={images.domains} />
            )}
          </div>

          <div className="mt-4 flex items-center">
            <span className={full ? 'text-xs text-danger' : 'text-xs text-muted'}>
              {full ? t('image_limit') : t('images_left', remaining)}
            </span>
            <div className="ml-auto flex gap-1">
              <Button onClick={onCancel}>{t('cancel')}</Button>
              <Button variant="primary" disabled={!ready} onClick={confirm}>
                {t('continue')}
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function PreviewMessage({ preview, domains }: { preview: Preview; domains: string[] }) {
  if (preview.state === 'loading') {
    return <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted/30 border-t-accent" />;
  }
  if (preview.state === 'invalid') {
    return (
      <p className="px-6 text-center text-sm text-muted">
        <span className="font-medium text-danger">{t('link_not_allowed')}</span>
        <br />
        {t('allowed_hosts', Array.isArray(domains) ? domains.join(', ') : '')}
      </p>
    );
  }
  if (preview.state === 'error') {
    return <p className="text-sm text-danger">{t('image_failed')}</p>;
  }
  return (
    <div className="flex flex-col items-center gap-2 text-muted/70">
      <Icon name="image" size={28} />
      <span className="text-xs">{t('preview_here')}</span>
    </div>
  );
}
