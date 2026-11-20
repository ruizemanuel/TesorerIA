import { shortMessage } from "@tesoreria/agent";
import type { ReactNode } from "react";
import { isAddress } from "viem";
import { ChatProvider } from "../../../components/chat-provider";
import { RefreshProvider } from "../../../components/refresh-provider";
import { COUNTRIES, type CountryCode, DEFAULT_COUNTRY } from "../../../lib/countries";
import { getDb } from "../../../lib/db/client";
import { fundCountryOf } from "../../../lib/fund-country";
import { LocaleProvider } from "../../../lib/i18n/client";
import { getLocale, getPageCountry } from "../../../lib/i18n/server";

/**
 * The country a fund's pages speak: the fund's (spec, 6). This layout sits outside the fund's error boundary (error.tsx
 * catches its pages, not it), so a read that fails here must not take the pages down: they get the root layout's
 * country instead, the visitor's, and the page's own read meets the trouble inside that boundary, which retries by
 * itself (spec, 9.2). The provider stays either way, so the layout's tree keeps its shape and a later refresh that reads
 * the country doesn't remount the chat below it.
 */
async function pagesCountry(address: string): Promise<CountryCode> {
  // An address that isn't one is no fund (its page answers 404): Argentina, as for an address no fund has.
  if (!isAddress(address, { strict: false })) return DEFAULT_COUNTRY;
  try {
    return await fundCountryOf(await getDb(), address);
  } catch (error) {
    console.error(`The fund's layout could not read the country of ${address}: ${shortMessage(error)}`);
    return getPageCountry();
  }
}

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
  const [locale, country] = await Promise.all([getLocale(), pagesCountry(address)]);
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
