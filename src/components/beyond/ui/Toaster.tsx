import { useEffect, useState } from 'react';

import SwipeToast from '../bits/SwipeToast';
import type { ToastNote } from './toast';

/** Renders whatever `toast()` last asked for; swipe down or wait to dismiss. */
export default function Toaster() {
  const [note, setNote] = useState<(ToastNote & { id: number }) | null>(null);

  useEffect(() => {
    let seq = 0;
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastNote>).detail;
      if (detail?.title) setNote({ ...detail, id: ++seq });
    };
    window.addEventListener('beyond:toast', onToast);
    return () => window.removeEventListener('beyond:toast', onToast);
  }, []);

  if (!note) return null;
  return (
    <SwipeToast
      key={note.id}
      title={note.title}
      description={note.description}
      actionLabel={note.action?.label}
      onAction={note.action?.run}
      duration={4200}
      width={340}
      onClose={() => setNote((n) => (n && n.id === note.id ? null : n))}
    />
  );
}
