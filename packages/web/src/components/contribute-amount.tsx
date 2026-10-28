import { type ReactNode, useId } from "react";

/** The currency each tab's amount is in, as the pill beside it says it: the same in both languages. */
const UNITS = { usdt: { mark: "₮", code: "USDT" }, wars: { mark: "$", code: "ARS" } } as const;

/**
 * Aportar's amount (spec, 9.7): in a box of its own, the label and what the account holds over the amount, large,
 * with its currency beside it, and under it what to fix, or else `note`. The note isn't an alert: in the USDT tab it
 * changes with the fund's rate every 10 s, and a screen reader would read it out each time. The box shows the focus,
 * since the field inside has no border of its own. The field is `w-0 flex-1`: an input is as wide as 20 of its
 * letters, which at 44 px pushed the whole panel past a phone's width.
 */
export function ContributeAmount({
  label,
  held,
  token,
  value,
  problem,
  note,
  disabled,
  onChange,
}: {
  label: string;
  /** What the account holds, short: `contribute.youHold`. */
  held: ReactNode;
  token: "usdt" | "wars";
  value: string;
  problem: string;
  note?: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const id = useId();
  const unit = UNITS[token];
  return (
    <div className="grid gap-1.5 rounded-[14px] bg-bg p-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px] text-muted">
        <label htmlFor={`${id}-amount`} className="font-semibold">
          {label}
        </label>
        <span>{held}</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          id={`${id}-amount`}
          className="money w-0 min-w-0 flex-1 bg-transparent text-[44px] font-semibold leading-[1.15] [font-stretch:87%] outline-none"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          disabled={disabled}
          aria-invalid={problem !== ""}
          aria-describedby={`${id}-unit ${id}-note`}
          onChange={(event) => onChange(event.target.value)}
        />
        <span id={`${id}-unit`} className="flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-surface pl-1.5 pr-3.5 text-[15px] font-bold">
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-primary text-sm font-extrabold text-white">
            {unit.mark}
          </span>
          {unit.code}
        </span>
      </div>
      {problem === "" && note !== undefined ? (
        <p id={`${id}-note`} className="min-h-5 text-[13px] text-muted">
          {note}
        </p>
      ) : (
        <p id={`${id}-note`} role="alert" className="min-h-5 text-[13px] text-owe">
          {problem}
        </p>
      )}
    </div>
  );
}
