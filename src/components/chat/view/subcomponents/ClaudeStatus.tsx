import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../../lib/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type ClaudeStatusProps = {
  status: {
    text?: string;
    tokens?: number;
    can_interrupt?: boolean;
  } | null;
  onAbort?: () => void;
  isLoading: boolean;
  provider?: string;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
// Beyond CZ defaults — used when no translation key matches.
const DEFAULT_ACTION_WORDS = ['Přemýšlím', 'Zpracovávám', 'Analyzuju', 'Pracuju', 'Počítám', 'Uvažuju'];

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  claude: 'messageTypes.claude',
  codex: 'messageTypes.codex',
  cursor: 'messageTypes.cursor',
  gemini: 'messageTypes.gemini',
};

function formatElapsedTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins < 1 ? `${secs}s` : `${mins}m ${secs}s`;
}

export default function ClaudeStatus({
  status,
  onAbort,
  isLoading,
  provider = 'claude',
}: ClaudeStatusProps) {
  const { t } = useTranslation('chat');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      return;
    }
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    const dotTimer = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);

    return () => {
      clearInterval(timer);
      clearInterval(dotTimer);
    };
  }, [isLoading]);

  if (!isLoading && !status) return null;

  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const statusText = (status?.text || actionWords[Math.floor(elapsedTime / 3) % actionWords.length]).replace(/[.]+$/, '');

  const providerLabel = t(PROVIDER_LABEL_KEYS[provider] || 'claudeStatus.providers.assistant', { defaultValue: 'Assistant' });

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 mb-3 w-full duration-500">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 overflow-hidden rounded-full border border-white/40 bg-white/65 px-3.5 py-1.5 shadow-soft backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-beyond-ink/55">

        {/* Left side — identity + Beyond "Přemýšlím..." status */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-beyond-peach via-beyond-coral to-beyond-plum">
            <SessionProviderLogo provider={provider} className="h-3.5 w-3.5" />
            {isLoading && (
              <span className="absolute inset-0 rounded-full ring-2 ring-beyond-coral/30 animate-pulse" />
            )}
          </div>

          <div className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-beyond-muted">
              {providerLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                isLoading ? "bg-beyond-coral animate-pulse" : "bg-beyond-muted/40"
              )} />
              <p className="truncate text-xs font-medium text-beyond-primary">
                {statusText}
                <span className="inline-block w-4 text-beyond-secondary">
                  {isLoading ? dots : ''}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Right side — elapsed time + stop button */}
        <div className="flex items-center gap-2">
          {isLoading && status?.can_interrupt !== false && onAbort && (
            <>
              <div className="hidden items-center rounded-full bg-white/55 px-2 py-0.5 text-[10px] font-medium tabular-nums text-beyond-secondary sm:flex dark:bg-white/10">
                {formatElapsedTime(elapsedTime)}
              </div>

              <button
                type="button"
                onClick={onAbort}
                className="group flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[10px] font-medium text-destructive transition-all hover:bg-destructive hover:text-destructive-foreground"
              >
                <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
                <span className="hidden sm:inline">Stop</span>
                <kbd className="hidden rounded bg-black/10 px-1 text-[9px] group-hover:bg-white/20 sm:block">
                  ESC
                </kbd>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}