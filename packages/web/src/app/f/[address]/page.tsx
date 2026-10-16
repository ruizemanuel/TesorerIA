import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { isAddress } from "viem";
import { AccountPanel } from "../../../components/account-panel";
import { AgentPanel } from "../../../components/agent-panel";
import { CashOutPanel } from "../../../components/cash-out-panel";
import { ContributePanel } from "../../../components/contribute-panel";
import { ExpensePanel } from "../../../components/expense-panel";
import { FundScreenView } from "../../../components/fund-screen";
import { PanelHost } from "../../../components/panel-host";
import { receiptPanels } from "../../../components/receipt";
import { summaryPanels } from "../../../components/summary-panels";
import { chatEnabled } from "../../../lib/chat/model";
import { currentUser } from "../../../lib/current-user";
import { getLocale, getMessages } from "../../../lib/i18n/server";
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
  const m = await getMessages();
  const locale = await getLocale();
  const screen = await loadFundScreen(address, user, { locale });
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
        cuenta: <AccountPanel userName={user.name} account={user.account} />,
        pesos: <CashOutPanel fund={screen.view.address} account={user.account} cashOutOnItsWay={screen.cashOutOnItsWay} />,
        agente: chat ? (
          <AgentPanel
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
      receipts={receiptPanels(screen.timeline, new Date(), m, locale)}
      summaries={summaryPanels(screen.weekSummaries, { shareable: true })}
    />
  );

  // After your contribution is confirmed the web comes back with the balance it had before (the one moment, spec 9.2).
  const previousBalance = typeof search.aporte === "string" && /^\d{1,78}$/.test(search.aporte) ? BigInt(search.aporte) : undefined;
  return <FundScreenView screen={screen} user={user} panel={panel} previousBalance={previousBalance} chat={chat} />;
}
