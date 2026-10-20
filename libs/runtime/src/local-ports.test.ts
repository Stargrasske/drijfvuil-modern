import { describe, expect, it } from 'vitest';
import { localDemoConfiguration, LocalPortConfigurationError } from './local-ports.js';

describe('explicit local demo port configuration', () => {
  it('preserves the loopback demo defaults with exactly four origins', () => {
    const config = localDemoConfiguration({});
    expect(config.apiPort).toBe(3333);
    expect(config.webPort).toBe(4200);
    expect(config.apiTarget).toBe('http://127.0.0.1:3333');
    expect([...config.allowedOrigins].sort()).toEqual([
      'http://127.0.0.1:3333', 'http://127.0.0.1:4200',
      'http://localhost:3333', 'http://localhost:4200',
    ]);
  });

  it('derives origins only from the configured pair, without keeping unused defaults', () => {
    const config = localDemoConfiguration({ DRIJFVUIL_API_PORT: '13333', DRIJFVUIL_WEB_PORT: '14200' });
    expect(config.apiTarget).toBe('http://127.0.0.1:13333');
    expect(config.allowedOrigins).toEqual(new Set([
      'http://127.0.0.1:13333', 'http://localhost:13333',
      'http://127.0.0.1:14200', 'http://localhost:14200',
    ]));
    expect(localDemoConfiguration({ DRIJFVUIL_API_PORT: '13333' }).allowedOrigins.has('http://localhost:4200')).toBe(true);
    expect(localDemoConfiguration({ DRIJFVUIL_WEB_PORT: '14200' }).allowedOrigins.has('http://localhost:3333')).toBe(true);
  });

  it('accepts range endpoints and canonical HTTP origins for port 80', () => {
    expect(localDemoConfiguration({ DRIJFVUIL_API_PORT: '1', DRIJFVUIL_WEB_PORT: '65535' }))
      .toMatchObject({ apiPort: 1, webPort: 65535 });
    const config = localDemoConfiguration({ DRIJFVUIL_API_PORT: '80' });
    expect(config.apiTarget).toBe('http://127.0.0.1');
    expect(config.allowedOrigins.has('http://localhost')).toBe(true);
    expect(config.allowedOrigins.has('http://localhost:80')).toBe(false);
  });

  for (const name of ['DRIJFVUIL_API_PORT', 'DRIJFVUIL_WEB_PORT']) {
    it.each(['', ' ', '0', '-1', '+1', '01', '003333', '1.0', '1.5', '1e3',
      '0x1234', '65536', '99999999999999', 'NaN', 'Infinity', '13333 ', ' 13333',
      '13333\n', '13_333', '13333junk', 'localhost:13333', 'http://localhost:13333'])(
      `rejects invalid ${name} value %j instead of falling back`, (value) => {
        expect(() => localDemoConfiguration({ [name]: value })).toThrow(LocalPortConfigurationError);
        expect(() => localDemoConfiguration({ [name]: value })).toThrow(name);
      });
  }

  it.each([
    { DRIJFVUIL_API_PORT: '14200', DRIJFVUIL_WEB_PORT: '14200' },
    { DRIJFVUIL_API_PORT: '4200' }, { DRIJFVUIL_WEB_PORT: '3333' },
  ])('refuses a colliding pair, including collision with a default: %j', (environment) => {
    expect(() => localDemoConfiguration(environment)).toThrow('verschillend');
  });
});
