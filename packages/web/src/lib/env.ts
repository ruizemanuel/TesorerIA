import { z } from "zod";
import { hashSchema } from "./schemas";

/** An empty value counts as missing, so a copied .env.example (`NAME=`) behaves like one without the line. */
const blank = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema);

const schema = z
  .object({
    /** "fork": anvil on 8548, the fork bundler and the agent's fork signer (Task 14). */
    CHAIN_MODE: blank(z.enum(["mainnet", "fork"]).default("mainnet")),
    /** The passkeys' site: tesoreriaia.vercel.app in production, localhost in development. Fixed once real accounts exist. */
    RP_ID: blank(z.string().min(1)),
    /** The page's full origin, port included: https://tesoreriaia.vercel.app, or http://localhost:3000. */
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
  })
  .refine((settings) => settings.CHAIN_MODE !== "mainnet" || settings.DATABASE_URL !== undefined, {
    path: ["DATABASE_URL"],
    message: "Required when CHAIN_MODE is mainnet",
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
