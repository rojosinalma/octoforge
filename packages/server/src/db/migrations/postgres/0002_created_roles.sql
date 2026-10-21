CREATE TABLE "created_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster" text NOT NULL,
	"role" text NOT NULL,
	"oid" bigint NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "created_roles_cluster_role" ON "created_roles" USING btree ("cluster","role");