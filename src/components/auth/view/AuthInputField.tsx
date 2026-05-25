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
 * Beyond v2 — underline-only input field. No bordered box, no glass.
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
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-beyond-faint"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        name={name ?? id}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        disabled={isDisabled}
        className="w-full border-0 border-b border-beyond-line bg-transparent py-2 text-[16px] text-beyond-ink placeholder:text-beyond-faint focus:border-beyond-ink focus:outline-none"
      />
    </div>
  );
}
