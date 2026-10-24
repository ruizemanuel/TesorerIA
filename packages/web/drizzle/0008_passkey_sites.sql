-- Each passkey now belongs to a site (its RP ID) and has a state (spec, 9.5). Every passkey that exists today was
-- made on the old site, and a person has at most one active passkey: the newest, which is the one /api/me returns.
--
-- A development database holding passkeys made on localhost ends up with rp_id = 'tesoreriaia.vercel.app' and
-- can't use them: delete it and register again.
ALTER TABLE "credentials" ADD COLUMN "rp_id" text;--> statement-breakpoint
UPDATE "credentials" SET "rp_id" = 'tesoreriaia.vercel.app';--> statement-breakpoint
ALTER TABLE "credentials" ALTER COLUMN "rp_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
UPDATE "credentials" SET "state" = 'retired'
WHERE "id" NOT IN (SELECT DISTINCT ON ("user_id") "id" FROM "credentials" ORDER BY "user_id", "created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_one_active" ON "credentials" USING btree ("user_id") WHERE "credentials"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_one_pending" ON "credentials" USING btree ("user_id") WHERE "credentials"."state" = 'pending';
