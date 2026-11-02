ALTER TABLE "jobs" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_owner_idx" ON "jobs" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_reminder_once_idx" ON "notifications" USING btree ("user_id","kind","ref_id") WHERE "notifications"."kind" <> 'status_changed';