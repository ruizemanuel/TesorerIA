CREATE TABLE "fund_log_ranges" (
	"fund" text PRIMARY KEY NOT NULL,
	"from_block" numeric(78, 0) NOT NULL,
	"to_block" numeric(78, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_logs" (
	"fund" text NOT NULL,
	"block" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"topics" jsonb NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "fund_logs_transaction_hash_log_index_pk" PRIMARY KEY("transaction_hash","log_index")
);
--> statement-breakpoint
CREATE INDEX "fund_logs_fund_block" ON "fund_logs" USING btree ("fund","block");