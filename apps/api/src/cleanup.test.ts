import { request, type IncomingHttpHeaders } from 'node:http';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPORT_SCHEMA, SET_REPORT_CLEANED_MUTATION } from '../../../libs/contracts/src/index.js';
import { createDemoApplication } from './bootstrap.js';
import { DemoAuth, DemoAccountGuard, authHttpStatusPlugin } from './demo-auth.js';
import { DemoRepository } from './demo-repository.js';
import { PostgresRepository } from './persistence/postgres-repository.js';
import { REPORT_REPOSITORY } from './repository.js';
import { ReportsResolver } from './reports.resolver.js';

function http(base: string, path: string, options: {
  cookie?: string; body?: unknown; headers?: Record<string, string | undefined>;
} = {}) {
  return new Promise<{ status: number; body: Record<string, unknown>; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const headers: Record<string, string | undefined> = {
      host: '127.0.0.1:4200', origin: 'http://127.0.0.1:4200',
      'content-type': 'application/json', cookie: options.cookie, ...options.headers,
    };
    const req = request(`${base}${path}`, {
      method: 'POST', headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)),
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(body), headers: res.headers }); }
        catch (cause) { reject(cause); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP test timeout')));
    req.end(JSON.stringify(options.body ?? {}));
  });
}

const mutation = (id: unknown = 1, cleaned: unknown = true) => ({
  query: SET_REPORT_CLEANED_MUTATION, variables: { id, cleaned },
});
const read = { query: `query {
  report(id: 1) { id cleaned updatedAt cityId quarterId }
  reports(cityId: 9000, quarterId: 1, offset: 999, limit: 0) { id cleaned cityId quarterId }
}` };

describe('M6 real Nest HTTP cleanup: shared demo desired state, public reads, unchanged create', () => {
  let app: INestApplication;
  let base: string;
  let water: string;
  let oever: string;
  let oeverExpiresAt: number;
  const start = Date.now();
  let tick = 0;
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(start + (++tick * 60_000)); });
  afterEach(() => vi.restoreAllMocks());
  beforeAll(async () => {
    app = await createDemoApplication('demo');
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    for (const account of ['water', 'oever']) {
      const loggedIn = await http(base, '/auth/login', { body: {
        login: `${account}@demo.invalid`, password: account === 'water' ? 'Demo-water-1!' : 'Demo-oever-2!',
      } });
      expect(loggedIn.status).toBe(200);
      const cookie = loggedIn.headers['set-cookie']![0]!.split(';')[0]!;
      if (account === 'water') water = cookie;
      else {
        oever = cookie;
        oeverExpiresAt = Date.parse((loggedIn.body.session as { expiresAt: string }).expiresAt);
      }
    }
  });
  afterAll(async () => { await app?.close(); });

  it('publishes false defaults and denies anonymous writes without changing public state', async () => {
    expect((await http(base, '/graphql', { body: read })).body).toMatchObject({
      data: { report: { id: 1, cleaned: false }, reports: [{ id: 1, cleaned: false }, { id: 2, cleaned: false }] },
    });
    const denied = await http(base, '/graphql', { body: mutation() });
    expect(denied.status).toBe(401);
    expect(denied.body).toMatchObject({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }], data: null });
  });

  it('uses exact M5 Origin/Host policy; forwarded values cannot authorize a mismatch or missing origin', async () => {
    const invalid: Record<string, string | undefined>[] = [
      { origin: undefined }, { origin: '' }, { origin: 'null' },
      { origin: 'https://foreign.invalid' }, { origin: 'http://127.0.0.1:4200.evil.invalid' },
      { origin: 'http://localhost:4200' }, { host: '127.0.0.1:3333' },
      { host: 'foreign.invalid', 'x-forwarded-host': '127.0.0.1:4200', 'x-forwarded-proto': 'http' },
      { origin: undefined, forwarded: 'host=127.0.0.1:4200;proto=http' },
      { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    ];
    for (const headers of invalid) {
      const denied = await http(base, '/graphql', { cookie: water, body: mutation(), headers });
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ errors: [{ extensions: { code: 'FORBIDDEN' } }], data: null });
    }
    expect((await http(base, '/graphql', { body: read })).body).toMatchObject({ data: { report: { cleaned: false } } });
    // As in M5, spoofed forwarding is ignored, not used to override valid raw headers.
    expect((await http(base, '/graphql', {
      cookie: water, body: mutation(1, false),
      headers: { forwarded: 'host=foreign.invalid;proto=https', 'x-forwarded-host': 'foreign.invalid', 'sec-fetch-site': 'same-origin' },
    })).status).toBe(200);
  });

  it('marks, repeats idempotently, shares across both accounts, reopens and keeps filter/list identity', async () => {
    const before = (await http(base, '/graphql', { body: read })).body;
    const marked = await http(base, '/graphql', { cookie: water, body: mutation() });
    expect(marked.body).toMatchObject({ data: { setReportCleaned: { id: 1, cleaned: true, cityId: 9000, quarterId: 1 } } });
    const repeated = await http(base, '/graphql', { cookie: water, body: mutation() });
    expect(repeated.body).toEqual(marked.body);
    const crossAccount = await http(base, '/graphql', { cookie: oever, body: mutation() });
    expect(crossAccount.body).toEqual(marked.body);
    expect((await http(base, '/graphql', { body: read })).body).toMatchObject({
      data: { report: { id: 1, cleaned: true }, reports: [{ id: 1, cleaned: true }, { id: 2, cleaned: false }] },
    });
    const reopened = await http(base, '/graphql', { cookie: oever, body: mutation(1, false) });
    expect(reopened.body).toMatchObject({ data: { setReportCleaned: { id: 1, cleaned: false } } });
    expect((await http(base, '/graphql', { body: read })).body).toMatchObject({
      data: { reports: (before.data as { reports: unknown }).reports },
    });
  });

  it('rejects malformed, missing, null, wrong-type and unknown IDs with explicit errors, never fallbacks', async () => {
    for (const variables of [{ id: 0, cleaned: true }, { id: -1, cleaned: false }]) {
      expect((await http(base, '/graphql', { cookie: water, body: { query: SET_REPORT_CLEANED_MUTATION, variables } })).body)
        .toMatchObject({ errors: [{ extensions: { code: 'BAD_USER_INPUT' } }], data: null });
    }
    expect((await http(base, '/graphql', { cookie: water, body: mutation(999999) })).body)
      .toMatchObject({ errors: [{ extensions: { code: 'NOT_FOUND' } }], data: null });
    for (const variables of [{ id: 1 }, { cleaned: true }, { id: null, cleaned: true },
      { id: 1, cleaned: null }, { id: 1.2, cleaned: true }, { id: '1', cleaned: true }, { id: 1, cleaned: 'true' }]) {
      const result = await http(base, '/graphql', { cookie: water, body: { query: SET_REPORT_CLEANED_MUTATION, variables } });
      expect(result.status).toBe(400);
      expect(result.body).toHaveProperty('errors');
      expect(result.body.data).toBeUndefined();
    }
  });

  it('bounds cleanup attempts separately at 20 per rolling minute across accounts; public creation quota stays intact', async () => {
    for (let index = 0; index < 20; index++) {
      expect((await http(base, '/graphql', { cookie: index % 2 ? water : oever, body: mutation(1, false) })).body)
        .toHaveProperty('data.setReportCleaned.cleaned', false);
    }
    expect((await http(base, '/graphql', { cookie: oever, body: mutation() })).body)
      .toMatchObject({ errors: [{ extensions: { code: 'DEMO_RATE_LIMIT', retryAfterSeconds: 60 } }], data: null });
    const created = await http(base, '/graphql', { body: {
      query: `mutation { createReport(createReportInput: { latLngTuple: [51, 3] }) { id cleaned } }`,
    } });
    expect(created.body).toMatchObject({ data: { createReport: { id: 5, cleaned: false } } });
    vi.mocked(Date.now).mockReturnValue(start + tick * 60_000 + 60_000);
    expect((await http(base, '/graphql', { cookie: oever, body: mutation(5) })).body)
      .toHaveProperty('data.setReportCleaned.cleaned', true);
  });

  it('revokes immediately and rejects absolute expiry through the same real HTTP mutation', async () => {
    await http(base, '/auth/logout', { cookie: water });
    expect((await http(base, '/graphql', { cookie: water, body: mutation() })).status).toBe(401);
    vi.mocked(Date.now).mockReturnValue(oeverExpiresAt);
    expect((await http(base, '/graphql', { cookie: oever, body: mutation() })).status).toBe(401);
    expect((await http(base, '/graphql', { body: read })).status).toBe(200);
  });

  it('keeps source data isolated from mutation/read snapshots and repeated desired state leaves timestamps unchanged', () => {
    const repo = new DemoRepository();
    const snapshot = repo.setReportCleaned(2, true);
    snapshot.cleaned = false;
    snapshot.city.name = 'mutated';
    snapshot.latLngTuple[0] = 0;
    const confirmed = repo.report(2);
    expect(confirmed.cleaned).toBe(true);
    expect(confirmed.city.name).toBe('Gent');
    expect(confirmed.latLngTuple[0]).not.toBe(0);
    expect(repo.setReportCleaned(2, true)).toEqual(confirmed);
    repo.reports()[0]!.cleaned = true;
    expect(repo.report(1).cleaned).toBe(false);
    expect(() => repo.setReportCleaned(1, undefined as unknown as boolean)).toThrow();
    expect(() => repo.setReportCleaned(NaN, true)).toThrow();
  });
});

