import { eq } from "drizzle-orm";
import { type Address, getAddress } from "viem";
import { type CountryCode, DEFAULT_COUNTRY, countryOfCurrency } from "./countries";
import type { Db } from "./db/client";
import { funds } from "./db/schema";
import { draftById } from "./funds";

/** The country whose currency `currency` is, for whoever already has it: Argentina for one without a country here. */
export function countryCodeOf(currency: Address): CountryCode {
  return countryOfCurrency(currency)?.code ?? DEFAULT_COUNTRY;
}

/**
 * The country a fund speaks (spec, 6): its currency's, from its row, whatever its status. Argentina when no fund has
 * that address, as every page and route said before there was more than one country.
 */
export async function fundCountryOf(db: Db, address: Address): Promise<CountryCode> {
  const [fund] = await db.select({ currency: funds.currency }).from(funds).where(eq(funds.address, getAddress(address)));
  return fund === undefined ? DEFAULT_COUNTRY : countryCodeOf(getAddress(fund.currency));
}

/** The country of the draft `id`, whatever its status, or undefined without one: a route then speaks the request's. */
export async function draftCountryOf(db: Db, id: string): Promise<CountryCode | undefined> {
  const draft = await draftById(db, id);
  return draft === null ? undefined : countryCodeOf(draft.currency);
}
