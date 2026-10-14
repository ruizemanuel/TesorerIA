import { FIELD } from "./ui";

/**
 * An amount field (Aportar, Pasar a pesos), with what to fix under it, or else `note`. The note isn't an alert: in
 * Aportar it changes with the fund's rate every 10 s, and a screen reader would read it out each time.
 */
export function AmountField({
  label,
  value,
  problem,
  note,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  problem: string;
  note?: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <label className="grid gap-1">
        <span className="font-semibold">{label}</span>
        <input
          className={`${FIELD} money`}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          disabled={disabled}
          aria-invalid={problem !== ""}
          aria-describedby="amount-problem"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {problem === "" && note !== undefined ? (
        <p id="amount-problem" className="min-h-5 text-sm text-muted">
          {note}
        </p>
      ) : (
        <p id="amount-problem" role="alert" className="min-h-5 text-sm text-owe">
          {problem}
        </p>
      )}
    </div>
  );
}
