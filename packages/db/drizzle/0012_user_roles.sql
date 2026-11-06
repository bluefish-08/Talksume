ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'seeker';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "users" SET "role" = 'seeker' WHERE "role" = 'candidate';