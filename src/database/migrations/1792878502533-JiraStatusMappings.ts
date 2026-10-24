import { MigrationInterface, QueryRunner } from 'typeorm';

export class JiraStatusMappings1792878502533 implements MigrationInterface {
  name = 'JiraStatusMappings1792878502533';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "jira_status_mappings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "board_id" uuid NOT NULL, "jira_status_id" character varying(50) NOT NULL, "jira_status_name" character varying(255) NOT NULL, "column_id" uuid NOT NULL, CONSTRAINT "PK_fb69a08fe29326e7d69ef725f66" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_jira_status_mappings_board_status" ON "jira_status_mappings" ("board_id", "jira_status_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_jira_status_mappings_board_status"`);
    await queryRunner.query(`DROP TABLE "jira_status_mappings"`);
  }
}
