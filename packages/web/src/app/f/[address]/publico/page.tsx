import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isAddress } from "viem";
import { FundScreenView } from "../../../../components/fund-screen";
import { PanelHost } from "../../../../components/panel-host";
import { receiptPanels } from "../../../../components/receipt";
import { getLocale } from "../../../../lib/i18n/server";
import { loadPublicFundScreen } from "../../../../lib/read-fund";

/** The real group's fund, read-only, for anyone (spec, 9.2): no actions and no chat. Its comprobantes open in place. */
export default async function PublicFundPage({ params }: { params: Promise<{ address: string }> }) {
  await connection(); // it reads the database and the chain, so it's never prerendered at build time
  const { address } = await params;
  if (!isAddress(address, { strict: false })) notFound();
  const screen = await loadPublicFundScreen(address, await getLocale());
  if (screen === null) notFound();
  const panel = <PanelHost closeHref={`/f/${screen.view.address}/publico`} receipts={receiptPanels(screen.timeline, new Date())} />;
  return <FundScreenView screen={screen} user={null} panel={panel} />;
}
