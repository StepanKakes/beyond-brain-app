import type { ReactNode } from 'react';
import { IS_PLATFORM } from '../../../constants/config';
import { useAuth } from '../context/AuthContext';
import Onboarding from '../../onboarding/view/Onboarding';
import AuthLoadingScreen from './AuthLoadingScreen';
import LoginForm from './LoginForm';
import SetupForm from './SetupForm';

type ProtectedRouteProps = {
  children: ReactNode;
};

/**
 * Beyond v2: claudecodeui's project / agent onboarding (Git setup, agent
 * config) is intentionally skipped. Tim drives everything through chat —
 * once the user is authenticated, we drop straight into Beyond.
 *
 * The original onboarding component remains importable for the platform
 * build (`IS_PLATFORM`) so we don't break that surface.
 */
const BEYOND_SKIP_OSS_ONBOARDING = true;

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, needsSetup, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (IS_PLATFORM) {
    if (!hasCompletedOnboarding) {
      return <Onboarding onComplete={refreshOnboardingStatus} />;
    }

    return <>{children}</>;
  }

  if (needsSetup) {
    return <SetupForm />;
  }

  if (!user) {
    return <LoginForm />;
  }

  if (!hasCompletedOnboarding && !BEYOND_SKIP_OSS_ONBOARDING) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return <>{children}</>;
}
