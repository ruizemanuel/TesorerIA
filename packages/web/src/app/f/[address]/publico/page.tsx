import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isAddress } from "viem";
import { FundScreenView } from "../../../../components/fund-screen";
import { Panel } from "../../../../components/panel";
import { Receipt } from "../../../../components/receipt";
import { loadFundScreen } from "../../../../lib/read-fund";

/** The real group's fund, read-only, for anyone (spec, 9.2): no actions and no chat. */
export default async function PublicFundPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ p?: string; id?: string }>;
}) {
  await connection(); // it reads the database and the chain, so it's never prerendered at build time
  const { address } = await params;
  const { p, id } = await searchParams;
  if (!isAddress(address, { strict: false })) notFound();
  const screen = await loadFundScreen(address, null, { publicView: true });
  if (screen === null) notFound();
  const item = p === "comprobante" ? screen.timeline.find((i) => i.id === id) : undefined;
  const panel = item ? (
    <Panel title="Comprobante" closeHref={`/f/${screen.view.address}/publico`}>
      <Receipt item={item} now={new Date()} />
    </Panel>
  ) : null;
  return <FundScreenView screen={screen} user={null} panel={panel} />;
}
