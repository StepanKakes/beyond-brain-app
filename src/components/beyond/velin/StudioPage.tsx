/**
 * Beyond Brain — Story Studio, inside the brain.
 *
 * Story Studio stays its own app (its editor, its queue, its Instagram
 * publishing); the brain shows it here so stories are one click from the
 * proposals that made them. Same site, so the studio's login cookie holds.
 */
const STUDIO_URL = (import.meta.env.VITE_STORY_STUDIO_URL as string | undefined) || 'https://stories.growbeyond.cz';

export default function StudioPage() {
  return (
    <div className="bb-studio">
      <div className="bb-studio__bar">
        <span className="bb-studio__t">Story Studio</span>
        <a className="bb-pill bb-pill--sm" href={STUDIO_URL} target="_blank" rel="noreferrer">Otevřít v novém okně</a>
      </div>
      <iframe className="bb-studio__frame" src={STUDIO_URL} title="Story Studio" allow="clipboard-write" />
    </div>
  );
}
