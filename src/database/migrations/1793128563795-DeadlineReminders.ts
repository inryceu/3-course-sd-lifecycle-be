import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeadlineReminders1793128563795 implements MigrationInterface {
  name = 'DeadlineReminders1793128563795';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "recipient_id" uuid NOT NULL, "board_id" uuid NOT NULL, "type" character varying(50) NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "read_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipient_created" ON "notifications" ("recipient_id", "createdAt", "id") `,
    );
    await queryRunner.query(`ALTER TABLE "cards" ADD "reminder_sent_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cards" DROP COLUMN "reminder_sent_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notifications_recipient_created"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
