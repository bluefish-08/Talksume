CREATE TABLE "resume_polishes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"slot" integer NOT NULL,
	"source_hash" text NOT NULL,
	"source_text" text NOT NULL,
	"fact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggestion" text NOT NULL,
	"violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_polishes_status_check" CHECK ("resume_polishes"."status" in ('pending', 'accepted', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "resume_polishes" ADD CONSTRAINT "resume_polishes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_polishes_source_uq" ON "resume_polishes" USING btree ("user_id","item_key","source_hash");