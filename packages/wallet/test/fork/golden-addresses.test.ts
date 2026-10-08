import { type Address, type Hex, createPublicClient, http, keccak256 } from "viem";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { celo } from "viem/chains";
import { describe, expect, it } from "vitest";
import { type AccountKind, createMemberAccount } from "../../src";
import { ANVIL_RPC_URL } from "../support/anvil.globalSetup";

type Vector = {
  label: string;
  kind: AccountKind;
  credential: { id: string; publicKey: Hex };
  address: Address;
  factory: Address;
  factoryDataHash: Hex;
};

// An uncompressed P-256 point without the 0x04 prefix, derived once from a throwaway test key
// that was not kept: nothing is signed here.
const TEST_PUBLIC_KEY: Hex =
  "0xc64cf14102e2fefb04776dd590a2b617b9d06e7e2aeb8f62f90ccc2511d2db0a67b555a6706f3b23206c8134f4b7bfc75b7c175189ce09ef650892de0c0a86a8";
const TEST_CREDENTIAL = { id: "AAECAwQFBgcICQoLDA0ODw", publicKey: TEST_PUBLIC_KEY };

// Pins the account derivation: change these only on purpose, because it moves every member's address.
const VECTORS: Vector[] = [
  {
    label: "safe",
    kind: "safe",
    credential: TEST_CREDENTIAL,
    address: "0x693569C3ee50b00eBA1Ea48abD418FbcAf91f655",
    factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    factoryDataHash: "0x1705c3074e4ad779bbd3d900f2a54cb40be6efa2f6d58ba201f9b0480cfc1c6f",
  },
  {
    label: "kernel",
    kind: "kernel",
    credential: TEST_CREDENTIAL,
    address: "0x9a4ee2b61C72C9B931f5a94Ed9b7639ea4cCE0c2",
    factory: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
    factoryDataHash: "0x08efddcb0d1ea9b16cab7ff66a3af4ecdae41f6f0533f101cbe81ad244c31eae",
  },
];

const publicClient = createPublicClient({ chain: celo, transport: http(ANVIL_RPC_URL) });

describe("account derivation (golden addresses)", () => {
  it.each(VECTORS)("$label account keeps its address, factory and init code", async (vector) => {
    const account = await createMemberAccount({
      client: publicClient,
      owner: toWebAuthnAccount({ credential: vector.credential }),
      kind: vector.kind,
    });
    const { factory, factoryData } = await account.getFactoryArgs();
    const actual = { address: account.address, factory, factoryDataHash: keccak256(factoryData!) };

    expect(actual).toStrictEqual({
      address: vector.address,
      factory: vector.factory,
      factoryDataHash: vector.factoryDataHash,
    });
  });
});
