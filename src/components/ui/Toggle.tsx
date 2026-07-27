export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={checked}
      className="toggle"
      data-checked={checked}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span className="toggle__thumb" />
    </button>
  );
}

