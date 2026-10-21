CREATE TABLE "adoptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"member" text NOT NULL,
	"target" text NOT NULL,
	"engine" text NOT NULL,
	"ok" boolean NOT NULL,
	"message" text NOT NULL,
	"detail" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"member" text NOT NULL,
	"target" text NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"message" text NOT NULL,
	"detail" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"member" text NOT NULL,
	"base_url" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "adoptions_at" ON "adoptions" USING btree ("at");--> statement-breakpoint
CREATE INDEX "deliveries_at" ON "deliveries" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "instances_member_url" ON "instances" USING btree ("member","base_url");