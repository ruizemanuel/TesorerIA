import type { ReactNode } from "react";
import { isAddress } from "viem";
import { ChatProvider } from "../../../components/chat-provider";
import { RefreshProvider } from "../../../components/refresh-provider";
import { COUNTRIES, DEFAULT_COUNTRY } from "../../../lib/countries";
import { getDb } from "../../../lib/db/client";
import { fundCountryOf } from "../../../lib/fund-country";
import { LocaleProvider } from "../../../lib/i18n/client";
import { getLocale } from "../../../lib/i18n/server";

/**
 * A fund's pages share its chat (spec, 9.2): it lives here, so it outlasts the panel and the move to Movimientos.
 * Only its holder does: the AI SDK comes with the Agente panel, the first time it opens (agent-panel.tsx). They also
 * share their refresh, so a panel knows when one is on its way (RefreshProvider).
 *
 * They speak the fund's country, not the visitor's (spec, 6): the panels that run in the browser read it from this
 * provider, and the div's `lang` says it for everything below. The div is a plain block, and the body it sits in lays
 * out nothing by its children (no flex, no grid, no child selector), so the pages sit in it as they sat in the body.
 */
export default async function FundLayout({ children, params }: { children: ReactNode; params: Promise<{ address: string }> }) {
  const { address } = await params;
  const locale = await getLocale();
  // An address that isn't one is no fund (its page answers 404): Argentina, as for an address no fund has.
  const country = isAddress(address, { strict: false }) ? await fundCountryOf(await getDb(), address) : DEFAULT_COUNTRY;
  // Keyed by the fund: another fund gets its own conversation.
  return (
    <LocaleProvider locale={locale} country={country}>
      <div lang={COUNTRIES[country].htmlLang[locale]}>
        <RefreshProvider>
          <ChatProvider key={address.toLowerCase()} fund={address}>
            {children}
          </ChatProvider>
        </RefreshProvider>
      </div>
    </LocaleProvider>
  );
}
