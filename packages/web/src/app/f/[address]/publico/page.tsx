import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isAddress } from "viem";
import { FundScreenView } from "../../../../components/fund-screen";
import { PanelHost } from "../../../../components/panel-host";
import { receiptPanels } from "../../../../components/receipt";
import { getLocale, getMessages } from "../../../../lib/i18n/server";
import { loadPublicFundScreen } from "../../../../lib/read-fund";

/** The real group's fund, read-only, for anyone (spec, 9.2): no actions and no chat. Its comprobantes open in place. */
export default async function PublicFundPage({ params }: { params: Promise<{ address: string }> }) {
  await connection(); // it reads the database and the chain, so it's never prerendered at build time
  const { address } = await params;
  if (!isAddress(address, { strict: false })) notFound();
  const m = await getMessages();
  const locale = await getLocale();
  const screen = await loadPublicFundScreen(address, locale);
  if (screen === null) notFound();
  const receipts = receiptPanels(screen.timeline, new Date(), m, locale);
  const panel = <PanelHost closeHref={`/f/${screen.view.address}/publico`} receipts={receipts} />;
  return <FundScreenView screen={screen} user={null} panel={panel} />;
}
