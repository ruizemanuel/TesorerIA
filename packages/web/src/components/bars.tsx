import Link from "next/link";
import type { Messages } from "../lib/i18n/messages";
import { AvatarLink } from "./avatar";
import { PanelLink } from "./panel-link";
import { Logo, buttonClass } from "./ui";

/** Your avatar opens "Tu cuenta", which lives on the fund's inicio, wherever you are. */
function AccountLink({ address, userName, m }: { address: string; userName: string; m: Messages }) {
  return <AvatarLink name={userName} label={m.nav.account} href={`/f/${address}?p=cuenta`} />;
}

/** Up to 1023 px: the fund's name, and your avatar at the top right (spec, 9.2). */
export function FundNameRow({ fundName, address, userName, m }: { fundName: string; address: string; userName?: string; m: Messages }) {
  return (
    <div className="flex min-h-11 items-center justify-between">
      <h1 className="text-sm font-bold text-primary [font-stretch:87%]">{fundName}</h1>
      {/* The circle is 32 px inside a 44 px touch target: pull it out so the circle sits on the 16 px margin. */}
      {userName && (
        <div className="-mr-1.5">
          <AccountLink address={address} userName={userName} m={m} />
        </div>
      )}
    </div>
  );
}

/** Up to 1023 px, on the screens that have no balance of their own (Movimientos): the name and avatar, over the stripe. */
export function MobileBar(props: { fundName: string; address: string; userName?: string; m: Messages }) {
  return (
    <header className="border-b-4 border-primary bg-surface lg:hidden">
      <div className="mx-auto max-w-[560px] px-4 py-1.5">
        <FundNameRow {...props} />
      </div>
    </header>
  );
}

/** From 1024 px: the logo, the fund's name and your avatar, over the 4 px stripe (spec, 9.2). */
export function TopBar({ fundName, address, userName, m }: { fundName: string; address: string; userName?: string; m: Messages }) {
  return (
    <header className="hidden items-center justify-between border-b-4 border-primary bg-surface px-7 py-2 lg:flex">
      <Link href="/">
        <Logo />
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-bold text-primary [font-stretch:87%]">{fundName}</h1>
        {userName && <AccountLink address={address} userName={userName} m={m} />}
      </div>
    </header>
  );
}

/**
 * From 1024 px, with the chat on, it opens from a floating button (spec, 9.2); below, from the bottom bar. Its panel
 * lives on the inicio: from there it opens at once, from Movimientos it goes there. The wrapper hides it, so the
 * button's own display never fights `hidden`.
 */
export function AgentButton({ address, m }: { address: string; m: Messages }) {
  return (
    <div className="fixed bottom-6 right-6 hidden lg:block">
      <PanelLink href={`/f/${address}?p=agente`} className={buttonClass("primary")}>
        {m.nav.askAgent}
      </PanelLink>
    </div>
  );
}

/** Up to 1023 px: Inicio, Movimientos and, with the chat on, Agente, which opens its panel over the inicio (spec, 9.2). */
export function TabBar({ address, active, chat = false, m }: { address: string; active: "inicio" | "movimientos"; chat?: boolean; m: Messages }) {
  const look = (on: boolean) => `grid min-h-11 place-items-center gap-1 text-xs font-semibold ${on ? "text-primary" : "text-muted"}`;
  const icon = (on: boolean) => <span aria-hidden="true" className={`block size-[22px] rounded-[7px] ${on ? "bg-primary" : "bg-line"}`} />;
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={look(on)}>
      {icon(on)}
      {label}
    </Link>
  );
  return (
    <nav
      aria-label={m.nav.sections}
      className={`fixed inset-x-0 bottom-0 grid ${chat ? "grid-cols-3" : "grid-cols-2"} border-t border-line bg-surface pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 lg:hidden`}
    >
      {tab(`/f/${address}`, m.nav.home, active === "inicio")}
      {tab(`/f/${address}/movimientos`, m.nav.activity, active === "movimientos")}
      {chat && (
        // The chat's panel lives on the inicio: from there it opens at once, from Movimientos it goes there.
        <PanelLink href={`/f/${address}?p=agente`} className={look(false)}>
          {icon(false)}
          {m.nav.agent}
        </PanelLink>
      )}
    </nav>
  );
}
