import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

type SetupFormState = {
  username: string;
  password: string;
  confirmPassword: string;
};

const initialState: SetupFormState = {
  username: '',
  password: '',
  confirmPassword: '',
};

/**
 * Validates the account-setup form state.
 * @returns An error message string if validation fails, or `null` when the
 *   form is valid.
 */
function validateSetupForm(formState: SetupFormState): string | null {
  if (!formState.username.trim() || !formState.password || !formState.confirmPassword) {
    return 'Please fill in all fields.';
  }

  if (formState.username.trim().length < 3) {
    return 'Username must be at least 3 characters long.';
  }

  if (formState.password.length < 6) {
    return 'Password must be at least 6 characters long.';
  }

  if (formState.password !== formState.confirmPassword) {
    return 'Passwords do not match.';
  }

  return null;
}

/**
 * Account setup / registration form.
 * Uses `autoComplete="new-password"` on password fields so that password
 * managers recognise this as a registration flow and offer to save the new
 * credentials after submission.
 */
export default function SetupForm() {
  const { register } = useAuth();

  const [formState, setFormState] = useState<SetupFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof SetupFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      const validationError = validateSetupForm(formState);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      setIsSubmitting(true);
      const result = await register(formState.username.trim(), formState.password);
      if (!result.success) {
        setErrorMessage(result.error);
      }
      setIsSubmitting(false);
    },
    [formState, register],
  );

  return (
    <AuthScreenLayout
      title="Beyond"
      description="Tvůj druhý mozek. Začneme."
      footerText="Tohle je jednouživatelský systém."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <AuthInputField
          id="username"
          name="username"
          label="Uživatel"
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder=""
          isDisabled={isSubmitting}
          autoComplete="username"
        />

        <AuthInputField
          id="password"
          name="password"
          label="Heslo"
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder=""
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
        />

        <AuthInputField
          id="confirmPassword"
          name="confirmPassword"
          label="Heslo znovu"
          value={formState.confirmPassword}
          onChange={(value) => updateField('confirmPassword', value)}
          placeholder=""
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
        />

        <AuthErrorAlert errorMessage={errorMessage} />

        <div className="flex justify-center pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="beyond-pill disabled:opacity-50"
          >
            {isSubmitting ? 'Zakládám…' : 'Vytvořit účet'}
          </button>
        </div>
      </form>
    </AuthScreenLayout>
  );
}
