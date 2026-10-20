import type { INestApplication } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { graphql, type GraphQLSchema } from 'graphql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_REPORT_MUTATION } from '../../../libs/contracts/src/index.js';
import { createDemoApplication } from './bootstrap.js';
import { DemoRepository } from './demo-repository.js';

describe('Nest-built createReport GraphQL schema and process budget', () => {
  let app: INestApplication;
  let schema: GraphQLSchema;
  let clock = 2_000_000_000_000;
  let created = 0;

  beforeAll(async () => {
    app = await createDemoApplication('demo');
    await app.init();
    schema = app.get(GraphQLSchemaHost).schema;
  });
  beforeEach(() => {
    clock += 60_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await app?.close(); });

  async function create(input: Record<string, unknown> = {}, target = schema) {
    const result = await graphql({
      schema: target, source: CREATE_REPORT_MUTATION,
      variableValues: { createReportInput: { latLngTuple: [51, 3], ...input } },
    });
    if (result.data?.createReport) created += 1;
    return result;
  }

  it('creates anonymously and returns the full legacy-shaped report, lookup and filter visibility', async () => {
    const result = await create({ cityId: 9050, quarterId: 3, locationType: 'land', litterType: 'Plastic', extra: 'Demo' });
    expect(result.errors).toBeUndefined();
    expect(result.data?.createReport).toMatchObject({
      id: 5, cityId: 9050, quarterId: 3, latLngTuple: [51, 3],
      city: { id: 9050, name: 'Gentbrugge' }, quarter: { id: 3, cityId: 9050 },
      locationType: 'land', litterType: 'Plastic', extra: 'Demo', dbImageId: null, dbImage: null,
    });
    const queries = await graphql({
      schema, source: `{
        report(id: 5) { id extra }
        reports(cityId: 9050, quarterId: 3, offset: 999, limit: 0) { id }
        defaultCity: reports { id }
        all: reports(cityId: null, quarterId: 1) { id }
      }`,
    });
    expect(queries.errors).toBeUndefined();
    expect(queries.data?.report).toEqual({ id: 5, extra: 'Demo' });
    expect(queries.data?.reports).toContainEqual({ id: 5 });
    expect(queries.data?.defaultCity).not.toContainEqual({ id: 5 });
    expect(queries.data?.all).toContainEqual({ id: 5 });
  });

  it('defaults city/water and preserves nullable optional legacy fields', async () => {
    const result = await create();
    expect(result.errors).toBeUndefined();
    expect(result.data?.createReport).toMatchObject({
      cityId: 9000, quarterId: null, quarter: null, locationType: 'water',
      litterType: null, extra: null, dbImageId: null, dbImage: null,
    });
    expect((await create({ locationType: null, litterType: null, dbImageId: '' })).errors).toBeUndefined();
    expect((await create({ dbImageId: null })).errors).toBeUndefined();
  });

  it.each([
    { latLngTuple: [] }, { latLngTuple: [51] }, { latLngTuple: [51, 3, 0] },
    { latLngTuple: [90.01, 3] }, { latLngTuple: [-90.01, 3] },
    { latLngTuple: [51, 180.01] }, { latLngTuple: [51, -180.01] },
    { cityId: 9999 }, { cityId: null }, { quarterId: 999 },
    { cityId: 9050, quarterId: 1 }, { locationType: 'sea' }, { locationType: '' },
    { litterType: '' }, { litterType: '   ' }, { litterType: 'x'.repeat(81) },
    { extra: 'x'.repeat(365) }, { dbImageId: 'image-id' }, { dbImageId: ' ' },
  ])('rejects resolver-level invalid input %j', async (input) => {
    const result = await create(input);
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT');
  });

  it('accepts exact coordinate/extra/litter boundaries and null quarter', async () => {
    for (const latLngTuple of [[-90, -180], [90, 180]]) {
      const result = await create({
        latLngTuple, quarterId: null, litterType: 'x'.repeat(80), extra: 'x'.repeat(364),
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.createReport).toMatchObject({ latLngTuple, extra: 'x'.repeat(364) });
    }
  });

  it('GraphQL rejects nonfinite/coercion/unknown fields before resolver without charging the budget', async () => {
    for (const input of [
      { latLngTuple: [Number.NaN, 3] }, { latLngTuple: [Number.POSITIVE_INFINITY, 3] },
      { latLngTuple: [51, Number.NEGATIVE_INFINITY] }, { latLngTuple: null },
      { cityId: '9000' }, { unsupported: true },
    ]) {
      expect((await create(input)).data).toBeUndefined();
    }
    const missing = await graphql({ schema, source: 'mutation { createReport(createReportInput: {}) { id } }' });
    expect(missing.errors?.length).toBeGreaterThan(0);
    for (let index = 0; index < 5; index += 1) expect((await create()).errors).toBeUndefined();
    expect((await create()).errors?.[0]?.extensions.code).toBe('DEMO_RATE_LIMIT');
  });

  it('charges invalid resolver-reaching attempts, returns retry information, and uses an exact rolling window', async () => {
    for (let index = 0; index < 5; index += 1) {
      expect((await create({ extra: 'x'.repeat(365) })).errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT');
    }
    const denied = await create();
    expect(denied.errors?.[0]?.extensions).toMatchObject({
      code: 'DEMO_RATE_LIMIT', retryAfterMs: 60_000, retryAfterSeconds: 60,
    });
    clock += 59_999;
    expect((await create()).errors?.[0]?.extensions.retryAfterMs).toBe(1);
    clock += 1;
    expect((await create()).errors).toBeUndefined();
  });

  it('aliases and different calls/apps share one process limiter, but repositories remain per-app', async () => {
    const before = app.get(DemoRepository).reports({ cityId: null }).length;
    const aliases = await graphql({
      schema,
      source: `mutation { ${Array.from({ length: 6 }, (_, index) =>
        `r${index}: createReport(createReportInput: {latLngTuple: [51, 3]}) { id }`).join('\n')} }`,
    });
    expect(aliases.errors?.[0]?.extensions.code).toBe('DEMO_RATE_LIMIT');
    expect(aliases.errors?.[0]?.path).toEqual(['r5']);
    expect(app.get(DemoRepository).reports({ cityId: null })).toHaveLength(before + 5);
    created += 5;
    const second = await createDemoApplication('demo');
    try {
      await second.init();
      const secondSchema = second.get(GraphQLSchemaHost).schema;
      expect(second.get(DemoRepository).reports({ cityId: null })).toHaveLength(4);
      expect((await create({}, secondSchema)).errors?.[0]?.extensions.code).toBe('DEMO_RATE_LIMIT');
      const deniedAlias = await graphql({
        schema, source: 'mutation { other: createReport(createReportInput: {latLngTuple: [51, 3]}) { id } }',
      });
      expect(deniedAlias.errors?.[0]?.extensions.code).toBe('DEMO_RATE_LIMIT');
      clock += 60_000;
      expect((await create({}, secondSchema)).errors).toBeUndefined();
      expect(second.get(DemoRepository).reports({ cityId: null })).toHaveLength(5);
    } finally {
      await second.close();
    }
  });

  it('uses a rolling window rather than a resettable fixed-minute bucket', async () => {
    for (let index = 0; index < 3; index += 1) await create({ cityId: -1 });
    clock += 30_000;
    for (let index = 0; index < 2; index += 1) await create({ cityId: -1 });
    clock += 30_000;
    for (let index = 0; index < 3; index += 1) expect((await create()).errors).toBeUndefined();
    expect((await create()).errors?.[0]?.extensions).toMatchObject({
      code: 'DEMO_RATE_LIMIT', retryAfterSeconds: 30,
    });
  });

  it('stores defensive copies of inputs, output and nested query objects', async () => {
    const coordinates = [51, 3];
    const result = await create({ latLngTuple: coordinates, quarterId: 1 });
    expect(result.errors).toBeUndefined();
    coordinates[0] = 0;
    const repository = app.get(DemoRepository);
    const id = repository.reports({ cityId: null }).at(-1)?.id;
    expect(id).toBeDefined();
    if (id === undefined) throw new Error('Expected created report');
    const copy = repository.report(id);
    copy.city.name = 'Changed';
    if (copy.quarter) copy.quarter.quarter = 'Changed';
    copy.latLngTuple[0] = 0;
    const list = repository.reports({ cityId: null });
    list.splice(0);
    expect(repository.report(id)).toMatchObject({
      latLngTuple: [51, 3], city: { name: 'Gent' }, quarter: { quarter: 'Binnenstad' },
    });
    const detached = repository.createReport({ latLngTuple: [52, 4] });
    created += 1;
    detached.latLngTuple[0] = 0;
    expect(repository.report(detached.id).latLngTuple).toEqual([52, 4]);
  });

  it('caps all newly added reports at exactly 100 process-wide, excluding fixtures, with no clearing', async () => {
    while (created < 100) {
      clock += 60_000;
      expect((await create()).errors).toBeUndefined();
    }
    clock += 60_000;
    const rejected = await create();
    expect(rejected.errors?.[0]?.extensions.code).toBe('DEMO_CAPACITY');
    expect(rejected.errors?.[0]?.message).toContain('100');
    const second = await createDemoApplication('demo');
    try {
      await second.init();
      expect((await create({}, second.get(GraphQLSchemaHost).schema)).errors?.[0]?.extensions.code).toBe('DEMO_CAPACITY');
      expect(second.get(DemoRepository).reports({ cityId: null })).toHaveLength(4);
    } finally { await second.close(); }
    expect(Object.keys(schema.getMutationType()?.getFields() ?? {})).toEqual(['createReport', 'setReportCleaned']);
  });
});
