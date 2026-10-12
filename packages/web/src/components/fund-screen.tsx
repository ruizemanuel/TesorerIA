import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "../lib/current-user";
import type { FundScreen } from "../lib/read-fund";
import { TabBar, TopBar } from "./bars";
import { FundHeader } from "./fund-header";
import { RulesCard } from "./rules-card";
import { TimelineList } from "./timeline-list";
import { Card, CardTitle } from "./ui";
import { WeekList } from "./week-list";

/**
 * The inicio (spec, 9.2): one column with the bottom bar up to 1023 px, 16 px from the edges and 560 px wide at
 * most; from 1024 px, the top bar and two columns, the fund on the left (380 px) and the movements on the right.
 */
export function FundScreenView({
  screen,
  user,
  panel,
  previousBalance,
}: {
  screen: FundScreen;
  user: CurrentUser | null;
  panel?: ReactNode;
  previousBalance?: bigint;
}) {
  const { view, timeline, publicView } = screen;
  const userName = publicView ? undefined : user?.name;
  const now = new Date();
  return (
    <div className="min-h-dvh pb-24 lg:pb-0">
      <TopBar fundName={view.name} address={view.address} userName={userName} />
      {publicView && <p className="bg-tint px-4 py-2 text-center text-sm font-semibold">Estás viendo un fondo real, en solo lectura.</p>}
      <main className="grid gap-3 lg:mx-auto lg:max-w-[1120px] lg:grid-cols-[380px_1fr] lg:items-start lg:gap-4 lg:p-7">
        <div className="grid gap-3 lg:gap-4">
          <FundHeader
            view={view}
            readOnly={publicView}
            previousBalance={previousBalance}
            userName={userName}
            account={publicView ? undefined : user?.account}
          />
          <div className="mx-auto grid w-full max-w-[560px] gap-3 px-4 lg:max-w-none lg:gap-4 lg:px-0">
            <WeekList view={view} justPaid={previousBalance !== undefined} />
            <Card className="lg:hidden">
              <CardTitle>Lo último del agente</CardTitle>
              <TimelineList
                items={timeline.slice(0, 3)}
                fund={view.address}
                fundName={view.name}
                now={now}
                readOnly={publicView}
                closed={view.closed}
                viewerName={userName}
              />
              {!publicView && timeline.length > 0 && (
                <Link
                  href={`/f/${view.address}/movimientos`}
                  className="inline-flex min-h-11 items-center text-[13px] font-bold text-primary"
                >
                  Ver todos
                </Link>
              )}
            </Card>
            <RulesCard view={view} />
          </div>
        </div>
        <Card className="hidden lg:block">
          <CardTitle>Movimientos</CardTitle>
          <TimelineList
            items={timeline}
            fund={view.address}
            fundName={view.name}
            now={now}
            readOnly={publicView}
            closed={view.closed}
            viewerName={userName}
          />
        </Card>
      </main>
      {!publicView && <TabBar address={view.address} active="inicio" />}
      {panel}
    </div>
  );
}
