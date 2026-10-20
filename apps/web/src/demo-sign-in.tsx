import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DemoSession } from '../../../libs/contracts/src';
import { fetchDemoAccount, requestSession, SessionExpired } from './auth-client';

export function DemoSignIn({ onSessionChange, sessionInvalidated = 0 }: {
  onSessionChange?: (session: DemoSession | null) => void;
  sessionInvalidated?: number;
}) {
  const [opened, setOpened] = useState(false);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [login, setLogin] = useState('water@demo.invalid');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef<AbortController | null>(null);

  useEffect(() => { onSessionChange?.(session); }, [session, onSessionChange]);
  useEffect(() => {
    if (!sessionInvalidated) return;
    active.current?.abort();
    active.current = null;
    setPending(false);
    setSession(null);
    setNotice('Je demosessie is verlopen of ingetrokken. Meld je opnieuw aan.');
  }, [sessionInvalidated]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!session) return;
    const expire = () => {
      active.current?.abort();
      active.current = null;
      setPending(false);
      setSession(null);
      setNotice('Je demosessie is verlopen. Meld je opnieuw aan; anoniem melden blijft mogelijk.');
    };
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (remaining <= 0) { expire(); return; }
    const timer = setTimeout(expire, remaining);
    return () => clearTimeout(timer);
  }, [session]);

  async function act(operation: 'session' | 'login' | 'logout' | 'account') {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError('');
    setNotice('');
    try {
      if (operation === 'account') {
        const account = await fetchDemoAccount(controller.signal);
        if (controller.signal.aborted) return;
        if (account.id !== session?.account.id) {
          setSession(null);
          throw new Error('De demosessie is in een ander tabblad gewijzigd. Controleer je sessie.');
        }
        setNotice(`Beschermde accountcontrole geslaagd: ${account.name}.`);
      } else {
        const value = await requestSession(operation, controller.signal,
          operation === 'login' ? { login, password } : undefined);
        if (controller.signal.aborted) return;
        setSession(value);
        setPassword('');
        setNotice(operation === 'logout' ? 'Je bent afgemeld.' :
          value ? 'Demosessie bevestigd. Beide demo-accounts mogen alle demo-meldingen opruimen en heropenen.' : 'Je bent niet aangemeld.');
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof SessionExpired) setSession(null);
      setError(cause instanceof Error ? cause.message : 'Demosessie mislukt.');
      setPassword('');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void act('login');
  }

  return (
    <section className="demo-auth" aria-labelledby="demo-auth-title">
      <div>
        <p className="eyebrow">VRIJBLIJVEND · ALLEEN LOKALE DEMO</p>
        <h2 id="demo-auth-title">Probeer een demosessie</h2>
        <p>Aanmelden is niet nodig om meldingen of foto’s toe te voegen. Geen echte accounts of persoonsgegevens gebruiken.</p>
      </div>
      {!opened ? <button type="button" onClick={() => { setOpened(true); void act('session'); }}>Demosessie openen</button> : <>
        <p>Verzonnen testaccounts (openbare demogegevens):<br />
          <code>water@demo.invalid</code> / <code>Demo-water-1!</code><br />
          <code>oever@demo.invalid</code> / <code>Demo-oever-2!</code>
        </p>
        <p className="auth-caution">Alleen loopback-HTTP, niet productieveilig. Sessies verlopen na 30 minuten, worden niet verlengd en verdwijnen bij API-herstart.</p>
        {session ? <div>
          <p>Aangemeld als <strong>{session.account.name}</strong>. Verloopt om {new Date(session.expiresAt).toLocaleTimeString('nl-BE')}.</p>
          <div className="auth-actions">
            <button disabled={pending} type="button" onClick={() => void act('account')}>Controleer mijn demo-account</button>
            <button disabled={pending} type="button" onClick={() => void act('logout')}>Afmelden</button>
          </div>
        </div> : <form onSubmit={submit} aria-label="Demo aanmelden">
          <label>Demo-account
            <select disabled={pending} value={login} onChange={(event) => setLogin(event.target.value)}>
              <option value="water@demo.invalid">Demo Water</option>
              <option value="oever@demo.invalid">Demo Oever</option>
            </select>
          </label>
          <label>Demowachtwoord
            <input type="password" autoComplete="off" maxLength={128} required disabled={pending}
              value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button disabled={pending} type="submit">Aanmelden</button>
        </form>}
        <button className="auth-refresh" disabled={pending} type="button" onClick={() => void act('session')}>Sessiestatus controleren</button>
        {pending && <p role="status">Demosessie verwerken…</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </>}
    </section>
  );
}
