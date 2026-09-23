/**
 * Beyond Brain — looking at a story the way it will be seen.
 *
 * A rendered story is a picture, not a text file: what a person needs before
 * approving it is what the viewer gets, in the shape the viewer gets it. So
 * this is the Instagram frame — the bars across the top, the face and the
 * time, a tap on the right for the next slide, a tap on the left to go back —
 * with nothing else on screen.
 */
import { useCallback, useEffect, useState } from 'react';

import { X, ChevronLeft, ChevronRight } from '../icons';

export default function StoryViewer({
  images, startAt = 0, name = 'Tim', avatar = '/avatars/tim.jpg', when, onClose,
}: {
  images: string[];
  startAt?: number;
  name?: string;
  avatar?: string;
  when?: string | null;
  onClose: () => void;
}) {
  const [i, setI] = useState(Math.min(Math.max(0, startAt), Math.max(0, images.length - 1)));

  const next = useCallback(() => {
    setI((cur) => (cur + 1 < images.length ? cur + 1 : cur));
  }, [images.length]);
  const prev = useCallback(() => setI((cur) => (cur > 0 ? cur - 1 : 0)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  if (!images.length) return null;

  return (
    <div className="bb-sv" role="dialog" aria-modal="true" aria-label="Náhled stories" onClick={onClose}>
      <div className="bb-sv__frame" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="bb-sv__bars">
          {images.map((src, n) => (
            <i key={src} data-on={n <= i ? 'true' : undefined} />
          ))}
        </div>
        <div className="bb-sv__head">
          <img className="bb-sv__av" src={avatar} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          <span className="bb-sv__who">{name}</span>
          {when && <span className="bb-sv__when">{when}</span>}
          <button type="button" className="bb-sv__x" onClick={onClose} aria-label="Zavřít">
            <X size={18} />
          </button>
        </div>

        <img className="bb-sv__img" src={images[i]} alt={`Slide ${i + 1} z ${images.length}`} />

        {/* The whole left and right halves move the story, the way the app it
            imitates does it. The arrows are for a mouse that wants a target. */}
        <button type="button" className="bb-sv__zone bb-sv__zone--l" onClick={prev} aria-label="Předchozí slide" disabled={i === 0}>
          <ChevronLeft size={20} />
        </button>
        <button type="button" className="bb-sv__zone bb-sv__zone--r" onClick={i + 1 < images.length ? next : onClose} aria-label={i + 1 < images.length ? 'Další slide' : 'Zavřít'}>
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}
