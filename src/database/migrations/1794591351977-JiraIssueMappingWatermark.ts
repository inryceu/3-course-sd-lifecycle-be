import { MigrationInterface, QueryRunner } from 'typeorm';

export class JiraIssueMappingWatermark1794591351977 implements MigrationInterface {
  name = 'JiraIssueMappingWatermark1794591351977';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ADD COLUMN IF NOT EXISTS "last_jira_event_at" bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" DROP COLUMN IF EXISTS "last_jira_event_at"`,
    );
  }
}
