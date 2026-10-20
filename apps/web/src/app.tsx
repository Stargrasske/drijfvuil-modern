import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { useExplorer } from './use-explorer';
import { CreateReportForm } from './create-report-form';
import { DemoSignIn } from './demo-sign-in';
import { CleanupAction } from './cleanup-action';
import type { DemoSession } from '../../../libs/contracts/src';
import './styles.css';

const ReportMap = lazy(() => import('./report-map').then((module) => ({ default: module.ReportMap })));

export function App() {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [sessionInvalidated, setSessionInvalidated] = useState(0);
  const [cleanupPending, setCleanupPending] = useState(false);
  const cleanupBusy = useRef(false);
  const setCleanupBusy = useCallback((busy: boolean) => {
    cleanupBusy.current = busy;
    setCleanupPending(busy);
  }, []);
  const [cityId, setCityId] = useState<number | null>(9000);
  const [quarterId, setQuarterId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const state = useExplorer(cityId, quarterId);
  const demo = state.data?.storage.mode === 'demo';
  const postgres = state.data?.storage.mode === 'postgres';
  const reports = state.data?.reports ?? [];
  const selected = reports.find((report) => report.id === selectedId) ?? reports[0];
  const quarters = state.data?.quarters.filter((quarter) => quarter.cityId === cityId) ?? [];

  function locate() {
    if (!navigator.geolocation) {
      setLocationStatus('Deze browser ondersteunt geen locatiebepaling. Je kunt de lijst blijven gebruiken.');
      return;
    }
    setLocating(true);
    setLocationStatus('Locatie opvragen…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPosition([coords.latitude, coords.longitude]);
        setLocationStatus('Je locatie staat op de kaart. Meldingen worden niet automatisch gefilterd.');
        setLocating(false);
      },
      () => {
        setLocationStatus('Je locatie is niet beschikbaar. De meldingen en kaart blijven bruikbaar.');
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 60_000, enableHighAccuracy: false },
    );
  }

  return (
    <>
      <a className="skip-link" href="#meldingen">Naar de meldingen</a>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Drijfvuil startpagina">
          <span className="brand-mark" aria-hidden="true">≈</span>Drijfvuil<span className="brand-dot">.</span>
        </a>
        <span className="header-caption">Samen voor schoon water</span>
        <span className="demo-badge">{demo ? 'Demo · tijdelijk geheugen' : postgres ? 'PostgreSQL · opgeslagen meldingen' : 'Opslagstatus niet bevestigd'}</span>
      </header>
      <main>
        <section className="intro" aria-labelledby="title">
          <p className="eyebrow">KIJK MEE. GEEF OM JE OMGEVING.</p>
          <h1 id="title">Schoon water begint<br />met <span>aandacht.</span></h1>
          <p>Ontdek waar afval is gesignaleerd. Bekijk de meldingen in jouw buurt, op de kaart of in de lijst.</p>
        </section>
        <aside className="demo-notice">
          <strong>Een nieuwe start voor Drijfvuil.</strong> {demo
            ? 'Dit is een demonstratie met verzonnen meldingen. Er worden geen echte meldingen opgehaald of duurzaam opgeslagen.'
            : postgres
              ? 'Deze API gebruikt PostgreSQL-opslag, geen synthetische demo. Productiegebruik is niet goedgekeurd: live migratie- en integratievalidatie en QA-goedkeuring ontbreken.'
              : 'De opslagmodus wordt pas getoond na bevestiging door de API.'}
        </aside>
        {demo && <DemoSignIn onSessionChange={setSession} sessionInvalidated={sessionInvalidated} />}
        {state.data && <CreateReportForm
          storage={state.data.storage}
          cities={state.data.cities}
          quarters={state.data.quarters}
          onCreated={(report) => {
            if (!cleanupBusy.current) {
              setCityId(report.cityId);
              setQuarterId(report.quarterId);
              setSelectedId(report.id);
            }
            state.retry();
          }}
        />}
        <section className="explorer" aria-label="Meldingen verkennen">
          <div className="toolbar">
            <div className="filters">
              <label>Stad
                <select
                  value={cityId ?? ''}
                  disabled={cleanupPending}
                  onChange={(event) => {
                    setCityId(event.target.value === '' ? null : Number(event.target.value));
                    setQuarterId(null);
                    setSelectedId(null);
                  }}
                >
                  <option value="">Alle steden</option>
                  {(state.data?.cities ?? [{ id: 9000, name: 'Gent' }]).map((city) => (
                    <option key={city.id} value={city.id}>{city.name}</option>
                  ))}
                </select>
              </label>
              <label>Wijk
                <select
                  value={quarterId ?? ''}
                  disabled={cityId === null || cleanupPending}
                  onChange={(event) => {
                    setQuarterId(event.target.value === '' ? null : Number(event.target.value));
                    setSelectedId(null);
                  }}
                >
                  <option value="">Alle wijken</option>
                  {quarters.map((quarter) => (
                    <option key={quarter.id} value={quarter.id}>{quarter.quarter}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="location-button" onClick={locate} disabled={locating}>
              <span aria-hidden="true">⌖</span> {locating ? 'Even geduld…' : 'Toon mijn locatie'}
            </button>
          </div>
          <p role="status" className="location-status">{locationStatus}</p>
          <div className="explorer-grid">
            <section id="meldingen" className="report-panel" aria-busy={state.status === 'loading'}>
              <div className="panel-heading">
                <h2>Meldingen</h2>
                {state.status === 'success' && <span className="count">{reports.length}</span>}
              </div>
              {state.status === 'loading' && <p role="status">Meldingen laden…</p>}
              {state.status === 'error' && (
                <div role="alert" className="error-panel">
                  <h3>Dat ging niet helemaal goed.</h3>
                  <p>{state.error}</p>
                  <button onClick={state.retry}>Opnieuw proberen</button>
                </div>
              )}
              {state.data && (
                <>
                  {reports.length === 0 ? (
                    <p className="empty">{demo ? 'Geen demo-meldingen' : 'Geen meldingen'} voor deze selectie. Kies een andere stad of wijk.</p>
                  ) : (
                    <ul className="report-list" aria-label="Gevonden meldingen">
                      {reports.map((report) => (
                        <li key={report.id}>
                          <button
                            className={`report-card ${selected?.id === report.id ? 'selected' : ''}`}
                            aria-pressed={selected?.id === report.id}
                            aria-disabled={cleanupPending || state.status !== 'success'}
                            onClick={() => {
                              if (!cleanupBusy.current && state.status === 'success') setSelectedId(report.id);
                            }}
                            onKeyDown={(event) => {
                              if ((cleanupBusy.current || state.status !== 'success') &&
                                (event.key === 'Enter' || event.key === ' ')) {
                                event.preventDefault();
                                event.stopPropagation();
                              }
                            }}
                          >
                            <span className="report-category">{report.locationType === 'water' ? 'IN HET WATER' : 'OP HET LAND'}</span>
                            <strong>{report.litterType ?? 'Afval'} <span aria-hidden="true">↗</span></strong>
                            <span>{report.quarter?.quarter ?? report.city.name} · #{report.id}</span>
                            <span className="cleanup-label">{report.cleaned === null ? 'Opruimstatus niet ondersteund' : report.cleaned ? 'Opgeruimd' : 'Nog niet opgeruimd'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="list-note">{demo ? 'Synthetische gegevens' : 'PostgreSQL-gegevens'} · automatisch vernieuwd elke minuut</p>
                </>
              )}
            </section>
            <section className="map-panel" aria-label="Locatie en details">
              {state.data ? (
                <Suspense fallback={<div className="map-placeholder" role="status">Kaart laden…</div>}>
                  <ReportMap
                    reports={reports}
                    selectedId={selected?.id ?? null}
                    onSelect={(id) => { if (!cleanupBusy.current && state.status === 'success') setSelectedId(id); }}
                    position={position}
                    selectionLocked={cleanupPending}
                    ready={state.status === 'success'}
                    viewportKey={`${cityId ?? 'all'}:${quarterId ?? 'all'}`}
                  />
                </Suspense>
              ) : <div className="map-placeholder">De kaart verschijnt zodra de meldingen zijn geladen.</div>}
              {selected && (
                <article className="detail" aria-label="Geselecteerde melding">
                  <div><p className="eyebrow">MELDING #{selected.id}</p>
                    <h2>{selected.litterType ?? 'Afval'} in {selected.city.name}</h2>
                    <p>{selected.extra ?? 'Geen extra informatie.'}</p>
                  </div>
                  <dl>
                    <div><dt>Wijk</dt><dd>{selected.quarter?.quarter ?? 'Niet opgegeven'}</dd></div>
                    <div><dt>Coördinaten</dt><dd>{selected.latLngTuple.map((value) => value.toFixed(4)).join(', ')}</dd></div>
                    <div><dt>Foto</dt><dd>{selected.dbImage
                      ? <img className="report-photo" src={selected.dbImage.url} alt={`Bijgevoegde foto bij melding #${selected.id}: ${selected.litterType ?? 'afval'}`} />
                      : demo ? 'Geen foto bij deze melding' : 'Foto’s nog niet ondersteund'}</dd></div>
                  </dl>
                  {demo && <CleanupAction key={selected.id} report={selected} session={session} available={state.status === 'success'}
                    onConfirmed={state.confirmReport} onExpired={() => {
                      setSession(null);
                      setSessionInvalidated((value) => value + 1);
                    }} onBusy={setCleanupBusy} />}
                </article>
              )}
            </section>
          </div>
        </section>
      </main>
      <footer><strong>Drijfvuil.</strong><span>Kleine signalen. Een schonere omgeving.</span><span>{demo ? 'Prototype · synthetische data' : postgres ? 'Prototype · PostgreSQL-opslag' : 'Prototype · opslagstatus niet bevestigd'}</span></footer>
    </>
  );
}
