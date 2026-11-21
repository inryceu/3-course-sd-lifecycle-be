import { MigrationInterface, QueryRunner } from 'typeorm';

export class JiraSyncConflicts1794596054264 implements MigrationInterface {
  name = 'JiraSyncConflicts1794596054264';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sync_conflict_log" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "board_id" uuid NOT NULL, "card_id" uuid NOT NULL, "mapping_id" uuid, "jira_issue_key" character varying(50) NOT NULL, "board_column_id" uuid NOT NULL, "board_status" character varying(255) NOT NULL, "board_changed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "jira_column_id" uuid NOT NULL, "jira_status" character varying(255) NOT NULL, "jira_changed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "resolution" character varying(20) NOT NULL DEFAULT 'jira', "resolved_at" TIMESTAMP WITH TIME ZONE, "resolved_by_id" uuid, CONSTRAINT "PK_bfbdd6dcc2591cf751f6bfa96c2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sync_conflict_log_board_created" ON "sync_conflict_log" ("board_id", "createdAt", "id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ADD "last_board_move_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "jira_issue_mappings" ADD "last_board_column_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ADD "last_jira_change_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "jira_issue_mappings" ADD "last_jira_column_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ADD "last_jira_status_name" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sync_conflict_log" ADD CONSTRAINT "FK_0a58db110de4a138922da3fbe25" FOREIGN KEY ("mapping_id") REFERENCES "jira_issue_mappings"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_conflict_log" DROP CONSTRAINT "FK_0a58db110de4a138922da3fbe25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" DROP COLUMN "last_jira_status_name"`,
    );
    await queryRunner.query(`ALTER TABLE "jira_issue_mappings" DROP COLUMN "last_jira_column_id"`);
    await queryRunner.query(`ALTER TABLE "jira_issue_mappings" DROP COLUMN "last_jira_change_at"`);
    await queryRunner.query(`ALTER TABLE "jira_issue_mappings" DROP COLUMN "last_board_column_id"`);
    await queryRunner.query(`ALTER TABLE "jira_issue_mappings" DROP COLUMN "last_board_move_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_sync_conflict_log_board_created"`);
    await queryRunner.query(`DROP TABLE "sync_conflict_log"`);
  }
}
