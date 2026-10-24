import { type Address, type Hex, getAddress, isAddress } from "viem";
import { z } from "zod";

/**
 * The one hex schema every route shares: "0x" and hex digits. It stops a malformed field at the door, so the
 * code that decodes it (viem, ox) never sees a non-hex string.
 */
export const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/) as z.ZodType<Hex>;

/** Exactly 32 bytes in hex: a hash, a UserOperation hash, a private key. */
export const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/) as z.ZodType<Hex>;

/** A passkey's attestationObject: at most 4096 bytes, where a real one is a few hundred. */
export const attestationSchema = hexSchema.refine((value) => value.length <= 2 + 2 * 4096);

/** A passkey's answer to a challenge, for a login or a proof: hex strings only, so the code that decodes them never sees anything else. */
export const assertionSchema = z.object({
  credentialId: z.string().min(1).max(1024),
  authenticatorData: hexSchema,
  clientDataJSON: z.string().max(4096),
  signature: hexSchema,
});

/** A 20-byte address, in any case. It comes out checksummed, the way the database keeps it. */
export const addressSchema = hexSchema.refine((value) => isAddress(value, { strict: false })).transform((value): Address => getAddress(value));
