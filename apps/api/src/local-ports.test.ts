import { createServer, type Server } from 'node:net';
import { request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer as createViteServer } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SET_REPORT_CLEANED_MUTATION } from '../../../libs/contracts/src/index.js';
import { localDemoConfiguration } from '../../../libs/runtime/src/local-ports.js';
import { createWebConfig } from '../../web/vite.config.js';
import { startApplication } from './bootstrap.js';

async function reserve() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: (server.address() as AddressInfo).port };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function post(base: string, path: string, body: unknown, headers: Record<string, string | undefined>) {
  return new Promise<{ status: number; body: Record<string, unknown>; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const req = request(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json',
        ...Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, headers: res.headers, body: JSON.parse(text) }); }
        catch (cause) { reject(cause); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP test timeout')));
    req.end(JSON.stringify(body));
  });
}
const credentials = { login: 'water@demo.invalid', password: 'Demo-water-1!' };
const mutation = (cleaned: boolean) => ({
  query: SET_REPORT_CLEANED_MUTATION, variables: { id: 1, cleaned },
});

describe('Vite uses the same validated port configuration as the API policy', () => {
  it.each([{}, { DRIJFVUIL_API_PORT: '13333', DRIJFVUIL_WEB_PORT: '14200' }])(
    'keeps loopback binding, strict port and every proxy consistent: %j', (environment) => {
      const config = localDemoConfiguration(environment);
      const web = createWebConfig(environment);
      expect(web.server.host).toBe('127.0.0.1');
      expect(web.server.port).toBe(config.webPort);
      expect(web.server.strictPort).toBe(true);
      for (const route of ['/graphql', '/auth', '/files'] as const) {
        expect(web.server.proxy[route]).toEqual({ target: config.apiTarget, changeOrigin: false });
      }
    });

  it('refuses malformed settings before generating a Vite server configuration', () => {
    expect(() => createWebConfig({ DRIJFVUIL_WEB_PORT: '14200bad' })).toThrow('DRIJFVUIL_WEB_PORT');
    expect(() => createWebConfig({ DRIJFVUIL_API_PORT: '14200', DRIJFVUIL_WEB_PORT: '14200' })).toThrow('verschillend');
  });
});

describe('explicit startup refuses bad settings and occupied owned ports without fallback', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('validates before constructing any Nest application or persistence provider', async () => {
    vi.stubEnv('DRIJFVUIL_API_PORT', '');
    vi.stubEnv('DRIJFVUIL_MODE', 'postgres');
    const create = vi.spyOn(NestFactory, 'create');
    await expect(startApplication()).rejects.toThrow('DRIJFVUIL_API_PORT');
    expect(create).not.toHaveBeenCalled();
  });

  it('API refuses its occupied configured port, leaving the owned reservation intact', async () => {
    const api = await reserve();
    const web = await reserve();
    try {
      vi.stubEnv('DRIJFVUIL_MODE', 'demo');
      vi.stubEnv('DRIJFVUIL_API_PORT', String(api.port));
      vi.stubEnv('DRIJFVUIL_WEB_PORT', String(web.port));
      await expect(startApplication()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(api.server.listening).toBe(true);
      expect(web.server.listening).toBe(true);
    } finally { await Promise.all([close(api.server), close(web.server)]); }
  });

  it('real Vite refuses its occupied configured port instead of incrementing', async () => {
    const api = await reserve();
    const web = await reserve();
    const config = createWebConfig({ DRIJFVUIL_API_PORT: String(api.port), DRIJFVUIL_WEB_PORT: String(web.port) });
    const vite = await createViteServer({ ...config, configFile: false, logLevel: 'silent' });
    try {
      await expect(vite.listen()).rejects.toThrow(`Port ${web.port} is already in use`);
      expect(web.server.listening).toBe(true);
      expect(vite.httpServer?.listening).toBe(false);
    } finally {
      await vite.close();
      await Promise.all([close(api.server), close(web.server)]);
    }
  });
});

