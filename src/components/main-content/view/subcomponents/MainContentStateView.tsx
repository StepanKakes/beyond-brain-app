import { useTranslation } from 'react-i18next';
import type { MainContentStateViewProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';
import BeyondWelcome from '../../../beyond/BeyondWelcome';

export default function MainContentStateView({ mode, isMobile, onMenuClick }: MainContentStateViewProps) {
  const { t } = useTranslation();
  const isLoading = mode === 'loading';

  return (
    <div className="flex h-full flex-col">
      {isMobile && (
        <div className="pwa-header-safe flex-shrink-0 border-b border-white/25 bg-white/40 p-2 backdrop-blur-xl backdrop-saturate-150 dark:border-white/5 dark:bg-beyond-ink/40 sm:p-3">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            {/* Beyond "Přemýšlím..." loading — subtle gradient pulse, no spinner */}
            <div className="relative mx-auto mb-5 h-12 w-12 overflow-hidden rounded-full bg-gradient-to-br from-beyond-peach via-beyond-coral to-beyond-plum">
              <div className="beyond-loading-pulse" />
            </div>
            <h2 className="mb-1 font-serif text-2xl text-beyond-primary">{t('mainContent.loading')}</h2>
            <p className="text-sm text-beyond-secondary">{t('mainContent.settingUpWorkspace')}</p>
          </div>
        </div>
      ) : (
        <BeyondWelcome />
      )}
    </div>
  );
}
