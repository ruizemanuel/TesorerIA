import { describe, expect, it } from "vitest";
import { keyChangeSteps } from "../src/lib/client/key-change";
import type { Me } from "../src/lib/client/wallet";
import { LEGACY_RP_ID } from "../src/lib/passkey-sites";

const PENDING = { id: "pending", rpId: "tesoreria.finance", publicKey: "0xabcd" } as const;
const KEYS = { id: "old", publicKey: "0x1234", rpId: LEGACY_RP_ID } as const;

/** A member as /api/me describes them, with the key change in the state given. */
function member(keyChange: Partial<Me["keyChange"]>): Me {
  return {
    name: "Ema",
    account: "0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F",
    credential: KEYS,
    keyChange: { due: true, pending: null, ready: false, onItsWay: false, ...keyChange },
  };
}

describe("keyChangeSteps", () => {
  it("makes the new passkey first when there is none pending", () => {
    expect(keyChangeSteps(member({}))).toEqual(["create", "sign", "confirm"]);
  });

  it("goes straight to the swap when the pending passkey is one this session made or proved", () => {
    expect(keyChangeSteps(member({ pending: PENDING, ready: true }))).toEqual(["sign", "confirm"]);
  });

  it("first proves this device holds a pending passkey made in another visit", () => {
    expect(keyChangeSteps(member({ pending: PENDING, ready: false }))).toEqual(["prove", "sign", "confirm"]);
  });

  it("only confirms while a key change is on its way or landed: nothing is made or sent again", () => {
    // Whatever else is true of the pending passkey, the chain decides from here.
    expect(keyChangeSteps(member({ pending: PENDING, ready: false, onItsWay: true }))).toEqual(["confirm"]);
    expect(keyChangeSteps(member({ pending: PENDING, ready: true, onItsWay: true }))).toEqual(["confirm"]);
  });

  it("has nothing to do with nothing pending and nothing due: the change landed already, or isn't theirs to make", () => {
    // As /api/me answers once it confirmed a swap that landed after its page closed: no passkey may be made then.
    expect(keyChangeSteps({ ...member({ due: false }), credential: { ...KEYS, rpId: "tesoreria.finance" } })).toEqual([]);
    expect(keyChangeSteps(member({ due: false }))).toEqual([]);
  });
});