describe('custom-port startup and the shared real HTTP M5/M6 origin policy', () => {
  let app: INestApplication;
  let apiPort: number;
  let webPort: number;
  let base: string;
  let cookie: string;
  const headers = () => ({ origin: `http://127.0.0.1:${webPort}`, host: `127.0.0.1:${webPort}` });

  beforeAll(async () => {
    const api = await reserve();
    const web = await reserve();
    apiPort = api.port;
    webPort = web.port;
    await Promise.all([close(api.server), close(web.server)]);
    vi.stubEnv('DRIJFVUIL_MODE', 'demo');
    vi.stubEnv('DRIJFVUIL_API_PORT', String(apiPort));
    vi.stubEnv('DRIJFVUIL_WEB_PORT', String(webPort));
    app = await startApplication();
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('binds only the explicit loopback API port and authenticates against the custom web origin', async () => {
    expect(base).toBe(`http://127.0.0.1:${apiPort}`);
    expect(app.getHttpServer().address()).toMatchObject({ address: '127.0.0.1', port: apiPort });
    const loggedIn = await post(base, '/auth/login', credentials, headers());
    expect(loggedIn.status).toBe(200);
    cookie = loggedIn.headers['set-cookie']![0]!.split(';')[0]!;
    expect(cookie).toMatch(/^drijfvuil_demo=/);
  });

  it('allows configured web/API and localhost exact origins and explicit desired-state writes', async () => {
    for (const [host, port] of [['127.0.0.1', webPort], ['127.0.0.1', apiPort], ['localhost', webPort], ['localhost', apiPort]] as const) {
      const result = await post(base, '/graphql', mutation(true), {
        origin: `http://${host}:${port}`, host: `${host}:${port}`, cookie,
        'sec-fetch-site': 'same-origin',
      });
      expect(result.body).toHaveProperty('data.setReportCleaned.cleaned', true);
    }
    expect((await post(base, '/graphql', mutation(false), { ...headers(), cookie })).body)
      .toHaveProperty('data.setReportCleaned.cleaned', false);
  });

  it('denies defaults, foreign/missing origins, raw host mismatch and forwarded spoofing on login/logout/cleanup alike', async () => {
    const invalid: Record<string, string | undefined>[] = [
      { origin: 'http://127.0.0.1:4200', host: '127.0.0.1:4200' },
      { origin: 'http://127.0.0.1:3333', host: '127.0.0.1:3333' },
      { origin: 'http://localhost:4200', host: 'localhost:4200' },
      { origin: undefined }, { origin: 'null' }, { origin: 'https://foreign.invalid' },
      { origin: `https://127.0.0.1:${webPort}` }, { origin: `http://127.0.0.1:${webPort}/` },
      { origin: `http://127.0.0.1:${webPort}.evil.invalid` },
      { host: 'foreign.invalid', 'x-forwarded-host': `127.0.0.1:${webPort}` },
      { origin: undefined, forwarded: `host=127.0.0.1:${webPort};proto=http` },
      { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    ];
    for (const invalidHeaders of invalid) {
      const requestHeaders = { ...headers(), cookie, ...invalidHeaders };
      for (const path of ['/auth/login', '/auth/logout', '/graphql']) {
        const result = await post(base, path, path === '/graphql' ? mutation(true) : credentials, requestHeaders);
        expect(result.status).toBe(403);
      }
    }
    expect((await post(base, '/graphql', mutation(false), { ...headers(), cookie,
      'x-forwarded-host': 'foreign.invalid', forwarded: 'host=foreign.invalid;proto=https',
    })).body).toHaveProperty('data.setReportCleaned.cleaned', false);
    expect((await post(base, '/auth/logout', {}, { ...headers(), cookie })).status).toBe(200);
    expect((await post(base, '/graphql', mutation(true), { ...headers(), cookie })).status).toBe(401);
  });
});
