import type { ReactNode } from "react";
import type { CurrentUser } from "../lib/current-user";
import { getLocale, getMessages } from "../lib/i18n/server";
import type { FundScreen } from "../lib/read-fund";
import { splitYourTurn } from "../lib/timeline";
import { AgentButton, TabBar, TopBar } from "./bars";
import { FundHeader } from "./fund-header";
import { type KeyChangeAsk, KeyChangeCard } from "./key-change-card";
import { LatestMovements, movementsPath } from "./latest-movements";
import { LiveFund } from "./live-fund";
import { PublicNotice } from "./public-notice";
import { RulesCard } from "./rules-card";
import { Card, CardTitle } from "./ui";
import { WeekList } from "./week-list";
import { YourTurn } from "./your-turn";

/** The phone's card under the week (spec, 9.2). */
const PHONE_LATEST = 3;
/**
 * The computer's column (spec, 9.6): about as tall as the fund's column beside it, for a group of 8. The rest is
 * one link away, so the page doesn't keep growing with every week.
 */
const DESKTOP_LATEST = 8;

/**
 * The inicio (spec, 9.2): one column with the bottom bar up to 1023 px, 16 px from the edges and 560 px wide at
 * most; from 1024 px, the top bar and two columns, the fund on the left (380 px) and the movements on the right.
 */
export async function FundScreenView({
  screen,
  user,
  panel,
  previousBalance,
  chat = false,
  keyChange,
}: {
  screen: FundScreen;
  user: CurrentUser | null;
  panel?: ReactNode;
  previousBalance?: bigint;
  chat?: boolean;
  /** The member's request to swap the passkey of the old site for one of this one (spec, 9.5). Not for a public view. */
  keyChange?: KeyChangeAsk;
}) {
  const m = await getMessages();
  const locale = await getLocale();
  const { view, timeline, publicView } = screen;
  const userName = publicView ? undefined : user?.name;
  // What waits for the viewer goes up to Te toca (spec, 9.8), and the latest show the rest, without repeating it.
  const { yourTurn, rest } = splitYourTurn(timeline, { closed: view.closed });
  const list = {
    fund: view.address,
    fundName: view.name,
    now: new Date(),
    readOnly: publicView,
    closed: view.closed,
    viewerName: userName,
    m,
    locale,
  };
  const movements = { ...list, items: rest, href: movementsPath(view.address, publicView) };
  return (
    <div className="min-h-dvh pb-24 lg:pb-0">
      <TopBar fundName={view.name} address={view.address} userName={userName} m={m} />
      {publicView && <PublicNotice m={m} />}
      <main className="grid gap-3 lg:mx-auto lg:max-w-[1120px] lg:grid-cols-[380px_1fr] lg:items-start lg:gap-4 lg:p-7">
        <div className="grid gap-3 lg:gap-4">
          <FundHeader
            view={view}
            readOnly={publicView}
            previousBalance={previousBalance}
            userName={userName}
            account={publicView ? undefined : user?.account}
            m={m}
            locale={locale}
          />
          <div className="mx-auto grid w-full max-w-[560px] gap-3 px-4 lg:max-w-none lg:gap-4 lg:px-0">
            {!publicView && keyChange !== undefined && <KeyChangeCard due={keyChange.due} resume={keyChange.resume} />}
            <YourTurn items={yourTurn} {...list} />
            <WeekList view={view} justPaid={previousBalance !== undefined} m={m} locale={locale} />
            <Card className="lg:hidden">
              <CardTitle>{m.movements.latest}</CardTitle>
              <LatestMovements shown={PHONE_LATEST} {...movements} />
            </Card>
            <RulesCard view={view} m={m} locale={locale} />
          </div>
        </div>
        <Card className="hidden lg:block">
          <CardTitle>{m.movements.title}</CardTitle>
          <LatestMovements shown={DESKTOP_LATEST} {...movements} />
        </Card>
      </main>
      {!publicView && <TabBar address={view.address} active="inicio" chat={chat} m={m} />}
      {!publicView && <LiveFund fund={view.address} block={screen.block} />}
      {!publicView && chat && <AgentButton address={view.address} m={m} />}
      {panel}
    </div>
  );
}
