import { request, type IncomingHttpHeaders } from 'node:http';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REPORT_SCHEMA, DEMO_ACCOUNT_QUERY } from '../../../libs/contracts/src/index.js';
import { createDemoApplication } from './bootstrap.js';
import {
  AuthController, DemoAuth, DemoAccountGuard, DemoAuthState, LOGIN_LIMIT, SESSION_LIMIT,
  SESSION_MS, verifyDemoPassword, authHttpStatusPlugin,
} from './demo-auth.js';
import { REPORT_REPOSITORY } from './repository.js';
import { ReportsResolver } from './reports.resolver.js';

const water = { login: 'water@demo.invalid', password: 'Demo-water-1!' };
const oever = { login: 'oever@demo.invalid', password: 'Demo-oever-2!' };

describe('awaited salted scrypt and bounded process state', () => {
  it('verifies both synthetic passwords; wrong and unknown fail generically after awaiting crypto', async () => {
    expect(await verifyDemoPassword(water.login, water.password)).toEqual({ id: 'demo-water', name: 'Demo Water' });
    expect(await verifyDemoPassword(oever.login, oever.password)).toEqual({ id: 'demo-oever', name: 'Demo Oever' });
    expect(await verifyDemoPassword(water.login, 'wrong')).toBeNull();
    expect(await verifyDemoPassword('unknown@demo.invalid', water.password)).toBeNull();
  });

  it('expires absolutely at 30 minutes, returns copies, and revokes logout immediately', async () => {
    let now = 0;
    const state = new DemoAuthState(() => now);
    const first = await state.login(water);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    first.session.account.name = 'changed';
    now = SESSION_MS - 1;
    expect(state.session(first.token)?.account.name).toBe('Demo Water');
    expect(state.session(first.token)?.expiresAt).toBe(new Date(SESSION_MS).toISOString());
    now++;
    expect(state.session(first.token)).toBeNull();
    const second = await state.login(oever);
    state.logout(second.token);
    state.logout(second.token);
    expect(state.session(second.token)).toBeNull();
  });

  it('rotates successful login, preserves old session on failure and separates accounts', async () => {
    const state = new DemoAuthState();
    const first = await state.login(water);
    await expect(state.login({ ...water, password: 'wrong' }, first.token)).rejects.toMatchObject({ status: 401 });
    expect(state.session(first.token)?.account.id).toBe('demo-water');
    const second = await state.login(oever, first.token);
    expect(second.token).not.toBe(first.token);
    expect(state.session(first.token)).toBeNull();
    expect(state.session(second.token)?.account.id).toBe('demo-oever');
  });

  it('shares a five-attempt rolling budget for valid, invalid and malformed attempts without unbounded keys', async () => {
    let now = 0;
    const state = new DemoAuthState(() => now);
    for (let index = 0; index < LOGIN_LIMIT; index++) {
      await expect(state.login({ login: 'x', password: 'wrong' })).rejects.toMatchObject({ status: 401 });
    }
    await expect(state.login(water)).rejects.toMatchObject({ status: 429 });
    now = 60_000;
    await expect(state.login({ password: 1 })).rejects.toMatchObject({ status: 401 });
    await expect(state.login({ login: 'x'.repeat(81), password: 'x' })).rejects.toMatchObject({ status: 401 });
    await expect(state.login({ ...water, password: 'x'.repeat(129) })).rejects.toMatchObject({ status: 401 });
  });

  it('limits concurrent async verification to two and releases reservations after failure', async () => {
    const state = new DemoAuthState();
    const one = state.login({ ...water, password: 'wrong' });
    const two = state.login(oever);
    await expect(state.login(water)).rejects.toMatchObject({ status: 429 });
    await expect(one).rejects.toMatchObject({ status: 401 });
    await expect(two).resolves.toHaveProperty('session.account.id', 'demo-oever');
    await expect(state.login(water)).resolves.toHaveProperty('session.account.id', 'demo-water');
  });

  it('bounds live sessions at twenty, does not evict others and reclaims expired entries', async () => {
    let now = 0;
    const state = new DemoAuthState(() => now);
    const tokens: string[] = [];
    for (let index = 0; index < SESSION_LIMIT; index++) {
      tokens.push((await state.login(index % 2 ? water : oever)).token);
      now += 60_000;
    }
    await expect(state.login(water)).rejects.toMatchObject({ status: 429 });
    expect(state.session(tokens[0])?.account.id).toBe('demo-oever');
    const rotated = await state.login(water, tokens[0]);
    expect(state.session(tokens[0])).toBeNull();
    state.logout(rotated.token);
    await expect(state.login(oever)).resolves.toHaveProperty('session.account.id', 'demo-oever');
    now += SESSION_MS;
    await expect(state.login(water)).resolves.toHaveProperty('session.account.id', 'demo-water');
  }, 15_000);
});

