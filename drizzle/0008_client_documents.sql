CREATE TABLE "client_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"source_id" uuid,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tax_rate" real DEFAULT 0 NOT NULL,
	"subtotal" numeric(16, 2) DEFAULT 0 NOT NULL,
	"discount_total" numeric(16, 2) DEFAULT 0 NOT NULL,
	"tax" numeric(16, 2) DEFAULT 0 NOT NULL,
	"total" numeric(16, 2) DEFAULT 0 NOT NULL,
	"amount_paid" numeric(16, 2) DEFAULT 0 NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"term_months" integer,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sla" jsonb,
	"notes" text,
	"share_token" text NOT NULL,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"signed_by_name" text,
	"signed_by_title" text,
	"signature_method" text,
	"signature_ip" text,
	"decline_reason" text,
	"signed_file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_documents_number_unique" UNIQUE("number"),
	CONSTRAINT "client_documents_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "document_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"paid_on" date NOT NULL,
	"notes" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_signed_file_id_files_id_fk" FOREIGN KEY ("signed_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_payments" ADD CONSTRAINT "document_payments_document_id_client_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."client_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_payments" ADD CONSTRAINT "document_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_documents_company_idx" ON "client_documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "client_documents_type_idx" ON "client_documents" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "document_payments_doc_idx" ON "document_payments" USING btree ("document_id");