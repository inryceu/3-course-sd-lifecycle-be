import { MigrationInterface, QueryRunner } from 'typeorm';

export class JiraWebhooks1793347200000 implements MigrationInterface {
  name = 'JiraWebhooks1793347200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "jira_webhook_deliveries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "delivery_key" character varying(255) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'processing', "attempts" integer NOT NULL DEFAULT '1', "claimed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_jira_webhook_deliveries" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_jira_webhook_deliveries_key" ON "jira_webhook_deliveries" ("delivery_key") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jira_webhook_deliveries_expires" ON "jira_webhook_deliveries" ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "jira_webhooks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "board_id" uuid NOT NULL, "project_key" character varying(10) NOT NULL, "webhook_id" integer NOT NULL, "url" character varying(2048) NOT NULL, "events" text array NOT NULL DEFAULT '{}', "jql_filter" character varying(255) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_refreshed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_jira_webhooks" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_jira_webhooks_board" ON "jira_webhooks" ("board_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_jira_webhooks_board"`);
    await queryRunner.query(`DROP TABLE "jira_webhooks"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_jira_webhook_deliveries_expires"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_jira_webhook_deliveries_key"`);
    await queryRunner.query(`DROP TABLE "jira_webhook_deliveries"`);
  }
}
