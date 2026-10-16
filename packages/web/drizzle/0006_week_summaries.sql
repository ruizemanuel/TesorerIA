CREATE TABLE "week_summaries" (
	"fund_id" uuid NOT NULL,
	"week" integer NOT NULL,
	"block" numeric(78, 0) NOT NULL,
	"facts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_summaries_fund_id_week_pk" PRIMARY KEY("fund_id","week")
);
--> statement-breakpoint
ALTER TABLE "week_summaries" ADD CONSTRAINT "week_summaries_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;