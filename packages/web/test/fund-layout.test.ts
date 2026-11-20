import { type ReactElement, type ReactNode, createElement, isValidElement } from "react";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTRIES } from "../src/lib/countries";
import { LocaleProvider } from "../src/lib/i18n/client";
import { addLiveFund, addUser, randomAccount, testDb } from "./support/db";

// The layout as the server renders it: the database stands in, and can fail as a slow or busy one does.
const state = vi.hoisted(() => ({ db: null as unknown, dbError: null as Error | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => {
    if (state.dbError !== null) throw state.dbError;
    return state.db;
  },
}));

const { default: FundLayout } = await import("../src/app/f/[address]/layout");

type Props = { children?: ReactNode; country?: string; lang?: string };

/** Whether `node` has `target` somewhere below it, through each element's children. */
function holds(node: ReactNode, target: ReactNode): boolean {
  if (node === target) return true;
  if (Array.isArray(node)) return node.some((child) => holds(child, target));
  return isValidElement<Props>(node) && holds(node.props.children, target);
}

const PAGE = createElement("p", null, "the fund's page");
const render = async (address: string) => (await FundLayout({ children: PAGE, params: Promise.resolve({ address }) })) as ReactElement<Props>;

let errors: MockInstance<typeof console.error>;

beforeEach(async () => {
  state.db = await testDb();
  state.dbError = null;
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe("the fund's layout (spec, 6)", () => {
  it("speaks a wMXN fund's country to its pages, with its lang", async () => {
    const db = state.db as Awaited<ReturnType<typeof testDb>>;
    const ana = await addUser(db, "Ana");
    const address = randomAccount();
    await addLiveFund(db, { creatorId: ana.id, address, members: [ana.id], version: 2, currency: COUNTRIES.MX.currency.token });
    const tree = await render(address);
    expect(tree.type).toBe(LocaleProvider);
    expect(tree.props.country).toBe("MX");
    expect((tree.props.children as ReactElement<Props>).props.lang).toBe("es-MX");
    expect(holds(tree, PAGE)).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it("still renders its pages when the database can't answer, in the root's country, and logs it", async () => {
    // The page's own read meets the same trouble inside the fund's error boundary (error.tsx), which retries by itself.
    state.dbError = new Error("the database took too long");
    const address = randomAccount();
    const tree = await render(address);
    expect(tree.props.country).toBe("AR"); // what the root layout speaks to this visitor: no IP, Argentina
    expect((tree.props.children as ReactElement<Props>).props.lang).toBe("es-AR");
    expect(holds(tree, PAGE)).toBe(true);
    expect(errors.mock.calls).toEqual([[`The fund's layout could not read the country of ${address}: the database took too long`]]);
  });
});
