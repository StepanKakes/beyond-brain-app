/**
 * Soft gradient circle used as Beyond's chat avatar.
 * Pulses gently on hover to feel alive.
 */
type Props = {
  size?: number;
  className?: string;
};

export default function BeyondAssistantAvatar({ size = 36, className }: Props) {
  return (
    <div
      style={{ width: size, height: size }}
      className={`relative flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-beyond-peach via-beyond-coral to-beyond-plum shadow-soft ${className ?? ''}`}
    >
      <svg
        className="text-white/90"
        width={Math.round(size * 0.55)}
        height={Math.round(size * 0.55)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
      </svg>
    </div>
  );
}
