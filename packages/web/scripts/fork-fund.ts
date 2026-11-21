// The fund chat-check.ts --fork asks about: a Mexican one, in wMXN, created on this machine's anvil fork of Celo and
// kept in an in-memory database. Mexico isn't offered yet, so there's no real fund in Mexican pesos to read.
// It goes the web's own way wherever the web has one: the draft, the joins, the createFund call and its confirmation
// are funds.ts's, at Mexico's defaults (countries.ts), so the fund has exactly the terms a Mexican draft gets. The rest
// is the fork's, as in the e2e (e2e/support.ts): the members' wMXN is written into the token's storage, and every
// transaction is an eth_sendTransaction from an account anvil impersonates. Nothing here holds a key or signs, so
// none of it could reach Celo itself: only an anvil takes such a transaction.
import { randomBytes } from "node:crypto";
import { FEE_BPS, FUND_FACTORY_V2, fundV2Abi } from "@tesoreria/agent";
import { type Address, BaseError, createPublicClient, encodeFunctionData, erc20Abi, getAddress, http, keccak256, toHex, zeroAddress } from "viem";
import { celo } from "viem/chains";
import { FORK_PORT, FORK_RPC, WMXN, asAccount, setTokenBalance } from "../e2e/support";
import { celoClient } from "../src/lib/chain";
import { withFee } from "../src/lib/contribute";
import { COUNTRIES } from "../src/lib/countries";
import type { CurrentUser } from "../src/lib/current-user";
import { getDb } from "../src/lib/db/client";
import { users } from "../src/lib/db/schema";
import { env } from "../src/lib/env";
import { ProposalAction } from "../src/lib/fund-abi";
import { type FundsResult, confirmDeploy, createDraft, deployCall, joinFund } from "../src/lib/funds";
import { messagesFor } from "../src/lib/i18n/messages";

/** A failure of the fork's setup: its message is the script's own, and says what's wrong. */
export class ForkError extends Error {
  override name = "ForkError";
}

const MEXICO = COUNTRIES.MX;
const UNIT = 10n ** 18n;

/** The group's fund, at Mexico's defaults: each one puts in $100 a week, and the agent pays back up to $600 a week. */
const FUND = { name: "Fútbol de los jueves", agreedExpense: "la cancha", ...MEXICO.defaults };
/** What the agent paid Beto back of the cancha: $480 of the week's cap is left. */
const REIMBURSED = 120n * UNIT;
/** The payment to Caro the agent proposed for another expense, which nobody has voted yet. */
const PROPOSED = { amount: 80n * UNIT, note: "agua para el partido" };

/** The names an RPC URL's host has when it's this machine. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Refuses anything but this machine's anvil forking Celo: CHAIN_MODE=fork; CELO_RPC_URL on this machine, at the port
 * e2e/support.ts writes to; DATABASE_URL in memory, so the fund's rows go nowhere else; and a node there that says it's
 * an anvil, on Celo's chain, with FundFactoryV2 deployed. It says what's wrong, never a setting's value. First it fills
 * in what the settings require and the check never uses, since it has no sessions or passkeys: what serve.ts gives the
 * web on the fork, when the env file has none. So it runs before anything else reads the settings (env()).
 */
async function checkLocalFork(): Promise<void> {
  process.env.RP_ID ||= "localhost";
  process.env.ORIGIN ||= "http://localhost:3000";
  process.env.SESSION_SECRET ||= randomBytes(32).toString("hex");
  const settings = env();
  if (settings.CHAIN_MODE !== "fork") throw new ForkError("--fork runs only with CHAIN_MODE=fork");
  const rpc = new URL(settings.CELO_RPC_URL);
  if (!LOOPBACK.has(rpc.hostname) || Number(rpc.port) !== FORK_PORT) {
    throw new ForkError(`--fork reads the chain only from this machine's anvil: CELO_RPC_URL must be ${FORK_RPC}`);
  }
  if ((settings.DATABASE_URL ?? "memory") !== "memory") {
    throw new ForkError("--fork keeps its fund in memory only: DATABASE_URL must be memory, or unset");
  }
  const node = createPublicClient({ chain: celo, transport: http(FORK_RPC, { retryCount: 0 }) });
  let version: string;
  try {
    version = await node.request({ method: "web3_clientVersion" });
  } catch (error) {
    if (!(error instanceof BaseError)) throw error;
    throw new ForkError(`Nothing answers on ${FORK_RPC}: start the anvil fork first (see the top of chat-check.ts)`);
  }
  if (!version.startsWith("anvil/")) throw new ForkError(`The node on ${FORK_RPC} isn't an anvil`);
  if ((await node.getChainId()) !== celo.id) throw new ForkError(`The anvil on ${FORK_RPC} isn't a fork of Celo`);
  if ((await node.getCode({ address: FUND_FACTORY_V2 })) === undefined) {
    throw new ForkError(`The anvil on ${FORK_RPC} has no FundFactoryV2: it must fork Celo mainnet`);
  }
}

