/**
 * Beyond Brain: the status line while a turn runs, the way Siri shows it. Small
 * orbiting dots and one breathing line saying what is going on, nothing else.
 */
export default function BeyondLoader({ label = 'Přemýšlím' }: { label?: string }) {
  return (
    <div role="status" className="bb-status">
      <span className="bb-orbit" aria-hidden="true" />
      <span key={label} className="bb-status__label">
        {label}
      </span>
    </div>
  );
}
