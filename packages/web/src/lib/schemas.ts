import type { Hex } from "viem";
import { z } from "zod";

/**
 * The one hex schema every route shares: "0x" and hex digits. It stops a malformed field at the door, so the
 * code that decodes it (viem, ox) never sees a non-hex string.
 */
export const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/) as z.ZodType<Hex>;

/** Exactly 32 bytes in hex: a hash, a UserOperation hash, a private key. */
export const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/) as z.ZodType<Hex>;
