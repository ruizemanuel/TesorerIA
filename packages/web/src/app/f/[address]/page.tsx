import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { isAddress } from "viem";
import { ContributePanel } from "../../../components/contribute-panel";
import { ExpensePanel } from "../../../components/expense-panel";
import { FundScreenView } from "../../../components/fund-screen";
import { LogoutButton } from "../../../components/logout-button";
import { Panel } from "../../../components/panel";
import { Receipt } from "../../../components/receipt";
import { currentUser } from "../../../lib/current-user";
import { loadFundScreen } from "../../../lib/read-fund";
import { safeNext } from "../../../lib/safe-next";

type Search = { p?: string; id?: string; aporte?: string };

/** The inicio of a fund (spec, 9.2). The panels (`?p=…`) live in the URL, so the back button closes them. */
export default async function FundPage({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<Search> }) {
  await connection(); // it depends on who's asking and reads the chain, so it's never prerendered at build time
  const { address } = await params;
  const search = await searchParams;
  if (!isAddress(address, { strict: false })) notFound();
  const user = await currentUser();
  if (user === null) redirect(`/entrar?next=${encodeURIComponent(safeNext(`/f/${address}`))}`);
  const screen = await loadFundScreen(address, user);
  if (screen === null) notFound();
  const here = `/f/${screen.view.address}`;

  let panel: ReactNode = null;
  if (search.p === "aportar") {
    panel = (
      <Panel title="Aportar" closeHref={here}>
        <ContributePanel
          fund={screen.view.address}
          account={user.account}
          balance={screen.view.balance}
          owed={screen.view.me?.owed ?? 0n}
          weeklyFee={screen.view.weeklyFee}
          contributionOnItsWay={screen.contributionOnItsWay}
        />
      </Panel>
    );
  } else if (search.p === "gasto") {
    panel = (
      <Panel title="Cargar un gasto" closeHref={here}>
        <ExpensePanel fund={screen.view.address} agreedExpense={screen.view.agreedExpense} />
      </Panel>
    );
  } else if (search.p === "comprobante") {
    const item = screen.timeline.find((i) => i.id === search.id);
    if (item) {
      panel = (
        <Panel title="Comprobante" closeHref={here}>
          <Receipt item={item} now={new Date()} />
        </Panel>
      );
    }
  } else if (search.p === "cuenta") {
    panel = (
      <Panel title="Tu cuenta" closeHref={here}>
        <div className="grid gap-4">
          <p>Entraste como {user.name}.</p>
          <LogoutButton />
        </div>
      </Panel>
    );
  }

  // After your contribution is confirmed the web comes back with the balance it had before (the one moment, spec 9.2).
  const previousBalance = typeof search.aporte === "string" && /^\d{1,78}$/.test(search.aporte) ? BigInt(search.aporte) : undefined;
  return <FundScreenView screen={screen} user={user} panel={panel} previousBalance={previousBalance} />;
}
