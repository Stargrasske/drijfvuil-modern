import { describe, expect, it, vi } from 'vitest';
import { fetchDemoAccount, parseSession, requestSession, SessionExpired } from './auth-client';

const session = { account: { id: 'demo-water', name: 'Demo Water' }, expiresAt: '2026-10-18T21:00:00.000Z' };
const signal = () => new AbortController().signal;

describe('typed demo authentication client', () => {
  it('validates runtime session/account shapes and returns only public fields', () => {
    expect(parseSession({ session: null })).toBeNull();
    expect(parseSession({ session: { ...session, token: 'should not propagate', account: { ...session.account, password: 'private' } } }))
      .toEqual(session);
    for (const invalid of [{}, { session: {} }, { session: { ...session, expiresAt: 'bad' } },
      { session: { ...session, account: { id: 'real-account', name: 'Private' } } }]) {
      expect(() => parseSession(invalid)).toThrow();
    }
  });

  it('sends same-origin cookies, no-store and no bearer token, and performs exactly one write', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ session }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const credentials = { login: 'water@demo.invalid', password: 'Demo-water-1!' };
    expect(await requestSession('login', signal(), credentials)).toEqual(session);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials),
    }));
  });

  it.each([401, 403, 429, 503])('reports HTTP %i honestly without swallowing or retrying it', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(requestSession('login', signal(), { login: 'x', password: 'x' })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry uncertain writes or accept contradictory/malformed confirmations', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(
      new Response(JSON.stringify({ session: null })),
    ).mockResolvedValueOnce(new Response(JSON.stringify({ session })));
    vi.stubGlobal('fetch', fetch);
    await expect(requestSession('login', signal())).rejects.toThrow('kan toch verwerkt');
    await expect(requestSession('login', signal())).rejects.toThrow('Onverwachte');
    await expect(requestSession('logout', signal())).rejects.toThrow('Onverwachte');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('recognizes HTTP and GraphQL expiry, verifies the protected payload, and omits credentials', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { demoAccount: session.account } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { demoAccount: { id: 5 } } })));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchDemoAccount(signal())).rejects.toBeInstanceOf(SessionExpired);
    await expect(fetchDemoAccount(signal())).rejects.toBeInstanceOf(SessionExpired);
    expect(await fetchDemoAccount(signal())).toEqual(session.account);
    await expect(fetchDemoAccount(signal())).rejects.toThrow('Ongeldig');
    expect(fetch).toHaveBeenLastCalledWith('/graphql', expect.objectContaining({
      body: JSON.stringify({ query: 'query DemoAccount { demoAccount { id name } }' }),
      credentials: 'same-origin',
    }));
  });
});
