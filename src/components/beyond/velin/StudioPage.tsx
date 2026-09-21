import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

/**
 * Beyond Brain — Story Studio, inside the brain.
 *
 * Story Studio stays its own app (its editor, its queue, its Instagram
 * publishing); the brain shows it here so stories are one click from the
 * proposals that made them. The server hands over a login link built from
 * the same key the agent uses, so nobody types a password into a frame.
 */
const FALLBACK = 'https://stories.growbeyond.cz';

export default function StudioPage() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/beyond/velin/studio')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: string } | null) => { if (!cancelled) setUrl(d?.url || FALLBACK); })
      .catch(() => { if (!cancelled) setUrl(FALLBACK); });
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="bb-studio">
      <div className="bb-studio__bar">
        <span className="bb-studio__t">Story Studio</span>
        <a className="bb-pill bb-pill--sm" href={url || FALLBACK} target="_blank" rel="noreferrer">Otevřít v novém okně</a>
      </div>
      {url && <iframe className="bb-studio__frame" src={url} title="Story Studio" allow="clipboard-write" />}
    </div>
  );
}
