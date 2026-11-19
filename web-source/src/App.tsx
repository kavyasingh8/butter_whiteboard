import { useEffect, useState } from 'react';
import { AdminPanel } from './components/admin/AdminPanel';
import { Editor } from './components/Editor';
import { setLocale } from './i18n';
import type { NuiMessage } from './nui';
import type { AdminOpen, OpenData } from './types';

export function App() {
  const [open, setOpen] = useState<OpenData | null>(null);
  const [admin, setAdmin] = useState<AdminOpen | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent<NuiMessage>) => {
      const msg = e.data;
      if (msg?.action === 'open') {
        setLocale(msg.data.locale);
        setOpen(msg.data);
      } else if (msg?.action === 'admin') {
        setLocale(msg.data.locale);
        setAdmin(msg.data);
      }
      else if (msg?.action === 'close') {
        setOpen(null);
        setAdmin(null);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="font-sans text-ink antialiased">
      {admin ? <AdminPanel data={admin} onClose={() => setAdmin(null)} /> : open && <Editor key={open.boardId} data={open} />}
    </div>
  );
}
