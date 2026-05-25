type AuthErrorAlertProps = {
  errorMessage: string;
};

/**
 * Beyond v2 — inline error line, no alert box. Subtle and de-emphasized.
 */
export default function AuthErrorAlert({ errorMessage }: AuthErrorAlertProps) {
  if (!errorMessage) return null;
  return (
    <p className="text-center text-[13px] text-[#a13a3a]" role="alert">
      {errorMessage}
    </p>
  );
}
