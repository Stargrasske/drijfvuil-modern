import { useEffect, useRef, useState } from 'react';
import type { DemoSession, Report } from '../../../libs/contracts/src';
import { SessionExpired } from './auth-client';
import { CleanupUncertain, fetchReportStatus, setReportCleaned } from './client';

export function CleanupAction({ report, session, available = true, onConfirmed, onExpired, onBusy }: {
  report: Report;
  session: DemoSession | null;
  available?: boolean;
  onConfirmed: (report: Report) => void;
  onExpired: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const unknownOutcome = useRef(false);
  useEffect(() => () => { active.current?.abort(); onBusy(false); }, [onBusy]);
  const authenticated = session !== null && Date.parse(session.expiresAt) > Date.now();

  async function act(readOnly: boolean) {
    if (!available || active.current || (!readOnly && (!authenticated || uncertain))) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    onBusy(true);
    setError('');
    setMessage('');
    try {
      const result = readOnly
        ? await fetchReportStatus(report.id, controller.signal)
        : await setReportCleaned(report.id, !report.cleaned, controller.signal);
      if (controller.signal.aborted) return;
      onConfirmed(result);
      unknownOutcome.current = false;
      setUncertain(false);
      setMessage(readOnly ? 'Actuele opruimstatus opgehaald; er is niets opnieuw verstuurd.' : 'Opruimstatus bevestigd door de demo-API.');
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof CleanupUncertain) {
        unknownOutcome.current = true;
        setUncertain(true);
      }
      if (cause instanceof SessionExpired) onExpired();
      setError(cause instanceof Error ? cause.message : 'Opruimstatus verwerken mislukt.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
        onBusy(unknownOutcome.current);
      }
    }
  }

  return <section className="cleanup-action" aria-label="Demo-opruimstatus" aria-busy={pending}>
    <p className="cleanup-status"><strong>Status: {report.cleaned ? 'Opgeruimd' : 'Nog niet opgeruimd'}</strong></p>
    <p>Tijdelijke gedeelde demo: beide verzonnen accounts kunnen elke demo-melding opruimen of heropenen. Geen geschiedenis; bij API-herstart verdwijnt de status. Maximaal 20 opruimpogingen per minuut voor iedereen samen, los van de meldlimiet.</p>
    {authenticated
      ? <button type="button" disabled={pending || uncertain} aria-disabled={!available || pending || uncertain}
        onKeyDown={(event) => {
          if (!available && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
        }} onClick={() => void act(false)}>
        {report.cleaned ? 'Melding heropenen' : 'Markeer als opgeruimd'}
      </button>
      : <p>Open je demosessie en meld je aan om de opruimstatus te wijzigen. Anoniem bekijken en melden blijft mogelijk.</p>}
    <button type="button" disabled={pending} aria-disabled={!available || pending}
      onKeyDown={(event) => {
        if (!available && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
      }} onClick={() => void act(true)}>Actuele opruimstatus ophalen</button>
    {pending && <p role="status">Opruimstatus verwerken…</p>}
    {error && <p role="alert">{error}</p>}
    {uncertain && <p role="status">Uitkomst onzeker. Eerst de actuele status ophalen voordat je opnieuw wijzigt.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
