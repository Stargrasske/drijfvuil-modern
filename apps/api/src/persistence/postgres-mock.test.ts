import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { graphql } from 'graphql';
import { QueryFailedError, type DeepPartial, type QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_REPORT_MUTATION, EXPLORER_QUERY, type CreateReportDto } from '../../../../libs/contracts/src/index.js';
import { createApplication } from '../bootstrap.js';
import { DemoRepository } from '../demo-repository.js';
import { REPORT_REPOSITORY } from '../repository.js';
import {
  migrationOptions, postgresOptions, storageConfiguration,
  type PersistenceSource, type SourceFactory,
} from './configuration.js';
import { CityEntity, QuarterEntity, ReportEntity, type ReportRow } from './entities.js';
import { InitialSchema1792108800000 } from './initial-schema.js';
import { PostgresRepository } from './postgres-repository.js';

const config = { mode: 'postgres', url: 'postgresql://unit_user:unit_secret@mock.invalid/unit_only' } as const;
const city = { id: 9000, name: 'Mockstad' };
const quarter = { id: 1, cityId: 9000, quarter: 'Mockwijk' };
const row: ReportRow = {
  id: 41, cityId: 9000, quarterId: 1, latitude: 51, longitude: 3,
  createdAt: new Date('2026-10-16T12:00:00Z'), updatedAt: new Date('2026-10-16T12:01:00Z'),
  locationType: 'water', litterType: 'Plastic', extra: null,
};

// In-memory typed doubles only. No DataSource instance, driver initialize, or connection.
function doubles() {
  const lifecycle = { initialized: false };
  function create(): ReportRow;
  function create(input: DeepPartial<ReportRow>[]): ReportRow[];
  function create(input: DeepPartial<ReportRow>): ReportRow;
  function create(input?: DeepPartial<ReportRow> | DeepPartial<ReportRow>[]): ReportRow | ReportRow[] {
    const make = (value: DeepPartial<ReportRow>): ReportRow => ({
      ...row,
      cityId: value.cityId ?? 9000, quarterId: value.quarterId ?? null,
      latitude: value.latitude ?? 0, longitude: value.longitude ?? 0,
      locationType: value.locationType ?? 'water',
      litterType: value.litterType ?? null, extra: value.extra ?? null,
    });
    return Array.isArray(input) ? input.map(make) : make(input ?? {});
  }
  const source = {
    get isInitialized(): boolean { return lifecycle.initialized; },
    set isInitialized(value: boolean) { lifecycle.initialized = value; },
    initialize: vi.fn(async () => { source.isInitialized = true; }),
    destroy: vi.fn(async () => { source.isInitialized = false; }),
    cities: { find: vi.fn<PersistenceSource['cities']['find']>().mockResolvedValue([city]) },
    quarters: { find: vi.fn<PersistenceSource['quarters']['find']>().mockResolvedValue([quarter]) },
    reports: {
      find: vi.fn<PersistenceSource['reports']['find']>().mockResolvedValue([row]),
      findOneBy: vi.fn<PersistenceSource['reports']['findOneBy']>().mockResolvedValue(row),
      create,
      save: vi.fn<PersistenceSource['reports']['save']>().mockImplementation(async (input) => structuredClone(input)),
    },
  } satisfies PersistenceSource;
  const factory = vi.fn<SourceFactory>().mockReturnValue(source);
  return { source, factory };
}

