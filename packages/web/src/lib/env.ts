import { type Address, getAddress } from "viem";
import { z } from "zod";
import { hashSchema } from "./schemas";

/** An empty value counts as missing, so a copied .env.example (`NAME=`) behaves like one without the line. */
const blank = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema);

const schema = z
  .object({
    /** "fork": anvil on 8548, the fork bundler and the agent's fork signer (Task 14). */
    CHAIN_MODE: blank(z.enum(["mainnet", "fork"]).default("mainnet")),
    /** The passkeys' site: tesoreria.finance in production, localhost in development. Fixed once real accounts exist. */
    RP_ID: blank(z.string().min(1)),
    /** The page's full origin, port included: https://tesoreria.finance, or http://localhost:3000. */
    ORIGIN: blank(z.url()),
    SESSION_SECRET: blank(z.string().min(32)),
    /** Neon's URL, "memory" or "pglite:<folder>". Required on mainnet; the fork defaults to "memory". */
    DATABASE_URL: blank(z.string().min(1).optional()),
    CELO_RPC_URL: blank(z.url().default("https://forno.celo.org")),
    BASE_RPC_URL: blank(z.url().default("https://mainnet.base.org")),
    PIMLICO_API_KEY: blank(z.string().min(1).optional()),
    PIMLICO_SPONSORSHIP_POLICY_ID: blank(z.string().min(1).optional()),
    AGENT_PRIVATE_KEY: blank(hashSchema.optional()),
    /** The agent's kill switch: the deployed agent sends nothing until this is "on" (Task 11). */
    AGENT_SEND: blank(z.enum(["on", "off"]).default("off")),
    HEARTBEAT_SECRET: blank(z.string().min(32).optional()),
    BLOCKSCOUT_API_KEY: blank(z.string().min(1).optional()),
    /** The fund the portada shows, if its public view is on (spec, 9.2). */
    PUBLIC_FUND: blank(
      z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .optional(),
    ),
    /**
     * The one account that sees the request to swap its passkey for one of tesoreria.finance (spec, 9.5, "El piloto"),
     * checksummed. Without it, everyone with a passkey of the old site does.
     */
    KEY_CHANGE_PILOT: blank(
      z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .transform((value): Address => getAddress(value))
        .optional(),
    ),
    /**
     * The chat's model on the AI Gateway, as "anthropic/claude-sonnet-5.5" (spec, 8.2). Without it there is no chat:
     * no tab, no button, and its route answers 404. "mock" answers from a script, for the end-to-end test on the fork.
     */
    CHAT_MODEL: blank(z.string().min(1).optional()),
    /** The messages a member may send the chat in 24 hours (spec, 8.2). */
    CHAT_MEMBER_DAILY_LIMIT: blank(z.coerce.number().int().positive().default(30)),
    /** The messages all members together may send the chat in 24 hours (spec, 8.2). */
    CHAT_DAILY_LIMIT: blank(z.coerce.number().int().positive().default(150)),
    /**
     * The new createFunds the paymaster signs in 24 hours among everyone (spec, 6, M4). A real group creates a fund
     * or two a day; raise it when many people will create one at once, like the judges on judging day.
     */
    CREATE_FUND_DAILY_LIMIT: blank(z.coerce.number().int().positive().default(10)),
    /** Set by Vercel on its builds and deployments: there, the fork (an anvil on this machine) is never right. */
    VERCEL: blank(z.string().optional()),
  })
  .refine((settings) => settings.CHAIN_MODE !== "mainnet" || settings.DATABASE_URL !== undefined, {
    path: ["DATABASE_URL"],
    message: "Required when CHAIN_MODE is mainnet",
  })
  .refine((settings) => settings.CHAIN_MODE !== "fork" || settings.VERCEL === undefined, {
    path: ["CHAIN_MODE"],
    message: "fork is for local runs only, never on a Vercel deployment",
  })
  .refine((settings) => settings.CHAT_MODEL !== "mock" || settings.CHAIN_MODE === "fork", {
    path: ["CHAT_MODEL"],
    message: "mock is the end-to-end test's scripted model, for the fork only",
  });

export type Env = z.infer<typeof schema>;

/** Checks a set of variables. A bad value names the variable, never its content. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source);
}

let cached: Env | undefined;

/** The server's settings, checked once. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
