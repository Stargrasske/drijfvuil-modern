import { DEMO_ACCOUNT_QUERY, type DemoAccount, type DemoSession } from '../../../libs/contracts/src';

export class SessionExpired extends Error {
  constructor() { super('Je demosessie is verlopen. Meld je opnieuw aan.'); }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function account(value: unknown): DemoAccount {
  if (!record(value) || !['demo-water', 'demo-oever'].includes(String(value.id)) ||
    typeof value.name !== 'string' || value.name.length > 80) {
    throw new Error('Ongeldig demo-accountantwoord.');
  }
  return { id: String(value.id), name: value.name };
}

export function parseSession(value: unknown): DemoSession | null {
  if (!record(value) || !Object.hasOwn(value, 'session')) throw new Error('Ongeldig demosessieantwoord.');
  if (value.session === null) return null;
  const session = value.session;
  if (!record(session) || typeof session.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(session.expiresAt))) throw new Error('Ongeldig demosessieantwoord.');
  return { account: account(session.account), expiresAt: session.expiresAt };
}

export async function requestSession(
  operation: 'session' | 'login' | 'logout',
  signal: AbortSignal,
  credentials?: { login: string; password: string },
): Promise<DemoSession | null> {
  let response: Response;
  try {
    response = await fetch(`/auth/${operation}`, {
      method: operation === 'session' ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      ...(operation === 'login' ? {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials),
      } : {}),
      signal,
    });
  } catch {
    throw new Error('Geen sessiebevestiging ontvangen. De actie kan toch verwerkt zijn. Controleer je sessie; er wordt niet automatisch opnieuw verstuurd.');
  }
  if (response.status === 401) throw new Error('Aanmelden mislukt. Controleer de demogegevens.');
  if (response.status === 403) throw new Error('Aanmelden is alleen toegestaan vanuit dezelfde lokale demo-oorsprong in demo-modus.');
  if (response.status === 429) throw new Error('Demolimiet bereikt. Wacht minstens een minuut; volle sessieplaatsen komen na uitloggen of uiterlijk 30 minuten vrij.');
  if (!response.ok) throw new Error(`Demosessie mislukt (HTTP ${response.status}). Controleer de sessie voordat je opnieuw handelt.`);
  const session = parseSession(await response.json());
  if ((operation === 'login' && !session) || (operation === 'logout' && session)) {
    throw new Error('Onverwachte sessiebevestiging. Controleer je sessie.');
  }
  return session;
}

export async function fetchDemoAccount(signal: AbortSignal): Promise<DemoAccount> {
  const response = await fetch('/graphql', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: DEMO_ACCOUNT_QUERY }), signal,
  });
  if (response.status === 401) throw new SessionExpired();
  if (!response.ok) throw new Error(`Demo-account controleren mislukt (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (record(payload) && Array.isArray(payload.errors)) {
    if (payload.errors.some((error: unknown) =>
      record(error) && record(error.extensions) && error.extensions.code === 'UNAUTHENTICATED')) {
      throw new SessionExpired();
    }
    if (payload.errors.length) throw new Error('Demo-account controleren mislukt.');
  }
  if (!record(payload) || !record(payload.data)) throw new Error('Ongeldig demo-accountantwoord.');
  return account(payload.data.demoAccount);
}
