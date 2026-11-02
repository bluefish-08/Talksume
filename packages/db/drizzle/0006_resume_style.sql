ALTER TABLE "resume_versions" ADD COLUMN "accent" text DEFAULT 'blue' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "resume_style" jsonb;