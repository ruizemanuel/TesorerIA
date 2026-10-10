import Link from "next/link";
import { AvatarLink } from "./avatar";
import { Logo } from "./ui";

/** Your avatar opens "Tu cuenta", which lives on the fund's inicio, wherever you are. */
function AccountLink({ address, userName }: { address: string; userName: string }) {
  return <AvatarLink name={userName} label="Tu cuenta" href={`/f/${address}?p=cuenta`} scroll={false} />;
}

/** Up to 1023 px: the fund's name, and your avatar at the top right (spec, 9.2). */
export function FundNameRow({ fundName, address, userName }: { fundName: string; address: string; userName?: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between">
      <h1 className="text-sm font-bold text-primary [font-stretch:87%]">{fundName}</h1>
      {/* The circle is 32 px inside a 44 px touch target: pull it out so the circle sits on the 16 px margin. */}
      {userName && (
        <div className="-mr-1.5">
          <AccountLink address={address} userName={userName} />
        </div>
      )}
    </div>
  );
}

/** Up to 1023 px, on the screens that have no balance of their own (Movimientos): the name and avatar, over the stripe. */
export function MobileBar(props: { fundName: string; address: string; userName?: string }) {
  return (
    <header className="border-b-4 border-primary bg-surface lg:hidden">
      <div className="mx-auto max-w-[560px] px-4 py-1.5">
        <FundNameRow {...props} />
      </div>
    </header>
  );
}

/** From 1024 px: the logo, the fund's name and your avatar, over the 4 px stripe (spec, 9.2). */
export function TopBar({ fundName, address, userName }: { fundName: string; address: string; userName?: string }) {
  return (
    <header className="hidden items-center justify-between border-b-4 border-primary bg-surface px-7 py-2 lg:flex">
      <Link href="/">
        <Logo />
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-bold text-primary [font-stretch:87%]">{fundName}</h1>
        {userName && <AccountLink address={address} userName={userName} />}
      </div>
    </header>
  );
}

/** Up to 1023 px: Inicio and Movimientos at the bottom; Agente comes with the chat (part 2). */
export function TabBar({ address, active }: { address: string; active: "inicio" | "movimientos" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`grid min-h-11 place-items-center gap-1 text-xs font-semibold ${on ? "text-primary" : "text-muted"}`}
    >
      <span aria-hidden="true" className={`block size-[22px] rounded-[7px] ${on ? "bg-primary" : "bg-line"}`} />
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Secciones del fondo"
      className="fixed inset-x-0 bottom-0 grid grid-cols-2 border-t border-line bg-surface pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 lg:hidden"
    >
      {tab(`/f/${address}`, "Inicio", active === "inicio")}
      {tab(`/f/${address}/movimientos`, "Movimientos", active === "movimientos")}
    </nav>
  );
}
