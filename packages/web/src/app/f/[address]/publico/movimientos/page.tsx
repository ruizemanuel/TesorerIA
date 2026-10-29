import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isAddress } from "viem";
import { MobileBar, TopBar } from "../../../../../components/bars";
import { PublicNotice } from "../../../../../components/public-notice";
import { TimelineList } from "../../../../../components/timeline-list";
import { BackArrow, Card, CardTitle } from "../../../../../components/ui";
import { getLocale, getMessages } from "../../../../../lib/i18n/server";
import { publicFundMetadata } from "../../../../../lib/public-metadata";
import { loadPublicFundScreen } from "../../../../../lib/read-fund";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  return publicFundMetadata((await params).address);
}

/**
 * Every movement of the real group's fund, read-only, for anyone (spec, 9.6): where the public view's Ver todos goes.
 * The arrow goes back to it, and its comprobantes and summaries open over it, as Movimientos opens them over the inicio.
 */
export default async function PublicMovementsPage({ params }: { params: Promise<{ address: string }> }) {
  await connection(); // it reads the database and the chain, so it's never prerendered at build time
  const { address } = await params;
  if (!isAddress(address, { strict: false })) notFound();
  const m = await getMessages();
  const locale = await getLocale();
  const screen = await loadPublicFundScreen(address, locale);
  if (screen === null) notFound();
  const { view } = screen;
  const home = `/f/${view.address}/publico`;
  return (
    <div className="min-h-dvh">
      <TopBar fundName={view.name} address={view.address} m={m} />
      <PublicNotice m={m} />
      <MobileBar fundName={view.name} address={view.address} m={m} />
      <main className="mx-auto max-w-[560px] p-4 lg:max-w-[1120px] lg:p-7">
        <Card>
          <div className="-ml-3 -mt-2 flex items-center gap-1">
            <Link href={home} aria-label={m.panels.back} className="grid size-11 place-items-center rounded-full text-primary">
              <BackArrow />
            </Link>
            <CardTitle>{m.movements.title}</CardTitle>
          </div>
          <TimelineList
            items={screen.timeline}
            fund={view.address}
            fundName={view.name}
            now={new Date()}
            readOnly
            closed={view.closed}
            basePath={home}
            m={m}
            locale={locale}
          />
        </Card>
      </main>
    </div>
  );
}