function http(base: string, path: string, options: {
  method?: string; headers?: Record<string, string>; body?: unknown; cookie?: string;
} = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Record<string, unknown>; raw: string }>((resolve, reject) => {
    const req = request(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        host: '127.0.0.1:4200', origin: 'http://127.0.0.1:4200',
        'content-type': 'application/json',
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...options.headers,
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, headers: res.headers, body: JSON.parse(raw), raw }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP test timeout')));
    req.end(options.body ? JSON.stringify(options.body) : undefined);
  });
}

describe('real Nest HTTP cookies, origins, session separation and protected GraphQL', () => {
  let app: INestApplication;
  let other: INestApplication;
  let base: string;
  let otherBase: string;
  let firstCookie: string;
  let secondCookie: string;
  beforeAll(async () => {
    app = await createDemoApplication('demo');
    other = await createDemoApplication('demo');
    await app.listen(0, '127.0.0.1');
    await other.listen(0, '127.0.0.1');
    base = await app.getUrl();
    otherBase = await other.getUrl();
  });
  afterAll(async () => { await Promise.all([app?.close(), other?.close()]); });

  it('denies missing/foreign/null/spoofed origin and forwarded host, including logout CSRF', async () => {
    const invalidHeaders: Record<string, string>[] = [
      { origin: '' }, { origin: 'null' }, { origin: 'https://example.invalid' },
      { origin: 'http://127.0.0.1:4200.evil.invalid' },
      { host: 'evil.invalid', 'x-forwarded-host': '127.0.0.1:4200' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of invalidHeaders) {
      for (const path of ['/auth/login', '/auth/logout']) {
        expect((await http(base, path, { method: 'POST', body: water, headers })).status).toBe(403);
      }
    }
    expect((await http(base, '/auth/login')).status).toBe(404);
  });

  it('rejects anonymous guarded queries while keeping anonymous report reads available', async () => {
    const denied = await http(base, '/graphql', { method: 'POST', body: { query: DEMO_ACCOUNT_QUERY } });
    expect(denied.body).toMatchObject({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] });
    expect(denied.status).toBe(401);
    expect(denied.raw).not.toContain('Demo Water');
    const reports = await http(base, '/graphql', { method: 'POST', body: { query: '{ reports { id } }' } });
    expect(reports.status).toBe(200);
    expect(reports.body).toMatchObject({ data: { reports: expect.any(Array) } });
  });

  it('issues opaque HttpOnly Strict path cookies with 30-minute expiry and no credential payloads', async () => {
    const result = await http(base, '/auth/login', { method: 'POST', body: water, headers: { 'sec-fetch-site': 'same-origin' } });
    expect(result.status).toBe(200);
    const setCookie = result.headers['set-cookie']![0]!;
    expect(setCookie).toMatch(/^drijfvuil_demo=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=1800; Expires=/);
    expect(setCookie).not.toContain('Secure');
    expect(result.headers['cache-control']).toBe('no-store');
    firstCookie = setCookie.split(';')[0]!;
    expect(result.body).toMatchObject({ session: { account: { id: 'demo-water', name: 'Demo Water' }, expiresAt: expect.any(String) } });
    for (const forbidden of ['password', 'hash', 'salt', 'token', water.password, water.login, firstCookie.slice(14)]) {
      expect(result.raw).not.toContain(forbidden);
    }
    const second = await http(base, '/auth/login', { method: 'POST', body: oever });
    secondCookie = second.headers['set-cookie']![0]!.split(';')[0]!;
    expect(secondCookie).not.toBe(firstCookie);
  });

  it('maps cookies to only their own account across application instances sharing process state', async () => {
    for (const [cookie, id, name] of [[firstCookie, 'demo-water', 'Demo Water'], [secondCookie, 'demo-oever', 'Demo Oever']]) {
      const session = await http(otherBase, '/auth/session', { cookie });
      expect(session.body).toMatchObject({ session: { account: { id, name } } });
      const query = await http(base, '/graphql', { method: 'POST', cookie, body: { query: DEMO_ACCOUNT_QUERY } });
      expect(query.status).toBe(200);
      expect(query.body).toEqual({ data: { demoAccount: { id, name } } });
    }
    const invalid = await http(base, '/auth/session', { cookie: `${firstCookie}; ${secondCookie}` });
    expect(invalid.body).toEqual({ session: null });
    expect(invalid.headers['set-cookie']![0]).toContain('Max-Age=0');
    const schema = await http(base, '/graphql', { method: 'POST', cookie: firstCookie, body: { query: '{ demoAccount { password hash token login } }' } });
    expect(schema.body).toHaveProperty('errors');
  });

  it('returns generic 401 for wrong/unknown, rotates after success, and shares the 429 budget', async () => {
    const wrong = await http(base, '/auth/login', { method: 'POST', body: { ...water, password: 'wrong' } });
    const unknown = await http(otherBase, '/auth/login', { method: 'POST', body: { ...water, login: 'unknown' } });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    const rotated = await http(otherBase, '/auth/login', { method: 'POST', body: water, cookie: firstCookie });
    expect(rotated.status).toBe(200);
    expect((await http(base, '/auth/session', { cookie: firstCookie })).body).toEqual({ session: null });
    firstCookie = rotated.headers['set-cookie']![0]!.split(';')[0]!;
    const limited = await http(base, '/auth/login', { method: 'POST', body: water });
    expect(limited.status).toBe(429);
  });

  it('rejects logout CSRF without revoking, then revokes one session and clears the cookie', async () => {
    const blocked = await http(base, '/auth/logout', { method: 'POST', cookie: firstCookie, headers: { origin: 'https://evil.invalid' } });
    expect(blocked.status).toBe(403);
    expect((await http(base, '/auth/session', { cookie: firstCookie })).body.session).not.toBeNull();
    const logout = await http(otherBase, '/auth/logout', { method: 'POST', cookie: firstCookie });
    expect(logout.body).toEqual({ session: null });
    expect(logout.headers['set-cookie']![0]).toContain('Max-Age=0');
    expect((await http(base, '/graphql', { method: 'POST', cookie: firstCookie, body: { query: DEMO_ACCOUNT_QUERY } })).status).toBe(401);
    expect((await http(base, '/auth/session', { cookie: secondCookie })).body).toMatchObject({ session: { account: { id: 'demo-oever' } } });
    await http(base, '/auth/logout', { method: 'POST', cookie: secondCookie });
  });

  it('clears an absolutely expired HTTP cookie and denies the real guarded query without renewal', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    try {
      const loggedIn = await http(base, '/auth/login', { method: 'POST', body: water });
      expect(loggedIn.status).toBe(200);
      const cookie = loggedIn.headers['set-cookie']![0]!.split(';')[0]!;
      const deadline = Date.now() + SESSION_MS;
      clock.mockReturnValue(deadline - 1);
      expect((await http(base, '/auth/session', { cookie })).body.session).not.toBeNull();
      clock.mockReturnValue(deadline);
      const expired = await http(base, '/auth/session', { cookie });
      expect(expired.body).toEqual({ session: null });
      expect(expired.headers['set-cookie']![0]).toContain('Max-Age=0');
      expect((await http(base, '/graphql', { method: 'POST', cookie, body: { query: DEMO_ACCOUNT_QUERY } })).status).toBe(401);
    } finally {
      clock.mockRestore();
    }
  });
});

