import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModularRestructure1791053289431 implements MigrationInterface {
  name = 'ModularRestructure1791053289431';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`UPDATE "users" SET "email" = lower(btrim("email"))`);
    await queryRunner.query(`DELETE FROM "columns" WHERE "board_id" IS NULL`);
    await queryRunner.query(
      `DELETE FROM "comments" WHERE "card_id" IS NULL OR "author_id" IS NULL`,
    );
    await queryRunner.query(
      `DELETE FROM "board_memberships" WHERE "board_id" IS NULL OR "user_id" IS NULL`,
    );
    await queryRunner.query(`DELETE FROM "jira_issue_mappings" WHERE "board_id" IS NULL`);
    await queryRunner.query(`DROP TABLE IF EXISTS "board_members"`);
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" DROP CONSTRAINT "FK_0cb41d0fe0f8e1de4cdc27ef446"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" DROP CONSTRAINT "FK_74891d8de62c21d6a897fd6f864"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" DROP CONSTRAINT "FK_30c67efb1d0ebf0c4c2f32aa607"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" DROP CONSTRAINT "FK_e6d38899c31997c45d128a8973b"`,
    );
    await queryRunner.query(`ALTER TABLE "cards" DROP CONSTRAINT "FK_976989b27951abb4a465a5ab61b"`);
    await queryRunner.query(
      `ALTER TABLE "board_memberships" DROP CONSTRAINT "FK_c2e4b11656ee2369dff6229a67f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "card_labels" DROP CONSTRAINT "FK_2c39803011be47a862bbce4d730"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" DROP CONSTRAINT "UQ_0f2deeab614a35327e058a14816"`,
    );
    await queryRunner.query(
      `ALTER TABLE "board_memberships" DROP CONSTRAINT "UQ_936f1950b4f82c831df0b23aa89"`,
    );
    await queryRunner.query(
      `CREATE TABLE "jira_oauth_states" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "state" character varying(128) NOT NULL, "codeVerifierEnc" text NOT NULL, "user_id" uuid NOT NULL, "board_id" uuid NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_3bdbeb23e33a7f0aa559ddd9a86" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jira_oauth_states_expires" ON "jira_oauth_states" ("expiresAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_jira_oauth_states_state" ON "jira_oauth_states" ("state") `,
    );
    await queryRunner.query(
      `CREATE TABLE "jira_connections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "board_id" uuid NOT NULL, "connected_by_id" uuid NOT NULL, "cloudId" character varying(100) NOT NULL, "siteUrl" character varying(255) NOT NULL, "accessTokenEnc" text NOT NULL, "refreshTokenEnc" text, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "scopes" text array NOT NULL DEFAULT '{}', "connectedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_7215ce3b907f4f6b48d12e4e675" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_jira_connections_board" ON "jira_connections" ("board_id") `,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "refreshTokenHash"`);
    await queryRunner.query(
      `ALTER TABLE "sync_logs" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "labels" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`DELETE FROM "labels"`);
    await queryRunner.query(`ALTER TABLE "labels" ADD "board_id" uuid NOT NULL`);
    await queryRunner.query(`DELETE FROM "cards" WHERE "column_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "cards" ADD "board_id" uuid`);
    await queryRunner.query(
      `UPDATE "cards" SET "board_id" = "columns"."board_id" FROM "columns" WHERE "columns"."id" = "cards"."column_id"`,
    );
    await queryRunner.query(`ALTER TABLE "cards" ALTER COLUMN "board_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "board_memberships" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`UPDATE "board_memberships" SET "createdAt" = "invitedAt"`);
    await queryRunner.query(`ALTER TABLE "board_memberships" DROP COLUMN "invitedAt"`);
    await queryRunner.query(
      `ALTER TABLE "board_memberships" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "boards" ADD "description" text`);
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ALTER COLUMN "board_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sync_logs" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "labels" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" DROP CONSTRAINT "FK_93d9a3773334ccc328e38cec696"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "comments" ALTER COLUMN "card_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "comments" ALTER COLUMN "author_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "cards" DROP CONSTRAINT "FK_ce7087ed72b4e5e5a0c72a8c5aa"`);
    await queryRunner.query(
      `ALTER TABLE "cards" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "cards" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "cards" ALTER COLUMN "column_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "cards" ALTER COLUMN "deadline" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "columns" DROP CONSTRAINT "FK_3f88407849daf390e93035b15ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "columns" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "columns" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "columns" ALTER COLUMN "board_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "board_memberships" DROP CONSTRAINT "FK_0ca1be47b9099505ca06f8210e9"`,
    );
    await queryRunner.query(`ALTER TABLE "board_memberships" ALTER COLUMN "board_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "board_memberships" ALTER COLUMN "user_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "boards" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "boards" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "displayName" TYPE character varying(100) USING left("displayName", 100)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_jira_issue_mappings_board_issue" ON "jira_issue_mappings" ("board_id", "jiraIssueKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jira_issue_mappings_board" ON "jira_issue_mappings" ("board_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_labels_board_name" ON "labels" ("board_id", "name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_comments_card" ON "comments" ("card_id", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_cards_board_jira_issue" ON "cards" ("board_id", "jiraIssueKey") WHERE "jiraIssueKey" IS NOT NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_cards_board" ON "cards" ("board_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_cards_column_position" ON "cards" ("column_id", "position") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_columns_board_position" ON "columns" ("board_id", "position") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_board_memberships_user" ON "board_memberships" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_board_memberships_board_user" ON "board_memberships" ("board_id", "user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "labels" ADD CONSTRAINT "FK_8c01957f89bcb4364bb5b4b35ce" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_93d9a3773334ccc328e38cec696" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cards" ADD CONSTRAINT "FK_ce7087ed72b4e5e5a0c72a8c5aa" FOREIGN KEY ("column_id") REFERENCES "columns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "columns" ADD CONSTRAINT "FK_3f88407849daf390e93035b15ef" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "board_memberships" ADD CONSTRAINT "FK_0ca1be47b9099505ca06f8210e9" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "card_labels" ADD CONSTRAINT "FK_2c39803011be47a862bbce4d730" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "board_members" ("board_id" uuid NOT NULL, "user_id" uuid NOT NULL, CONSTRAINT "PK_159415b4beacf33c9393cfe673c" PRIMARY KEY ("board_id", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca2c72a39c80199717012df393" ON "board_members" ("board_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9989bac63c51805e59ce91a54" ON "board_members" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "board_members" ADD CONSTRAINT "FK_ca2c72a39c80199717012df3932" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "board_members" ADD CONSTRAINT "FK_a9989bac63c51805e59ce91a541" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "card_labels" DROP CONSTRAINT "FK_2c39803011be47a862bbce4d730"`,
    );
    await queryRunner.query(
      `ALTER TABLE "board_memberships" DROP CONSTRAINT "FK_0ca1be47b9099505ca06f8210e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "columns" DROP CONSTRAINT "FK_3f88407849daf390e93035b15ef"`,
    );
    await queryRunner.query(`ALTER TABLE "cards" DROP CONSTRAINT "FK_ce7087ed72b4e5e5a0c72a8c5aa"`);
    await queryRunner.query(
      `ALTER TABLE "comments" DROP CONSTRAINT "FK_93d9a3773334ccc328e38cec696"`,
    );
    await queryRunner.query(
      `ALTER TABLE "labels" DROP CONSTRAINT "FK_8c01957f89bcb4364bb5b4b35ce"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_board_memberships_board_user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_board_memberships_user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_columns_board_position"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cards_column_position"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cards_board"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_cards_board_jira_issue"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_comments_card"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_labels_board_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_jira_issue_mappings_board"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_jira_issue_mappings_board_issue"`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "displayName" TYPE character varying`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "updatedAt" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "boards" ALTER COLUMN "updatedAt" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "boards" ALTER COLUMN "createdAt" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "board_memberships" ALTER COLUMN "user_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "board_memberships" ALTER COLUMN "board_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "board_memberships" ADD CONSTRAINT "FK_0ca1be47b9099505ca06f8210e9" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "columns" ALTER COLUMN "board_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "columns" ALTER COLUMN "updatedAt" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "columns" ALTER COLUMN "createdAt" TYPE TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "columns" ADD CONSTRAINT "FK_3f88407849daf390e93035b15ef" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "cards" ALTER COLUMN "deadline" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "cards" ALTER COLUMN "column_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "cards" ALTER COLUMN "updatedAt" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "cards" ALTER COLUMN "createdAt" TYPE TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "cards" ADD CONSTRAINT "FK_ce7087ed72b4e5e5a0c72a8c5aa" FOREIGN KEY ("column_id") REFERENCES "columns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "comments" ALTER COLUMN "author_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "comments" ALTER COLUMN "card_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "comments" ALTER COLUMN "updatedAt" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "comments" ALTER COLUMN "createdAt" TYPE TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_93d9a3773334ccc328e38cec696" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "labels" ALTER COLUMN "createdAt" TYPE TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "sync_logs" ALTER COLUMN "createdAt" TYPE TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ALTER COLUMN "board_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ALTER COLUMN "updatedAt" TYPE TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ALTER COLUMN "createdAt" TYPE TIMESTAMP`,
    );
    await queryRunner.query(`ALTER TABLE "boards" DROP COLUMN "description"`);
    await queryRunner.query(
      `ALTER TABLE "board_memberships" ADD "invitedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`UPDATE "board_memberships" SET "invitedAt" = "createdAt"`);
    await queryRunner.query(`ALTER TABLE "board_memberships" DROP COLUMN "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "board_memberships" DROP COLUMN "createdAt"`);
    await queryRunner.query(`ALTER TABLE "cards" DROP COLUMN "board_id"`);
    await queryRunner.query(`ALTER TABLE "labels" DROP COLUMN "board_id"`);
    await queryRunner.query(`ALTER TABLE "labels" DROP COLUMN "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "sync_logs" DROP COLUMN "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "users" ADD "refreshTokenHash" character varying`);
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('ADMIN', 'MEMBER', 'VIEWER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "role" "public"."users_role_enum" NOT NULL DEFAULT 'MEMBER'`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_jira_connections_board"`);
    await queryRunner.query(`DROP TABLE "jira_connections"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_jira_oauth_states_state"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_jira_oauth_states_expires"`);
    await queryRunner.query(`DROP TABLE "jira_oauth_states"`);
    await queryRunner.query(
      `ALTER TABLE "board_memberships" ADD CONSTRAINT "UQ_936f1950b4f82c831df0b23aa89" UNIQUE ("board_id", "user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ADD CONSTRAINT "UQ_0f2deeab614a35327e058a14816" UNIQUE ("jiraIssueKey", "board_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "card_labels" ADD CONSTRAINT "FK_2c39803011be47a862bbce4d730" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "board_memberships" ADD CONSTRAINT "FK_c2e4b11656ee2369dff6229a67f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cards" ADD CONSTRAINT "FK_976989b27951abb4a465a5ab61b" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "comments" ADD CONSTRAINT "FK_e6d38899c31997c45d128a8973b" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ADD CONSTRAINT "FK_30c67efb1d0ebf0c4c2f32aa607" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ADD CONSTRAINT "FK_74891d8de62c21d6a897fd6f864" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_issue_mappings" ADD CONSTRAINT "FK_0cb41d0fe0f8e1de4cdc27ef446" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
