import { WARS } from "@tesoreria/agent";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { COUNTRIES, countryOfCurrency, offeredCountries, requestCountry } from "../src/lib/countries";

describe("countries", () => {
  it("finds each country by its currency, and nothing for wBRL or an unknown token", () => {
    expect(countryOfCurrency(WARS)?.code).toBe("AR");
    expect(countryOfCurrency(getAddress("0x337E7456B420bD3481e7FA61fA9850343d610d34"))?.code).toBe("MX");
    expect(countryOfCurrency("0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0")).toBeUndefined();
  });

  it("offers the countries whose currency is offered, plus the extra ones", () => {
    expect(offeredCountries([])).toEqual(["AR"]);
    expect(offeredCountries(["MX"])).toEqual(["AR", "MX"]);
  });

  it("takes the IP's country only when it's offered", () => {
    expect(requestCountry("MX", ["AR"])).toBe("AR");
    expect(requestCountry("mx", ["AR", "MX"])).toBe("MX");
    expect(requestCountry(null, ["AR", "MX"])).toBe("AR");
    expect(requestCountry("BR", ["AR", "MX"])).toBe("AR");
  });

  it("keeps each country's defaults under its currency's balance cap", () => {
    for (const c of Object.values(COUNTRIES)) expect(c.defaults.weeklyCap <= c.currency.limits.balanceCap).toBe(true);
  });
});
