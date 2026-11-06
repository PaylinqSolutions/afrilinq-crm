ALTER TABLE "activities" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lead_status" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lifecycle_stage" text DEFAULT 'lead' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "referral_source" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "city" text;--> statement-breakpoint
UPDATE "contacts" c SET "city" = co."city", "lifecycle_stage" = CASE co."lifecycle" WHEN 'customer' THEN 'customer' WHEN 'churned' THEN 'other' ELSE 'lead' END FROM "companies" co WHERE co."id" = c."company_id";
