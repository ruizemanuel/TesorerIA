import {
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  encodeDeployData,
  getAddress,
  isAddressEqual,
  parseAbi,
} from "viem";
import { fundFactoryV2Abi } from "./abi";
import {
  CELO_CHAIN_ID,
  FEE_RECIPIENT,
  type Factory,
  POOL,
  POOL_FEE,
  TWAP_WINDOW,
  UNISWAP_V3_FACTORY,
  USDT,
  WARS,
} from "./chain";
import { type Currency, MIN_POOL_HISTORY } from "./currencies";

const uniswapV3FactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function observations(uint256 index) view returns (uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized)",
]);

/** The two reads `checkPool` needs from a Celo client. */
export type ChainReader = Pick<PublicClient, "getChainId" | "readContract">;

/**
 * The checks before deploying: we are on Celo mainnet, `POOL` is the wARS/USDT 0.01% pool that the official
 * UniswapV3Factory returns, with wARS as token0 (as the contracts' tests assume), and it can serve the fund's
 * 30-minute TWAP right now. Throws on the first failure; returns the pool's observation cardinality, to print.
 */
export async function checkPool(client: ChainReader): Promise<{ cardinality: number; cardinalityNext: number }> {
  const chainId = await client.getChainId();
  if (chainId !== CELO_CHAIN_ID) throw new Error(`Expected Celo mainnet (${CELO_CHAIN_ID}), got chain ${chainId}`);

  const official = await client.readContract({
    address: UNISWAP_V3_FACTORY,
    abi: uniswapV3FactoryAbi,
    functionName: "getPool",
    args: [WARS, USDT, POOL_FEE],
  });
  if (getAddress(official) !== getAddress(POOL)) {
    throw new Error(`UniswapV3Factory.getPool(wARS, USDT, ${POOL_FEE}) returns ${official}, not ${POOL}`);
  }

  const [token0, token1] = await Promise.all([
    client.readContract({ address: POOL, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: POOL, abi: poolAbi, functionName: "token1" }),
  ]);
  if (getAddress(token0) !== getAddress(WARS) || getAddress(token1) !== getAddress(USDT)) {
    throw new Error(`The pool's tokens are ${token0} / ${token1}, expected wARS / USDT`);
  }

  const [, , , cardinality, cardinalityNext] = await client.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "slot0",
  });
  try {
    await client.readContract({ address: POOL, abi: poolAbi, functionName: "observe", args: [[TWAP_WINDOW, 0]] });
  } catch (error) {
    throw new Error(`The pool can't serve a ${TWAP_WINDOW}-second TWAP right now`, { cause: error });
  }
  return { cardinality, cardinalityNext };
}

/** The part of a factory's artifact that `forge build` writes to contracts/out/<Name>.sol/<Name>.json. */
export type FactoryArtifact = { abi: Abi; bytecode: { object: Hex } };

/** Creation data for `FundFactory(wARS, USDT, POOL)`, without the attribution suffix (the signer adds it). */
export function factoryDeployData(artifact: FactoryArtifact): Hex {
  return encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [WARS, USDT, POOL] });
}

/**
 * The checks before a FundFactoryV2 can serve a currency's dollar entry: we are on Celo mainnet, `currency.dollar`'s
 * pool is the one the official UniswapV3Factory returns for the pair at that fee, it can serve the fund's 30-minute
 * TWAP right now, and it has at least `MIN_POOL_HISTORY` of history, measured on its oldest stored observation
 * against the latest block. That observation is the one after the latest (`(observationIndex + 1) % cardinality`),
 * or the first if that one was never written. Throws on the first failure; returns the pool's cardinality and the
 * oldest observation's age in seconds, to print.
 */
