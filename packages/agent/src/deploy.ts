import { type Abi, type Hex, type PublicClient, encodeDeployData, getAddress, parseAbi } from "viem";
import { CELO_CHAIN_ID, POOL, POOL_FEE, TWAP_WINDOW, UNISWAP_V3_FACTORY, USDT, WARS } from "./chain";

const uniswapV3FactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
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

/** The part of the artifact that `forge build` writes to contracts/out/FundFactory.sol/FundFactory.json. */
export type FactoryArtifact = { abi: Abi; bytecode: { object: Hex } };

/** Creation data for `FundFactory(wARS, USDT, POOL)`, without the attribution suffix (the signer adds it). */
export function factoryDeployData(artifact: FactoryArtifact): Hex {
  return encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [WARS, USDT, POOL] });
}
