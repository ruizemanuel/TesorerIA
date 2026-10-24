import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "../lib/current-user";
import { getLocale, getMessages } from "../lib/i18n/server";
import type { FundScreen } from "../lib/read-fund";
import { AgentButton, TabBar, TopBar } from "./bars";
import { FundHeader } from "./fund-header";
import { type KeyChangeAsk, KeyChangeCard } from "./key-change-card";
import { LanguageSwitch } from "./language-switch";
import { LiveFund } from "./live-fund";
import { RulesCard } from "./rules-card";
import { TimelineList } from "./timeline-list";
import { Card, CardTitle } from "./ui";
import { WeekList } from "./week-list";

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
  const now = new Date();
  return (
    <div className="min-h-dvh pb-24 lg:pb-0">
      <TopBar fundName={view.name} address={view.address} userName={userName} m={m} />
      {publicView && (
        // On a phone the notice lines up with the page, beside the switch; on a computer it's centered on the page,
        // with the switch in a column of its own.
        <div className="flex items-center gap-2 bg-tint px-4 text-sm lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <p className="flex-1 py-2 font-semibold text-pretty lg:col-start-2 lg:text-center">{m.fund.publicNotice}</p>
          <LanguageSwitch className="lg:justify-self-end" />
        </div>
      )}
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
            <WeekList view={view} justPaid={previousBalance !== undefined} m={m} locale={locale} />
            <Card className="lg:hidden">
              <CardTitle>{m.movements.latest}</CardTitle>
              <TimelineList
                items={timeline.slice(0, 3)}
                fund={view.address}
                fundName={view.name}
                now={now}
                readOnly={publicView}
                closed={view.closed}
                viewerName={userName}
                m={m}
                locale={locale}
              />
              {!publicView && timeline.length > 0 && (
                <Link
                  href={`/f/${view.address}/movimientos`}
                  className="inline-flex min-h-11 items-center text-[13px] font-bold text-primary"
                >
                  {m.movements.seeAll}
                </Link>
              )}
            </Card>
            <RulesCard view={view} m={m} locale={locale} />
          </div>
        </div>
        <Card className="hidden lg:block">
          <CardTitle>{m.movements.title}</CardTitle>
          <TimelineList
            items={timeline}
            fund={view.address}
            fundName={view.name}
            now={now}
            readOnly={publicView}
            closed={view.closed}
            viewerName={userName}
            m={m}
            locale={locale}
          />
        </Card>
      </main>
      {!publicView && <TabBar address={view.address} active="inicio" chat={chat} m={m} />}
      {!publicView && <LiveFund fund={view.address} block={screen.block} />}
      {!publicView && chat && <AgentButton address={view.address} m={m} />}
      {panel}
    </div>
  );
}
