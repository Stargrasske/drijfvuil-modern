import type { INestApplication } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { graphql, type GraphQLSchema } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPLORER_QUERY } from '../../../libs/contracts/src/index.js';
import { createDemoApplication } from './bootstrap.js';
import { DemoRepository } from './demo-repository.js';

describe('real Nest GraphQL demo reads', () => {
  let app: INestApplication;
  let schema: GraphQLSchema;

  beforeAll(async () => {
    app = await createDemoApplication('demo');
    await app.init();
    schema = app.get(GraphQLSchemaHost).schema;
  });
  afterAll(async () => { await app?.close(); });

  async function reports(variables?: Record<string, unknown>) {
    return graphql({ schema, source: EXPLORER_QUERY, variableValues: variables });
  }

  it('requires explicit demo startup; does not silently use fixtures as production', async () => {
    await expect(createDemoApplication(undefined)).rejects.toThrow('DRIJFVUIL_MODE=demo');
    await expect(createDemoApplication('production')).rejects.toThrow('synthetische');
  });

  it('executes the actual client query with omitted city defaulting to 9000', async () => {
    const result = await reports();
    expect(result.errors).toBeUndefined();
    expect(result.data?.reports).toHaveLength(3);
    expect(result.data?.cities).toHaveLength(2);
    expect(result.data?.quarters).toHaveLength(3);
  });

  it('filters an explicit city and exposes legacy report field vocabulary', async () => {
    const result = await reports({ cityId: 9050, quarterId: null });
    expect(result.errors).toBeUndefined();
    expect(result.data?.reports).toMatchObject([{
      id: 4, cityId: 9050, quarterId: 3,
      city: { id: 9050, name: 'Gentbrugge' },
      quarter: { id: 3 }, dbImage: null, dbImageId: null,
      latLngTuple: [51.0347, 3.7578],
      createdAt: '2026-10-16T09:00:00.000Z',
    }]);
  });

  it('filters city and quarter together', async () => {
    const result = await reports({ cityId: 9000, quarterId: 2 });
    expect(result.errors).toBeUndefined();
    expect(result.data?.reports).toMatchObject([{ id: 3 }]);
  });

  it('returns an empty result for a quarter belonging to another city', async () => {
    const result = await reports({ cityId: 9050, quarterId: 1 });
    expect(result.errors).toBeUndefined();
    expect(result.data?.reports).toEqual([]);
  });

  it('preserves explicit null city as all cities, ignoring quarter without city', async () => {
    const result = await reports({ cityId: null, quarterId: 2 });
    expect(result.errors).toBeUndefined();
    expect(result.data?.reports).toHaveLength(4);
  });

  it('preserves legacy truthy-filter handling of zero city', async () => {
    const result = await reports({ cityId: 0 });
    expect(result.errors).toBeUndefined();
    expect(result.data?.reports).toHaveLength(4);
  });

  it('keeps legacy offset/limit as documented no-ops, not invented pagination', async () => {
    const result = await graphql({
      schema,
      source: '{ reports(cityId: null, offset: 10, limit: 0) { id } }',
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.reports).toHaveLength(4);
  });

  it('looks up an individual report', async () => {
    const result = await graphql({ schema, source: '{ report(id: 2) { id extra } }' });
    expect(result.errors).toBeUndefined();
    expect(result.data?.report).toMatchObject({ id: 2, extra: 'Verpakkingen naast het wandelpad.' });
  });

  it('surfaces a missing report as a GraphQL error instead of fake data', async () => {
    const result = await graphql({ schema, source: '{ report(id: 999) { id } }' });
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.message).toContain('niet gevonden');
  });

  it('uses actual GraphQL integer coercion', async () => {
    const result = await reports({ cityId: '9000' });
    expect(result.errors?.[0]?.message).toContain('Int');
    expect(result.data).toBeUndefined();
  });

  it('exposes anonymous create and guarded demo cleanup, never destructive operations', () => {
    expect(Object.keys(schema.getMutationType()?.getFields() ?? {})).toEqual(['createReport', 'setReportCleaned']);
    expect(schema.getType('User')).toBeUndefined();
  });

  it('rejects legacy writes rather than implying full API parity', async () => {
    for (const source of [
      'mutation { handleFullCleanup(id: 1) { id } }',
      'mutation { deleteReport(id: 1) { id } }',
      'mutation { updateReport(id: 1) { id } }',
      'mutation { login { token } }',
      'mutation { register { id } }',
    ]) {
      const result = await graphql({ schema, source });
      expect(result.errors?.length).toBeGreaterThan(0);
    }
  });

  it('returns defensive fixture copies with no shared mutation', () => {
    const repository = app.get(DemoRepository);
    const report = repository.report(1);
    report.city.name = 'Changed';
    report.latLngTuple[0] = 0;
    expect(repository.report(1).city.name).toBe('Gent');
    expect(repository.report(1).latLngTuple[0]).toBe(51.0543);
  });

  it('keeps read-only lookup shapes used by the filter controls', async () => {
    const result = await reports({ cityId: null });
    expect(result.errors).toBeUndefined();
    expect(result.data?.cities).toContainEqual({ id: 9000, name: 'Gent' });
    expect(result.data?.quarters).toContainEqual({ id: 1, cityId: 9000, quarter: 'Binnenstad' });
  });
});
