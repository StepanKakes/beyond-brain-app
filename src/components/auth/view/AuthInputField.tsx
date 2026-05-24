type AuthInputFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
  isDisabled: boolean;
  type?: 'text' | 'password' | 'email';
  name?: string;
  autoComplete?: string;
};

/**
 * A labelled input field for authentication forms.
 * Renders a `<label>` / `<input>` pair and forwards browser autofill hints
 * (`name`, `autoComplete`) so that password managers can identify and fill
 * the field correctly.
 */
export default function AuthInputField({
  id,
  label,
  value,
  onChange,
  placeholder,
  isDisabled,
  type = 'text',
  name,
  autoComplete,
}: AuthInputFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium tracking-wide text-beyond-secondary">
        {label}
      </label>
      <input
        id={id}
        type={type}
        name={name ?? id}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/40 bg-white/70 px-3.5 py-2.5 text-sm text-beyond-primary placeholder:text-beyond-muted/70 backdrop-blur-md focus:border-transparent focus:bg-white/95 focus:outline-none focus:ring-2 focus:ring-beyond-dusk/30 dark:border-white/10 dark:bg-white/5"
        placeholder={placeholder}
        required
        disabled={isDisabled}
      />
    </div>
  );
}