describe('PostgreSQL adapter — typed mock provider, NOT PostgreSQL integration', () => {
  let clock = 2_100_000_000_000;
  const apps: INestApplication[] = [];
  beforeEach(() => {
    clock += 60_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    vi.restoreAllMocks();
  });

  it.each([undefined, '', 'production', 'DEMO'])('requires an explicit supported mode (%s)', (mode) => {
    expect(() => storageConfiguration(mode, config.url)).toThrow('DRIJFVUIL_MODE');
  });

  it.each([
    undefined, '', 'postgresql://user:secret@/database', 'https://user:secret@host/database',
    'postgresql://user:secret@host', ' postgres://user:secret@host/db',
    'postgresql://user:secret@host/db?host=other', 'postgresql://user:secret@host/db#fragment',
    'postgresql://host/database', 'postgresql://user@host/database',
    'postgresql://user:%zz@host/database',
  ])('rejects invalid/missing explicit URL without exposing credentials (%#)', (url) => {
    try {
      storageConfiguration('postgres', url);
      expect.fail('Expected invalid configuration');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain('DRIJFVUIL_DATABASE_URL');
      expect(error.message).not.toContain('secret');
      expect(error.message).not.toContain('user:');
    }
  });

  it('accepts both URL schemes without defaults; demo ignores URL and never creates/initializes a source', async () => {
    expect(storageConfiguration('postgres', config.url)).toEqual(config);
    expect(storageConfiguration('postgres', 'postgres://unit_user:unit_secret@mock.invalid/offline')).toEqual({
      mode: 'postgres', url: 'postgres://unit_user:unit_secret@mock.invalid/offline',
    });
    const { source, factory } = doubles();
    const app = await createApplication('demo', 'deliberately invalid URL', factory);
    apps.push(app);
    await app.init();
    expect(factory).not.toHaveBeenCalled();
    expect(source.initialize).not.toHaveBeenCalled();
    expect(app.get(REPORT_REPOSITORY)).toBeInstanceOf(DemoRepository);
    const result = await graphql({ schema: app.get(GraphQLSchemaHost).schema, source: EXPLORER_QUERY });
    expect(result.errors).toBeUndefined();
    expect(result.data?.storage).toEqual({ mode: 'demo', persistent: false, synthetic: true });
    expect(result.data?.reports).toHaveLength(3);
  });

  it('invalid startup cannot invoke the injected source factory', async () => {
    const { factory } = doubles();
    await expect(createApplication('postgres', undefined, factory)).rejects.toThrow('DRIJFVUIL_DATABASE_URL');
    expect(factory).not.toHaveBeenCalled();
  });

  it('uses only the injected fake, safe options and Nest resolver for reads/writes; closes on shutdown', async () => {
    const { source, factory } = doubles();
    const app = await createApplication('postgres', config.url, factory);
    apps.push(app);
    await app.init();
    expect(factory).toHaveBeenCalledExactlyOnceWith(postgresOptions(config));
    expect(source.initialize).toHaveBeenCalledOnce();
    expect(app.get(REPORT_REPOSITORY)).toBeInstanceOf(PostgresRepository);
    const schema = app.get(GraphQLSchemaHost).schema;
    const result = await graphql({ schema, source: EXPLORER_QUERY });
    expect(result.errors).toBeUndefined();
    expect(result.data?.storage).toEqual({ mode: 'postgres', persistent: true, synthetic: false });
    expect(result.data?.reports).toMatchObject([{
      id: 41, city, quarter, latLngTuple: [51, 3],
      createdAt: '2026-10-16T12:00:00.000Z', updatedAt: '2026-10-16T12:01:00.000Z',
      dbImageId: null, dbImage: null,
    }]);
    const created = await graphql({
      schema, source: CREATE_REPORT_MUTATION,
      variableValues: { createReportInput: { latLngTuple: [51, 3], quarterId: 1 } },
    });
    expect(created.errors).toBeUndefined();
    expect(created.data?.createReport).toMatchObject({ id: 41, city, quarter });
    expect(source.reports.save).toHaveBeenCalledOnce();
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    expect(source.destroy).toHaveBeenCalledOnce();
  });

  it('initialization failure surfaces sanitized failure and never falls back to fixtures', async () => {
    const { source, factory } = doubles();
    source.initialize.mockRejectedValueOnce(new Error(config.url));
    await expect(PostgresRepository.open(config, factory)).rejects.toThrow('geen demo-terugval');
    expect(source.reports.find).not.toHaveBeenCalled();
    expect(source.destroy).not.toHaveBeenCalled();
  });

  it('rejects actual Nest startup when the injected mock initialization fails, without demo fallback', async () => {
    const { source, factory } = doubles();
    source.initialize.mockRejectedValueOnce(new Error(config.url));
    await expect(createApplication('postgres', config.url, factory)).rejects.toThrow('geen demo-terugval');
    expect(factory).toHaveBeenCalledOnce();
    expect(source.reports.find).not.toHaveBeenCalled();
  });

  it('sanitizes provider-construction errors before any initialize or fallback', async () => {
    const { source, factory } = doubles();
    factory.mockImplementationOnce(() => { throw new Error(config.url); });
    await expect(PostgresRepository.open(config, factory)).rejects.toThrow('provider kon niet worden gemaakt');
    expect(source.initialize).not.toHaveBeenCalled();
  });

  it('cleans a partially initialized fake and sanitizes initialization/cleanup failures', async () => {
    const { source, factory } = doubles();
    source.initialize.mockImplementationOnce(async () => {
      source.isInitialized = true;
      throw new Error(config.url);
    });
    source.destroy.mockRejectedValueOnce(new Error(config.url));
    await expect(PostgresRepository.open(config, factory)).rejects.toThrow('initialisatie en opruimen mislukt');
    expect(source.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    [undefined, { cityId: 9000 }],
    [{ cityId: null, quarterId: 1 }, {}],
    [{ cityId: 0, quarterId: 1 }, {}],
    [{ cityId: 9050, quarterId: 1 }, { cityId: 9050, quarterId: 1 }],
    [{ cityId: 9000, quarterId: 0 }, { cityId: 9000 }],
    [{ cityId: 9000, quarterId: null, offset: 999, limit: 0 }, { cityId: 9000 }],
  ])('preserves truthy/default/null filters and ignored pagination (%j)', async (filters, where) => {
    const { source, factory } = doubles();
    const repository = await PostgresRepository.open(config, factory);
    await repository.reports(filters);
    expect(source.reports.find).toHaveBeenCalledExactlyOnceWith({ where, order: { id: 'ASC' } });
  });

  it('returns empty database results as empty, not fixtures; returns not-found explicitly', async () => {
    const { source, factory } = doubles();
    source.cities.find.mockResolvedValue([]);
    source.quarters.find.mockResolvedValue([]);
    source.reports.find.mockResolvedValue([]);
    source.reports.findOneBy.mockResolvedValue(null);
    const repository = await PostgresRepository.open(config, factory);
    await expect(repository.cities()).resolves.toEqual([]);
    await expect(repository.quarters()).resolves.toEqual([]);
    await expect(repository.reports()).resolves.toEqual([]);
    await expect(repository.report(123)).rejects.toThrow('niet gevonden');
  });

  it('maps nullable quarters and public field vocabulary on individual reads', async () => {
    const { source, factory } = doubles();
    source.reports.findOneBy.mockResolvedValue({ ...row, quarterId: null, litterType: null });
    const repository = await PostgresRepository.open(config, factory);
    await expect(repository.report(41)).resolves.toMatchObject({
      id: 41, quarter: null, quarterId: null, litterType: null, city,
      latLngTuple: [51, 3], dbImageId: null, dbImage: null,
    });
    expect(source.reports.findOneBy).toHaveBeenCalledExactlyOnceWith({ id: 41 });
  });

  it('does not hide inconsistent stored relations', async () => {
    const { source, factory } = doubles();
    source.quarters.find.mockResolvedValue([]);
    const repository = await PostgresRepository.open(config, factory);
    await expect(repository.reports()).rejects.toThrow('ongeldige meldingsrelaties');
  });

  it('propagates unexpected read/catalog/write errors, never empty arrays or fake success', async () => {
    const { source, factory } = doubles();
    const failure = new Error('mock operation failure');
    const repository = await PostgresRepository.open(config, factory);
    source.reports.find.mockRejectedValueOnce(failure);
    await expect(repository.reports()).rejects.toBe(failure);
    source.cities.find.mockRejectedValueOnce(failure);
    await expect(repository.cities()).rejects.toBe(failure);
    source.reports.findOneBy.mockRejectedValueOnce(failure);
    await expect(repository.report(41)).rejects.toBe(failure);
    source.reports.save.mockRejectedValueOnce(failure);
    await expect(repository.createReport({ latLngTuple: [51, 3] })).rejects.toBe(failure);
  });

  it('normalizes defaults/nulls and binds user content as entity values, never SQL interpolation', async () => {
    const { source, factory } = doubles();
    const repository = await PostgresRepository.open(config, factory);
    const text = "'); DROP TABLE report; --";
    const saved = await repository.createReport({ latLngTuple: [-90, 180], litterType: ' Plastic ', extra: text });
    expect(source.reports.save).toHaveBeenCalledWith(expect.objectContaining({
      cityId: 9000, quarterId: null, latitude: -90, longitude: 180,
      locationType: 'water', litterType: 'Plastic', extra: text,
    }));
    expect(saved).toMatchObject({
      city, cityId: 9000, quarter: null, quarterId: null, latLngTuple: [-90, 180],
      locationType: 'water', litterType: 'Plastic', extra: text, dbImage: null, dbImageId: null,
    });
  });

  it.each<{ input: Partial<CreateReportDto>; field: string }>([
    { input: { cityId: null }, field: 'cityId' },
    { input: { cityId: 42 }, field: 'cityId' },
    { input: { quarterId: 9 }, field: 'quarterId' },
    { input: { latLngTuple: [NaN, 3] }, field: 'latLngTuple' },
    { input: { latLngTuple: [91, 3] }, field: 'latLngTuple' },
    { input: { latLngTuple: [51, Infinity] }, field: 'latLngTuple' },
    { input: { locationType: 'sea' }, field: 'locationType' },
    { input: { extra: '😀'.repeat(183) }, field: 'extra' },
    { input: { litterType: ' ' }, field: 'litterType' },
    { input: { litterType: 'x'.repeat(81) }, field: 'litterType' },
    { input: { dbImageId: 'unsupported' }, field: 'dbImageId' },
  ])('shares API validation and rejects $field before saving (%#)', async ({ input, field }) => {
    const { source, factory } = doubles();
    const repository = await PostgresRepository.open(config, factory);
    await expect(repository.createReport({ latLngTuple: [51, 3], ...input })).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT', field },
    });
    expect(source.reports.save).not.toHaveBeenCalled();
  });

  it('rejects a known quarter attached to another city before saving', async () => {
    const { source, factory } = doubles();
    source.quarters.find.mockResolvedValue([{ ...quarter, cityId: 9050 }]);
    const repository = await PostgresRepository.open(config, factory);
    await expect(repository.createReport({ latLngTuple: [51, 3], quarterId: 1 })).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT', field: 'quarterId' },
    });
  });

  it.each([
    ['report_latitude_check', '23514', 'latLngTuple'],
    ['report_longitude_check', '23514', 'latLngTuple'],
    ['report_city_fk', '23503', 'cityId'],
    ['report_quarter_city_fk', '23503', 'quarterId'],
    ['report_location_check', '23514', 'locationType'],
    ['report_litter_check', '23514', 'litterType'],
    ['report_extra_check', '23514', 'extra'],
  ])('maps only the recognized database constraint %s to a safe field error', async (constraint, code, field) => {
    const { source, factory } = doubles();
    source.reports.save.mockRejectedValueOnce(new QueryFailedError('mock insert', [], Object.assign(
      new Error('driver message must not be shown'), { constraint, code },
    )));
    const repository = await PostgresRepository.open(config, factory);
    await expect(repository.createReport({ latLngTuple: [51, 3] })).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT', field },
    });
  });

  it.each([['unrecognized', '23514'], ['report_city_fk', 'XX000']])('does not relabel unexpected driver errors (%s, %s)', async (constraint, code) => {
    const { source, factory } = doubles();
    const error = new QueryFailedError('mock insert', [], Object.assign(new Error('unexpected'), { constraint, code }));
    source.reports.save.mockRejectedValueOnce(error);
    const repository = await PostgresRepository.open(config, factory);
    await expect(repository.createReport({ latLngTuple: [51, 3] })).rejects.toBe(error);
  });

  it('enforces five attempts per minute across demo and mock postgres; invalid attempts count', async () => {
    const { source, factory } = doubles();
    const repository = await PostgresRepository.open(config, factory);
    const demo = new DemoRepository();
    for (let index = 0; index < 3; index += 1) {
      await expect(repository.createReport({ latLngTuple: [91, 3] })).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    }
    for (let index = 0; index < 2; index += 1) {
      expect(() => demo.createReport({ latLngTuple: [91, 3] })).toThrow();
    }
    await expect(repository.createReport({ latLngTuple: [51, 3] })).rejects.toMatchObject({
      extensions: { code: 'DEMO_RATE_LIMIT', retryAfterSeconds: 60 },
    });
    expect(source.reports.save).not.toHaveBeenCalled();
  });

  it('makes shutdown idempotent and surfaces cleanup failures', async () => {
    const { source, factory } = doubles();
    const repository = await PostgresRepository.open(config, factory);
    await repository.onApplicationShutdown();
    await repository.onApplicationShutdown();
    expect(source.destroy).toHaveBeenCalledOnce();
    source.isInitialized = true;
    source.destroy.mockRejectedValueOnce(new Error('mock shutdown failure'));
    await expect(repository.onApplicationShutdown()).rejects.toThrow('mock shutdown failure');
  });

  it('shares the 100-additions process cap across mock postgres instances without inventing production security', async () => {
    const { source, factory } = doubles();
    const first = await PostgresRepository.open(config, factory);
    const second = await PostgresRepository.open(config, factory);
    let additions = 0;
    for (let index = 0; index < 101; index += 1) {
      clock += 60_000;
      try {
        await (index % 2 ? first : second).createReport({ latLngTuple: [51, 3] });
        additions += 1;
      } catch (error: unknown) {
        expect(error).toMatchObject({ extensions: { code: 'DEMO_CAPACITY' } });
        break;
      }
    }
    // Earlier tests also consumed reservations; no test-only reset weakens the process policy.
    expect(additions).toBeGreaterThan(0);
    expect(additions).toBeLessThanOrEqual(100);
    const calls = source.reports.save.mock.calls.length;
    clock += 60_000;
    await expect(second.createReport({ latLngTuple: [51, 3] })).rejects.toMatchObject({
      extensions: { code: 'DEMO_CAPACITY' },
    });
    expect(source.reports.save).toHaveBeenCalledTimes(calls);
  });
});