export async function checkDollarPool(
  client: ChainReader & Pick<PublicClient, "getBlock">,
  currency: Currency,
): Promise<{ cardinality: number; oldestAge: bigint }> {
  const chainId = await client.getChainId();
  if (chainId !== CELO_CHAIN_ID) throw new Error(`Expected Celo mainnet (${CELO_CHAIN_ID}), got chain ${chainId}`);
  const { dollar } = currency;
  if (dollar === null) throw new Error(`${currency.symbol} has no dollar entry`);

  const official = await client.readContract({
    address: UNISWAP_V3_FACTORY,
    abi: uniswapV3FactoryAbi,
    functionName: "getPool",
    args: [currency.token, dollar.token, dollar.poolFee],
  });
  if (!isAddressEqual(official, dollar.pool)) {
    throw new Error(
      `UniswapV3Factory.getPool(${currency.symbol}, dollar, ${dollar.poolFee}) returns ${official}, not ${dollar.pool}`,
    );
  }

  const [token0, token1] = await Promise.all([
    client.readContract({ address: dollar.pool, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: dollar.pool, abi: poolAbi, functionName: "token1" }),
  ]);
  const isPair =
    (isAddressEqual(token0, currency.token) && isAddressEqual(token1, dollar.token)) ||
    (isAddressEqual(token0, dollar.token) && isAddressEqual(token1, currency.token));
  if (!isPair) throw new Error(`The pool's tokens are ${token0} / ${token1}, expected ${currency.symbol} / the dollar`);

  const [, , observationIndex, cardinality] = await client.readContract({
    address: dollar.pool,
    abi: poolAbi,
    functionName: "slot0",
  });
  try {
    await client.readContract({
      address: dollar.pool,
      abi: poolAbi,
      functionName: "observe",
      args: [[TWAP_WINDOW, 0]],
    });
  } catch (error) {
    throw new Error(`The pool can't serve a ${TWAP_WINDOW}-second TWAP right now`, { cause: error });
  }

  const readObservation = (index: number) =>
    client.readContract({ address: dollar.pool, abi: poolAbi, functionName: "observations", args: [BigInt(index)] });
  let oldest = await readObservation((observationIndex + 1) % cardinality);
  if (!oldest[3]) oldest = await readObservation(0);
  const { timestamp } = await client.getBlock();
  const oldestAge = timestamp - BigInt(oldest[0]);
  if (oldestAge < MIN_POOL_HISTORY) {
    throw new Error(
      `The pool's oldest observation is ${oldestAge} seconds old, less than the ${MIN_POOL_HISTORY} that a fund needs`,
    );
  }
  return { cardinality, oldestAge };
}

/** Creation data for `FundFactoryV2(UNISWAP_V3_FACTORY, FEE_RECIPIENT)`, without the attribution suffix. */
export function factoryV2DeployData(artifact: FactoryArtifact): Hex {
  return encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [UNISWAP_V3_FACTORY, FEE_RECIPIENT],
  });
}

/**
 * The refusals before the FundFactoryV2 deploy goes out, in the order they are checked. Each one means: run the dry
 * run again, because the agent's wallet also signs the production heartbeat, so its nonce can move. Throws with the
 * reason, or returns when the deploy may go out.
 *
 * - `expectNonce` is the pending nonce the dry run printed. The script signs the deploy with exactly that nonce (it
 *   does not read it again), so the contract can only land at the address the dry run printed.
 * - `pendingNonce` must equal `latestNonce`: otherwise the agent has a transaction in flight.
 * - `factories` must not list a version 2 already, unless `again`.
 */
export function checkFactoryV2Send(args: {
  expectNonce: number | undefined;
  pendingNonce: number;
  latestNonce: number;
  factories: readonly Factory[];
  again: boolean;
}): void {
  const { expectNonce, pendingNonce, latestNonce, factories, again } = args;
  if (expectNonce === undefined) {
    throw new Error(`--send needs --expect-nonce <n>: the pending nonce the dry run printed (now ${pendingNonce})`);
  }
  if (pendingNonce !== expectNonce) {
    throw new Error(
      `The agent's pending nonce is ${pendingNonce}, not the ${expectNonce} you expected: run the dry run again`,
    );
  }
  if (pendingNonce !== latestNonce) {
    throw new Error(
      `The agent has a transaction in flight (pending nonce ${pendingNonce}, latest ${latestNonce}): wait for it, then run the dry run again`,
    );
  }
  const existing = factories.find((f) => f.version === 2);
  if (existing && !again) {
    throw new Error(
      `FACTORIES already lists a FundFactoryV2 (${existing.address}). If you really want another, add --again.`,
    );
  }
}

/**
 * Reads back a FundFactoryV2 that was just deployed: it has the Uniswap factory and the fee recipient it was meant
 * to, and no funds yet. Throws on the first mismatch.
 */
export async function checkFactoryV2(client: Pick<PublicClient, "readContract">, address: Address): Promise<void> {
  const [uniswapFactory, feeRecipient, fundCount] = await Promise.all([
    client.readContract({ address, abi: fundFactoryV2Abi, functionName: "uniswapFactory" }),
    client.readContract({ address, abi: fundFactoryV2Abi, functionName: "feeRecipient" }),
    client.readContract({ address, abi: fundFactoryV2Abi, functionName: "fundCount" }),
  ]);
  if (!isAddressEqual(uniswapFactory, UNISWAP_V3_FACTORY)) {
    throw new Error(`The factory's uniswapFactory() is ${uniswapFactory}, not ${UNISWAP_V3_FACTORY}`);
  }
  if (!isAddressEqual(feeRecipient, FEE_RECIPIENT)) {
    throw new Error(`The factory's feeRecipient() is ${feeRecipient}, not ${FEE_RECIPIENT}`);
  }
  if (fundCount !== 0n) throw new Error(`The factory's fundCount() is ${fundCount}, not 0`);
}