/** What a funds.ts step returned, or why the fork's setup stops there. */
function passed<T>(result: FundsResult<T>, step: string): T {
  if (!result.ok) throw new ForkError(`${step} was refused (${result.status}): ${result.error}`);
  return result;
}

/** A fresh account on the fork: no key, since anvil impersonates it (asAccount). */
const anyone = (): Address => getAddress(toHex(randomBytes(20)));

/**
 * Creates the Mexican fund on the fork and keeps it in the database, and returns it with its first member, Ana, who
 * asks; before anything else reads the settings, since it fills some in (checkLocalFork). Three members (Ana, Beto and Caro, joined in that order), 2 votes and a fresh agent. Ana and Beto paid this
 * week's $100, whole after the fee, so Caro owes hers. The agent paid Beto back $120 of the cancha and proposed paying
 * Caro $80 for the water, which nobody has voted yet; the reimbursement is the last movement.
 */
export async function mexicanForkFund(): Promise<{ address: Address; viewer: CurrentUser }> {
  await checkLocalFork();
  const db = await getDb();
  const m = messagesFor("es", MEXICO.code);
  async function person(name: string): Promise<CurrentUser> {
    const [row] = await db.insert(users).values({ name, account: anyone() }).returning();
    return { id: row!.id, name: row!.name, account: getAddress(row!.account) };
  }
  const ana = await person("Ana");
  const beto = await person("Beto");
  const caro = await person("Caro");

  // The web's way: Ana's draft in Mexico's currency, with its cap; Beto and Caro join by its link; Ana deploys it.
  const draft = passed(await createDraft(db, ana.id, FUND, m), "The draft");
  for (const member of [beto, caro]) passed(await joinFund(db, member.id, draft.inviteCode, m), `${member.name}'s join`);
  const agent = anyone();
  const { call } = passed(await deployCall(db, { fundId: draft.id, userId: ana.id, votesRequired: 2, agent, m }), "The createFund call");
  const transactionHash = await asAccount(ana.account, call.to, call.data);
  const { address: fund } = passed(
    await confirmDeploy(db, { fundId: draft.id, userId: ana.id, transactionHash, client: celoClient(), agent, m }),
    "The fund's confirmation",
  );

  // Ana and Beto contribute this week's fee, whole after the fund's (withFee), from wMXN the fork gives them.
  const contribution = withFee(FUND.weeklyFee, FEE_BPS);
  for (const member of [ana, beto]) {
    await setTokenBalance(WMXN, member.account, contribution);
    await asAccount(member.account, WMXN, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [fund, contribution] }));
    await asAccount(member.account, fund, encodeFunctionData({ abi: fundV2Abi, functionName: "contribute", args: [contribution] }));
  }

  // The agent, as it does for an expense entered in the web: a payment proposed for another one, then the agreed one
  // paid back, with a ref made as an expense's is (keccak256 of an id, here a random one).
  const proposal = [ProposalAction.Pay, caro.account, zeroAddress, PROPOSED.amount, PROPOSED.note] as const;
  await asAccount(agent, fund, encodeFunctionData({ abi: fundV2Abi, functionName: "propose", args: proposal }));
  const reimbursement = [beto.account, REIMBURSED, keccak256(toHex(randomBytes(16)))] as const;
  await asAccount(agent, fund, encodeFunctionData({ abi: fundV2Abi, functionName: "reimburseAgreedExpense", args: reimbursement }));

  console.log(
    `On the fork: "${FUND.name}", a wMXN fund at ${fund}, with Ana, Beto and Caro and 2 votes. Ana and Beto paid this ` +
      "week's $100, the agent proposed paying Caro $80 and paid Beto back $120 of the cancha. Ana asks.",
  );
  return { address: fund, viewer: ana };
}