describe('new-schema migration SQL review with mocked QueryRunner only (never executed)', () => {
  it('requires explicit postgres mode and URL for manual CLI options; disables automatic mutations/seeds', () => {
    expect(() => migrationOptions('demo', config.url)).toThrow('DRIJFVUIL_MODE=postgres');
    expect(() => migrationOptions('postgres')).toThrow('DRIJFVUIL_DATABASE_URL');
    expect(postgresOptions(config)).toMatchObject({
      type: 'postgres', synchronize: false, migrationsRun: false, dropSchema: false,
      migrationsTransactionMode: 'all', logging: false,
      migrations: [InitialSchema1792108800000], entities: [CityEntity, QuarterEntity, ReportEntity],
    });
    expect(migrationOptions('postgres', config.url)).toEqual(postgresOptions(config));
  });

  it('declares explicit columns/types/nullability without image/geometry storage or decorator transforms', () => {
    expect(CityEntity.options.schema).toBe('drijfvuil_m3');
    expect(QuarterEntity.options.columns.cityId).toMatchObject({ name: 'city_id', type: 'integer' });
    expect(ReportEntity.options.columns.createdAt).toMatchObject({ type: 'timestamptz' });
    expect(ReportEntity.options.columns.quarterId).toMatchObject({ nullable: true });
    expect(ReportEntity.options.columns.latitude).toMatchObject({ type: 'double precision' });
    expect(Object.keys(ReportEntity.options.columns)).not.toContain('dbImageId');
  });

  it('creates new schema in dependency order with finite/range, catalog, same-city, text and location constraints; no seed SQL', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const migration = new InitialSchema1792108800000();
    await migration.up({ query });
    // TypeORM rejects per-migration transaction overrides with transaction mode "all".
    expect('transaction' in migration).toBe(false);
    const sql = query.mock.calls.map(([text]) => text).join('\n');
    expect(query.mock.calls[0]?.[0]).toBe('CREATE SCHEMA "drijfvuil_m3"');
    expect(query.mock.calls[1]?.[0]).toContain('"drijfvuil_m3"."city"');
    expect(query.mock.calls[2]?.[0]).toContain('"drijfvuil_m3"."quarter"');
    expect(query.mock.calls[3]?.[0]).toContain('"drijfvuil_m3"."report"');
    for (const fragment of [
      '"latitude" BETWEEN -90 AND 90', '"longitude" BETWEEN -180 AND 180',
      'CONSTRAINT "report_city_fk"', 'FOREIGN KEY ("quarter_id", "city_id")',
      'REFERENCES "drijfvuil_m3"."quarter" ("id", "city_id")',
      "IN ('water', 'land')", '<= 364', '<= 80', 'timestamptz', 'serial PRIMARY KEY',
      "U&'[^\\+010000-\\+10FFFF]'", 'btrim("litter_type"', '\\FEFF', 'CREATE INDEX',
    ]) expect(sql).toContain(fragment);
    // PostgreSQL float NaN sorts above Infinity, so BETWEEN rejects both as well as infinities.
    expect(sql).not.toMatch(/INSERT|ON CONFLICT|IF NOT EXISTS|geometry|db_image|CASCADE/i);
  });

  it('drops report before catalog tables and schema, without cascade or legacy tables', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    await new InitialSchema1792108800000().down({ query });
    expect(query.mock.calls.map(([text]) => text)).toEqual([
      'DROP TABLE "drijfvuil_m3"."report"', 'DROP TABLE "drijfvuil_m3"."quarter"',
      'DROP TABLE "drijfvuil_m3"."city"', 'DROP SCHEMA "drijfvuil_m3"',
    ]);
  });

  it('propagates mocked migration failures rather than pretending success', async () => {
    const failure = new Error('mock SQL failure');
    const query = vi.fn<QueryRunner['query']>().mockRejectedValue(failure);
    const migration = new InitialSchema1792108800000();
    await expect(migration.up({ query })).rejects.toBe(failure);
    await expect(migration.down({ query })).rejects.toBe(failure);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
