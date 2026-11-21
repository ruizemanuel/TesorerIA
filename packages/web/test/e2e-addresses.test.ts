import { CURRENCIES, POOL, USDT, WARS } from "@tesoreria/agent";
import { describe, expect, it } from "vitest";
import * as e2e from "../e2e/support";

describe("the end-to-end support's addresses", () => {
  it("are @tesoreria/agent's, which it repeats because serve.ts runs on plain Node", () => {
    const WMXN = CURRENCIES.find((currency) => currency.symbol === "wMXN")?.token;
    expect({ POOL: e2e.POOL, USDT: e2e.USDT, WARS: e2e.WARS, WMXN: e2e.WMXN }).toEqual({ POOL, USDT, WARS, WMXN });
  });
});