// No DataSource/driver construction: only the storage capability flag is faked.
@Module({
  imports: [GraphQLModule.forRoot<ApolloDriverConfig>({
    driver: ApolloDriver, typeDefs: REPORT_SCHEMA, playground: false,
    context: ({ req }: { req: unknown }) => ({ req }),
    plugins: [authHttpStatusPlugin],
    preserveHttpStatusForExecutionErrors: false,
  })],
  controllers: [AuthController],
  providers: [
    DemoAuth, DemoAccountGuard, ReportsResolver,
    { provide: REPORT_REPOSITORY, useValue: { storage: { mode: 'postgres', persistent: true, synthetic: false } } },
  ],
})
class FakePostgresAuth {}

describe('PostgreSQL capability isolation without a driver or database', () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    app = await NestFactory.create(FakePostgresAuth, { logger: false });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });

  it('rejects every auth endpoint and protected query rather than falling back to fixtures', async () => {
    for (const operation of ['session', 'login', 'logout']) {
      const response = await http(base, `/auth/${operation}`, {
        method: operation === 'session' ? 'GET' : 'POST', body: operation === 'login' ? water : undefined,
      });
      expect(response.status).toBe(403);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    const result = await http(base, '/graphql', { method: 'POST', body: { query: DEMO_ACCOUNT_QUERY } });
    expect(result.body).toMatchObject({ errors: [{ extensions: { code: 'FORBIDDEN' } }] });
    expect(result.status).toBe(403);
    expect(result.raw).not.toContain('Demo Water');
  });
});
