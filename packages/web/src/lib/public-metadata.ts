import type { Metadata } from "next";
import { isAddress } from "viem";
import { getLocale, getMessages } from "./i18n/server";
import { loadPublicFundScreen } from "./read-fund";

/**
 * A fund's public pages, titled with its name in the link preview (spec, 9.6), in the fund's country (spec, 6). Its read
 * is the page's own, kept for 45 seconds, so the title costs no other read of the chain. A fund that isn't public keeps
 * the site's title.
 */
export async function publicFundMetadata(address: string): Promise<Metadata> {
  if (!isAddress(address, { strict: false })) return {};
  const screen = await loadPublicFundScreen(address, await getLocale());
  if (screen === null) return {};
  const m = await getMessages(screen.country);
  const { name } = screen.view;
  return { title: name, description: m.meta.publicDescription(name) };
}
