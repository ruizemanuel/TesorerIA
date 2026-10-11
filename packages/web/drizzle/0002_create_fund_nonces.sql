CREATE TABLE "create_fund_nonces" (
	"user_id" uuid NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "create_fund_nonces_user_id_nonce_pk" PRIMARY KEY("user_id","nonce")
);
--> statement-breakpoint
ALTER TABLE "create_fund_nonces" ADD CONSTRAINT "create_fund_nonces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;