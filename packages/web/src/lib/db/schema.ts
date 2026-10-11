import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** wARS and USDT in their smallest units: numeric(78, 0) holds any uint256, and comes back as bigint. */
const units = customType<{ data: bigint; driverData: string }>({
  dataType: () => "numeric(78, 0)",
  toDriver: (value) => value.toString(),
  fromDriver: (value) => BigInt(value),
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Only for reminders (spec, 6); optional. */
  email: text("email"),
  /** The member's Safe, checksummed. The server derives it from the passkey's public key: one per person. */
  account: text("account").notNull().unique(),
  createdAt: createdAt(),
});

export const credentials = pgTable("credentials", {
  /** WebAuthn credential id, base64url. */
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** Uncompressed P-256 key, 0x + x ‖ y: the Safe's owner. A later login doesn't return it (spec, 6). */
  publicKey: text("public_key").notNull(),
  /** The random user.id given to the authenticator (spec, 6): never derived from a name or a mail. */
  userHandle: text("user_handle").notNull(),
  createdAt: createdAt(),
});

export const funds = pgTable("funds", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  agreedExpense: text("agreed_expense").notNull(),
  /** Off chain: what each member puts in per week (spec, 4). */
  weeklyFee: units("weekly_fee").notNull(),
  weeklyCap: units("weekly_cap").notNull(),
  balanceCap: units("balance_cap").notNull(),
  /** Chosen right before deploying, when the number of members is known (2 to members − 1). */
  votesRequired: integer("votes_required"),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id),
  inviteCode: text("invite_code").notNull().unique(),
  status: text("status", { enum: ["draft", "deploying", "live"] })
    .notNull()
    .default("draft"),
  /** Set once the FundFactory created it, checked against the draft. */
  address: text("address").unique(),
  /** The block of its FundCreated: no event of this fund is older. */
  createdBlock: bigint("created_block", { mode: "bigint" }),
  /** The public, read-only view (spec, 9.2): only the real group's fund has it. */
  publicView: boolean("public_view").notNull().default(false),
  /** Whether that view shows first names; if not, "Miembro 1…N". */
  publicNames: boolean("public_names").notNull().default(false),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** The order of the list, like the group's WhatsApp list, and of the members passed to createFund. */
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fundId, t.userId] })],
);

export const EXPENSE_STATUSES = ["new", "sending", "reimbursed", "proposed", "waiting", "rejected", "blocked"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey(),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Made by the panel when it opens: a double click or a retry sends the same one (Review Focus 3). */
    clientKey: text("client_key").notNull(),
    kind: text("kind", { enum: ["agreed", "other"] }).notNull(),
    amount: units("amount").notNull(),
    note: text("note").notNull(),
    /** keccak256 of the id: what goes on chain with the reimbursement, and how the agent dedupes it. */
    ref: text("ref").notNull().unique(),
    status: text("status", { enum: EXPENSE_STATUSES }).notNull().default("new"),
    /** The agent's last reason, in English, for whoever reads the logs; the web shows its own sentences. */
    reason: text("reason"),
    /** The agent's transaction, kept as soon as it's sent (`onSent`), and what it was. */
    tx: text("tx"),
    sentAction: text("sent_action", { enum: ["reimburse", "propose-payment"] }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("expenses_user_client_key").on(t.userId, t.clientKey)],
);

/** Every agent decision, with its reason (spec, 8.6). */
export const decisions = pgTable("decisions", {
  id: serial("id").primaryKey(),
  fund: text("fund"),
  expenseId: uuid("expense_id").references(() => expenses.id),
  kind: text("kind").notNull(),
  reason: text("reason").notNull(),
  /** The action with its amounts as decimal strings. */
  action: jsonb("action").$type<Record<string, string>>(),
  tx: text("tx"),
  status: text("status"),
  createdAt: createdAt(),
});

/** A member's UserOperation, kept before its receipt (spec, 6): the timeline shows it "en camino". */
export const operations = pgTable("operations", {
  userOpHash: text("user_op_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** The fund's address; null for createFund. */
  fund: text("fund"),
  /** For `create-fund`: the draft (a `funds` row) it deploys, so a retried deploy finds the operation already sent. */
  draftId: uuid("draft_id").references(() => funds.id),
  kind: text("kind", { enum: ["create-fund", "contribute", "vote"] }).notNull(),
  /** For a contribution: the amount in the token's units. */
  amount: units("amount"),
  token: text("token", { enum: ["wars", "usdt"] }),
  /**
   * For `create-fund`: its EntryPoint nonce, on key 0. One that never came back is released only while the chain
   * still has this nonce, and its resend is pinned to it (funds.ts). Null for other kinds, which take a fresh nonce
   * key each, and in rows from before it was kept (never released).
   */
  nonce: units("nonce"),
  transactionHash: text("transaction_hash"),
  success: boolean("success"),
  createdAt: createdAt(),
});

/**
 * Each EntryPoint nonce (key 0) the paymaster signed a person's createFund on: at most MAX_CREATE_FUND_NONCES each
 * (bundler-proxy.ts). A nonce lands at most once, so this bounds the createFunds one person gets sponsored, ever.
 */
export const createFundNonces = pgTable(
  "create_fund_nonces",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    nonce: units("nonce").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.nonce] })],
);

export const locks = pgTable("locks", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
