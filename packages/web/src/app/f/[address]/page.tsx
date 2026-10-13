import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { isAddress } from "viem";
import { ChatPanel } from "../../../components/chat-panel";
import { ContributePanel } from "../../../components/contribute-panel";
import { ExpensePanel } from "../../../components/expense-panel";
import { FundScreenView } from "../../../components/fund-screen";
import { LogoutButton } from "../../../components/logout-button";
import { PanelHost } from "../../../components/panel-host";
import { receiptPanels } from "../../../components/receipt";
import { chatEnabled } from "../../../lib/chat/model";
import { currentUser } from "../../../lib/current-user";
import { loadFundScreen } from "../../../lib/read-fund";
import { safeNext } from "../../../lib/safe-next";

type Search = { aporte?: string };

/**
 * The inicio of a fund (spec, 9.2). The panels (`?p=…`) live in the URL, so the back button closes them, but they
 * open and close in the browser (PanelHost): their content comes with the page.
 */
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
  const chat = chatEnabled();

  const panel = (
    <PanelHost
      closeHref={here}
      panels={{
        aportar: (
          <ContributePanel
            fund={screen.view.address}
            account={user.account}
            balance={screen.view.balance}
            owed={screen.view.me?.owed ?? 0n}
            weeklyFee={screen.view.weeklyFee}
            contributionOnItsWay={screen.contributionOnItsWay}
          />
        ),
        gasto: <ExpensePanel fund={screen.view.address} agreedExpense={screen.view.agreedExpense} />,
        cuenta: (
          <div className="grid gap-4">
            <p>Entraste como {user.name}.</p>
            <LogoutButton />
          </div>
        ),
        agente: chat ? (
          <ChatPanel
            fund={screen.view.address}
            userName={user.name}
            rules={{
              agreedExpense: screen.view.agreedExpense,
              leftThisWeek: screen.view.leftThisWeek,
              votesRequired: screen.view.votesRequired,
              members: screen.view.rows.length,
            }}
          />
        ) : undefined,
      }}
      receipts={receiptPanels(screen.timeline, new Date())}
    />
  );

  // After your contribution is confirmed the web comes back with the balance it had before (the one moment, spec 9.2).
  const previousBalance = typeof search.aporte === "string" && /^\d{1,78}$/.test(search.aporte) ? BigInt(search.aporte) : undefined;
  return <FundScreenView screen={screen} user={user} panel={panel} previousBalance={previousBalance} chat={chat} />;
}
