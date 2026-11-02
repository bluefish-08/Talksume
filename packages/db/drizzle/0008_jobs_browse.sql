CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "jobs_open_recent_idx" ON "jobs" USING btree (coalesce("posted_at", "fetched_at"),"id") WHERE "jobs"."status" = 'open';--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("company");--> statement-breakpoint
CREATE INDEX "jobs_cities_idx" ON "jobs" USING gin ("cities");--> statement-breakpoint
CREATE INDEX "jobs_search_trgm_idx" ON "jobs" USING gin (("title" || ' ' || "company" || ' ' || "jd_text") gin_trgm_ops);