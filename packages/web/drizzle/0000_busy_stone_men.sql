CREATE TABLE "credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"user_handle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"fund" text,
	"expense_id" uuid,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"action" jsonb,
	"tx" text,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fund_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_key" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"note" text NOT NULL,
	"ref" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"reason" text,
	"tx" text,
	"sent_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_ref_unique" UNIQUE("ref"),
	CONSTRAINT "expenses_user_client_key" UNIQUE("user_id","client_key")
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"agreed_expense" text NOT NULL,
	"weekly_fee" numeric(78, 0) NOT NULL,
	"weekly_cap" numeric(78, 0) NOT NULL,
	"balance_cap" numeric(78, 0) NOT NULL,
	"votes_required" integer,
	"creator_id" uuid NOT NULL,
	"invite_code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"address" text,
	"created_block" bigint,
	"public_view" boolean DEFAULT false NOT NULL,
	"public_names" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funds_invite_code_unique" UNIQUE("invite_code"),
	CONSTRAINT "funds_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "locks" (
	"name" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"fund_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_fund_id_user_id_pk" PRIMARY KEY("fund_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"user_op_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"fund" text,
	"draft_id" uuid,
	"kind" text NOT NULL,
	"amount" numeric(78, 0),
	"token" text,
	"transaction_hash" text,
	"success" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"account" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_account_unique" UNIQUE("account")
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_draft_id_funds_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;