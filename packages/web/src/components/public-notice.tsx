import type { Messages } from "../lib/i18n/messages";
import { LanguageSwitch } from "./language-switch";

/**
 * The public view's notice, with the language switch (spec, 9.2): on its inicio and on its list of movements. On a
 * phone the notice lines up with the page, beside the switch; on a computer it's centered on the page, with the
 * switch in a column of its own.
 */
export function PublicNotice({ m }: { m: Messages }) {
  return (
    <div className="flex items-center gap-2 bg-tint px-4 text-sm lg:grid lg:grid-cols-[1fr_auto_1fr]">
      <p className="flex-1 py-2 font-semibold text-pretty lg:col-start-2 lg:text-center">{m.fund.publicNotice}</p>
      <LanguageSwitch className="lg:justify-self-end" />
    </div>
  );
}
