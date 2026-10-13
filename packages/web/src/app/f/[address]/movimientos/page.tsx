import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { isAddress } from "viem";
import { AgentButton, MobileBar, TabBar, TopBar } from "../../../../components/bars";
import { LiveFund } from "../../../../components/live-fund";
import { TimelineList } from "../../../../components/timeline-list";
import { Card, CardTitle } from "../../../../components/ui";
import { chatEnabled } from "../../../../lib/chat/model";
import { currentUser } from "../../../../lib/current-user";
import { loadFundScreen } from "../../../../lib/read-fund";
import { safeNext } from "../../../../lib/safe-next";

/** Every movement of the fund (spec, 9.2): the second tab of the bottom bar. */
export default async function MovementsPage({ params }: { params: Promise<{ address: string }> }) {
  await connection(); // it depends on who's asking and reads the chain, so it's never prerendered at build time
  const { address } = await params;
  if (!isAddress(address, { strict: false })) notFound();
  const user = await currentUser();
  if (user === null) redirect(`/entrar?next=${encodeURIComponent(safeNext(`/f/${address}/movimientos`))}`);
  const screen = await loadFundScreen(address, user);
  if (screen === null) notFound();
  const { view } = screen;
  const chat = chatEnabled();
  return (
    <div className="min-h-dvh pb-24 lg:pb-0">
      <TopBar fundName={view.name} address={view.address} userName={user.name} />
      <MobileBar fundName={view.name} address={view.address} userName={user.name} />
      <main className="mx-auto max-w-[560px] p-4 lg:max-w-[1120px] lg:p-7">
        <Card>
          <CardTitle>Movimientos</CardTitle>
          <TimelineList
            items={screen.timeline}
            fund={view.address}
            fundName={view.name}
            now={new Date()}
            closed={view.closed}
            basePath={`/f/${view.address}`}
            viewerName={user.name}
          />
        </Card>
      </main>
      <TabBar address={view.address} active="movimientos" chat={chat} />
      {chat && <AgentButton address={view.address} />}
      <LiveFund fund={view.address} block={screen.block} />
    </div>
  );
}
