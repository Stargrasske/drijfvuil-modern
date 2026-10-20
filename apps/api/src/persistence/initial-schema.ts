import type { MigrationInterface, QueryRunner } from 'typeorm';

// New empty schema only; not a migration from the legacy 0.2 application.
export class InitialSchema1792108800000 implements MigrationInterface {
  name = 'InitialSchema1792108800000';

  async up(queryRunner: Pick<QueryRunner, 'query'>): Promise<void> {
    await queryRunner.query('CREATE SCHEMA "drijfvuil_m3"');
    await queryRunner.query(`CREATE TABLE "drijfvuil_m3"."city" (
      "id" integer PRIMARY KEY,
      "name" text NOT NULL
    )`);
    await queryRunner.query(`CREATE TABLE "drijfvuil_m3"."quarter" (
      "id" integer PRIMARY KEY,
      "city_id" integer NOT NULL,
      "quarter" text NOT NULL,
      CONSTRAINT "quarter_city_fk" FOREIGN KEY ("city_id") REFERENCES "drijfvuil_m3"."city" ("id"),
      CONSTRAINT "quarter_id_city_unique" UNIQUE ("id", "city_id")
    )`);
    // SQL code-point counts need supplementary characters counted twice to match JS UTF-16 limits.
    await queryRunner.query(`CREATE TABLE "drijfvuil_m3"."report" (
      "id" serial PRIMARY KEY,
      "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "latitude" double precision NOT NULL,
      "longitude" double precision NOT NULL,
      "city_id" integer NOT NULL,
      "quarter_id" integer,
      "location_type" text NOT NULL,
      "litter_type" text,
      "extra" text,
      CONSTRAINT "report_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
      CONSTRAINT "report_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180),
      CONSTRAINT "report_city_fk" FOREIGN KEY ("city_id") REFERENCES "drijfvuil_m3"."city" ("id"),
      CONSTRAINT "report_quarter_city_fk" FOREIGN KEY ("quarter_id", "city_id")
        REFERENCES "drijfvuil_m3"."quarter" ("id", "city_id"),
      CONSTRAINT "report_location_check" CHECK ("location_type" IN ('water', 'land')),
      CONSTRAINT "report_litter_check" CHECK ("litter_type" IS NULL OR
        (char_length("litter_type") BETWEEN 1 AND 80 AND
          btrim("litter_type", U&'\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF') <> '' AND
          char_length("litter_type") + char_length(regexp_replace("litter_type", U&'[^\\+010000-\\+10FFFF]', '', 'g')) <= 80)),
      CONSTRAINT "report_extra_check" CHECK ("extra" IS NULL OR
        char_length("extra") + char_length(regexp_replace("extra", U&'[^\\+010000-\\+10FFFF]', '', 'g')) <= 364)
    )`);
    await queryRunner.query('CREATE INDEX "report_city_quarter_idx" ON "drijfvuil_m3"."report" ("city_id", "quarter_id", "id")');
  }

  async down(queryRunner: Pick<QueryRunner, 'query'>): Promise<void> {
    await queryRunner.query('DROP TABLE "drijfvuil_m3"."report"');
    await queryRunner.query('DROP TABLE "drijfvuil_m3"."quarter"');
    await queryRunner.query('DROP TABLE "drijfvuil_m3"."city"');
    await queryRunner.query('DROP SCHEMA "drijfvuil_m3"');
  }
}
