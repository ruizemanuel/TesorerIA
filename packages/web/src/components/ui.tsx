import Link from "next/link";
import type { ComponentProps } from "react";
import { formatPesos } from "../lib/format";
import type { Locale } from "../lib/i18n/locales";

// One radius for buttons and cards (14 px), 48 px tall buttons, one primary per screen (spec, 9.1).
// Height and padding live in each variant, so the link's 44 px never fights a base class.
// `text-center`: a label that wraps on a narrow phone stays centered, line by line.
const BUTTON = "inline-flex items-center justify-center rounded-[14px] text-center text-[15px] font-bold disabled:opacity-50";
const VARIANTS = {
  primary: "min-h-12 bg-primary px-4 text-white hover:bg-primary/90",
  secondary: "min-h-12 bg-tint px-4 text-primary hover:bg-tint/70",
  link: "min-h-11 px-0 text-primary underline-offset-4 hover:underline",
} as const;

export type Variant = keyof typeof VARIANTS;

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={`${BUTTON} ${VARIANTS[variant]} ${className}`} {...props} />;
}

/** A button's classes, for a link that looks like one (ButtonLink, or a PanelLink). */
export function buttonClass(variant: Variant = "primary", className = ""): string {
  return `${BUTTON} ${VARIANTS[variant]} ${className}`;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

/** A form field: 48 px tall, the same radius as the buttons. The 16 px text size comes from globals.css. */
export const FIELD = "min-h-12 w-full rounded-[14px] border border-field-line bg-surface px-3";

/** The wordmark: Encode Sans 800 at 80 % width, in `primary`, with no other color (spec, 9.1). */
export function Logo({ className = "" }: { className?: string }) {
  return <span className={`narrow text-[20px] font-extrabold text-primary ${className}`}>TesorerIA</span>;
}

/** A white card on the page's tint: no shadow (spec, 9.1). */
export function Card({ className = "", ...props }: ComponentProps<"section">) {
  return <section className={`rounded-[14px] bg-surface p-4 ${className}`} {...props} />;
}

export function CardTitle({ className = "", ...props }: ComponentProps<"h2">) {
  return <h2 className={`text-base font-bold [font-stretch:87%] ${className}`} {...props} />;
}

/** An amount of pesos in the page's language: it works in server and browser components, so `locale` comes from the caller. */
export function Money({ units, locale, className = "" }: { units: bigint; locale: Locale; className?: string }) {
  return <span className={`money ${className}`}>{formatPesos(units, locale)}</span>;
}
