ALTER TABLE "companies" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "employees" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "annual_revenue" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "lead_status" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "record_source" text DEFAULT 'CRM UI' NOT NULL;--> statement-breakpoint
UPDATE "companies" SET "time_zone" = 'Africa/Lagos' WHERE "time_zone" IS NULL AND "region" NOT IN ('Ghana', 'Kenya');
--> statement-breakpoint
UPDATE "companies" SET "time_zone" = CASE "region" WHEN 'Ghana' THEN 'Africa/Accra' WHEN 'Kenya' THEN 'Africa/Nairobi' ELSE 'Africa/Lagos' END WHERE "time_zone" IS NULL;