const pgWrite = vi.fn();
@Module({
  imports: [GraphQLModule.forRoot<ApolloDriverConfig>({
    driver: ApolloDriver, typeDefs: REPORT_SCHEMA, playground: false,
    context: ({ req }: { req: unknown }) => ({ req }), plugins: [authHttpStatusPlugin],
    preserveHttpStatusForExecutionErrors: false,
  })],
  providers: [ReportsResolver, DemoAuth, DemoAccountGuard, {
    provide: REPORT_REPOSITORY,
    useValue: { storage: { mode: 'postgres', persistent: true, synthetic: false }, setReportCleaned: pgWrite },
  }],
})
class FakePostgresCleanup {}

describe('M6 PostgreSQL capability refusal without physical source or driver', () => {
  it('denies at HTTP auth capability gate and in adapter method before any source access', async () => {
    const driverInitialize = vi.spyOn(DataSource.prototype, 'initialize').mockImplementation(() => {
      throw new Error('Real driver initialization is forbidden in M6 checks');
    });
    const app = await NestFactory.create(FakePostgresCleanup, { logger: false });
    try {
      await app.listen(0, '127.0.0.1');
      const result = await http(await app.getUrl(), '/graphql', { cookie: 'drijfvuil_demo=not-real', body: mutation() });
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ errors: [{ extensions: { code: 'FORBIDDEN' } }], data: null });
      expect(pgWrite).not.toHaveBeenCalled();
      const adapter = Object.create(PostgresRepository.prototype) as PostgresRepository;
      expect(() => adapter.setReportCleaned(1, true)).toThrow('uitsluitend beschikbaar');
      expect(driverInitialize).not.toHaveBeenCalled();
    } finally { await app.close(); driverInitialize.mockRestore(); }
  });
});
