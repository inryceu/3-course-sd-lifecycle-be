import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1790891436548 implements MigrationInterface {
    name = 'InitialSchema1790891436548'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "labels" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(50) NOT NULL, "color" character varying(7) NOT NULL DEFAULT '#3498db', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c0c4e97f76f1f3a268c7a70b925" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('ADMIN', 'MEMBER', 'VIEWER')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "passwordHash" character varying NOT NULL, "displayName" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'MEMBER', "refreshTokenHash" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "comments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "text" text NOT NULL, "syncedToJira" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "card_id" uuid, "author_id" uuid, CONSTRAINT "PK_8bf68bc960f2b69e818bdb90dcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "cards" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(255) NOT NULL, "description" text, "deadline" TIMESTAMP, "jiraIssueKey" character varying(50), "position" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "column_id" uuid, "assignee_id" uuid, CONSTRAINT "PK_5f3269634705fdff4a9935860fc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."columns_type_enum" AS ENUM('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE')`);
        await queryRunner.query(`CREATE TABLE "columns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(255) NOT NULL, "type" "public"."columns_type_enum" NOT NULL DEFAULT 'TODO', "position" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "board_id" uuid, CONSTRAINT "PK_4ac339ccbbfed1dcd96812abbd5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."board_memberships_role_enum" AS ENUM('ADMIN', 'MEMBER', 'VIEWER')`);
        await queryRunner.query(`CREATE TABLE "board_memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "role" "public"."board_memberships_role_enum" NOT NULL DEFAULT 'MEMBER', "invitedAt" TIMESTAMP NOT NULL DEFAULT now(), "board_id" uuid, "user_id" uuid, CONSTRAINT "UQ_936f1950b4f82c831df0b23aa89" UNIQUE ("board_id", "user_id"), CONSTRAINT "PK_f8f22c15a5c35784bbd0e7feddc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "boards" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(255) NOT NULL, "jiraProjectKey" character varying(50), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_606923b0b068ef262dfdcd18f44" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "jira_issue_mappings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "jiraIssueKey" character varying(50) NOT NULL, "jiraIssueId" character varying(50) NOT NULL, "jiraProjectKey" character varying(100) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "board_id" uuid, "card_id" uuid, "created_by_id" uuid, CONSTRAINT "UQ_0f2deeab614a35327e058a14816" UNIQUE ("board_id", "jiraIssueKey"), CONSTRAINT "PK_0b36472f93ce2d79fb50dd1e0e5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."sync_logs_direction_enum" AS ENUM('TO_JIRA', 'FROM_JIRA')`);
        await queryRunner.query(`CREATE TYPE "public"."sync_logs_status_enum" AS ENUM('SUCCESS', 'FAILED', 'CONFLICT')`);
        await queryRunner.query(`CREATE TABLE "sync_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "direction" "public"."sync_logs_direction_enum" NOT NULL, "status" "public"."sync_logs_status_enum" NOT NULL, "payload" jsonb, "errorMessage" text, "mapping_id" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f441fe15484e077c80ddec89336" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "card_labels" ("card_id" uuid NOT NULL, "label_id" uuid NOT NULL, CONSTRAINT "PK_e68f1b70fd31be0508d218c754a" PRIMARY KEY ("card_id", "label_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ed1a892fd622ea37a82c3c76c0" ON "card_labels" ("card_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_2c39803011be47a862bbce4d73" ON "card_labels" ("label_id") `);
        await queryRunner.query(`CREATE TABLE "board_members" ("board_id" uuid NOT NULL, "user_id" uuid NOT NULL, CONSTRAINT "PK_159415b4beacf33c9393cfe673c" PRIMARY KEY ("board_id", "user_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ca2c72a39c80199717012df393" ON "board_members" ("board_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_a9989bac63c51805e59ce91a54" ON "board_members" ("user_id") `);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_93d9a3773334ccc328e38cec696" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_e6d38899c31997c45d128a8973b" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cards" ADD CONSTRAINT "FK_ce7087ed72b4e5e5a0c72a8c5aa" FOREIGN KEY ("column_id") REFERENCES "columns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cards" ADD CONSTRAINT "FK_976989b27951abb4a465a5ab61b" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "columns" ADD CONSTRAINT "FK_3f88407849daf390e93035b15ef" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "board_memberships" ADD CONSTRAINT "FK_0ca1be47b9099505ca06f8210e9" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "board_memberships" ADD CONSTRAINT "FK_c2e4b11656ee2369dff6229a67f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "jira_issue_mappings" ADD CONSTRAINT "FK_30c67efb1d0ebf0c4c2f32aa607" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "jira_issue_mappings" ADD CONSTRAINT "FK_74891d8de62c21d6a897fd6f864" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "jira_issue_mappings" ADD CONSTRAINT "FK_0cb41d0fe0f8e1de4cdc27ef446" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sync_logs" ADD CONSTRAINT "FK_8cf2eb5a94359db5a14eec61f7d" FOREIGN KEY ("mapping_id") REFERENCES "jira_issue_mappings"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "card_labels" ADD CONSTRAINT "FK_ed1a892fd622ea37a82c3c76c04" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "card_labels" ADD CONSTRAINT "FK_2c39803011be47a862bbce4d730" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "board_members" ADD CONSTRAINT "FK_ca2c72a39c80199717012df3932" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "board_members" ADD CONSTRAINT "FK_a9989bac63c51805e59ce91a541" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "board_members" DROP CONSTRAINT "FK_a9989bac63c51805e59ce91a541"`);
        await queryRunner.query(`ALTER TABLE "board_members" DROP CONSTRAINT "FK_ca2c72a39c80199717012df3932"`);
        await queryRunner.query(`ALTER TABLE "card_labels" DROP CONSTRAINT "FK_2c39803011be47a862bbce4d730"`);
        await queryRunner.query(`ALTER TABLE "card_labels" DROP CONSTRAINT "FK_ed1a892fd622ea37a82c3c76c04"`);
        await queryRunner.query(`ALTER TABLE "sync_logs" DROP CONSTRAINT "FK_8cf2eb5a94359db5a14eec61f7d"`);
        await queryRunner.query(`ALTER TABLE "jira_issue_mappings" DROP CONSTRAINT "FK_0cb41d0fe0f8e1de4cdc27ef446"`);
        await queryRunner.query(`ALTER TABLE "jira_issue_mappings" DROP CONSTRAINT "FK_74891d8de62c21d6a897fd6f864"`);
        await queryRunner.query(`ALTER TABLE "jira_issue_mappings" DROP CONSTRAINT "FK_30c67efb1d0ebf0c4c2f32aa607"`);
        await queryRunner.query(`ALTER TABLE "board_memberships" DROP CONSTRAINT "FK_c2e4b11656ee2369dff6229a67f"`);
        await queryRunner.query(`ALTER TABLE "board_memberships" DROP CONSTRAINT "FK_0ca1be47b9099505ca06f8210e9"`);
        await queryRunner.query(`ALTER TABLE "columns" DROP CONSTRAINT "FK_3f88407849daf390e93035b15ef"`);
        await queryRunner.query(`ALTER TABLE "cards" DROP CONSTRAINT "FK_976989b27951abb4a465a5ab61b"`);
        await queryRunner.query(`ALTER TABLE "cards" DROP CONSTRAINT "FK_ce7087ed72b4e5e5a0c72a8c5aa"`);
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_e6d38899c31997c45d128a8973b"`);
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_93d9a3773334ccc328e38cec696"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a9989bac63c51805e59ce91a54"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ca2c72a39c80199717012df393"`);
        await queryRunner.query(`DROP TABLE "board_members"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2c39803011be47a862bbce4d73"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ed1a892fd622ea37a82c3c76c0"`);
        await queryRunner.query(`DROP TABLE "card_labels"`);
        await queryRunner.query(`DROP TABLE "sync_logs"`);
        await queryRunner.query(`DROP TYPE "public"."sync_logs_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."sync_logs_direction_enum"`);
        await queryRunner.query(`DROP TABLE "jira_issue_mappings"`);
        await queryRunner.query(`DROP TABLE "boards"`);
        await queryRunner.query(`DROP TABLE "board_memberships"`);
        await queryRunner.query(`DROP TYPE "public"."board_memberships_role_enum"`);
        await queryRunner.query(`DROP TABLE "columns"`);
        await queryRunner.query(`DROP TYPE "public"."columns_type_enum"`);
        await queryRunner.query(`DROP TABLE "cards"`);
        await queryRunner.query(`DROP TABLE "comments"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP TABLE "labels"`);
    }

}
