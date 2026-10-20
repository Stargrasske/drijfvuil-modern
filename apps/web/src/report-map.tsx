import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import type { Report } from '../../../libs/contracts/src';
import { cleanupLabel, groupLabel, groupReports, MAX_REPORT_ZOOM, type ReportGroup } from './report-clusters';
import 'leaflet/dist/leaflet.css';

function Viewport({ reports, position, viewportKey, ready }: {
  reports: Report[]; position: [number, number] | null; viewportKey: string; ready: boolean;
}) {
  const map = useMap();
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || fitted.current === viewportKey) return;
    fitted.current = viewportKey;
    if (reports.length > 0) {
      map.fitBounds(latLngBounds(reports.map((report) => report.latLngTuple)), {
        padding: [45, 45], maxZoom: 15, animate: false,
      });
    }
    map.invalidateSize();
  }, [map, reports, viewportKey, ready]);
  useEffect(() => {
    if (position) map.setView(position, 14, { animate: false });
  }, [map, position]);
  return null;
}

function GroupMarker({ group, selectedId, locked, onActivate }: {
  group: ReportGroup; selectedId: number | null; locked: boolean; onActivate: () => void;
}) {
  const map = useMap();
  const label = groupLabel(group, selectedId);
  const selected = group.members.some((report) => report.id === selectedId);
  const clustered = group.members.length > 1;
  const button = useMemo(() => document.createElement('button'), []);
  useLayoutEffect(() => {
    // Native buttons supply Enter AND Space; no report text enters HTML strings.
    button.type = 'button';
    button.className = `map-report-button${clustered ? ' is-cluster' : ''}${selected ? ' is-selected' : ''}`;
    button.textContent = clustered ? String(group.members.length) : '●';
    button.setAttribute('aria-label', label);
    if (!clustered) button.setAttribute('aria-pressed', String(selected));
    else button.removeAttribute('aria-pressed');
    // Native disabled blurs a focused button in Chrome. Keep focus while busy,
    // but block every activation path below (aria-disabled alone does not).
    button.setAttribute('aria-disabled', String(locked));
  }, [button, clustered, group.members.length, label, locked, selected]);
  const icon = useMemo(() => divIcon({
    html: button, className: 'report-point', iconSize: [44, 44], iconAnchor: [22, 22],
  }), [button]);
  useLayoutEffect(() => {
    const stop = (event: Event) => event.stopPropagation();
    const blockKeys = (event: KeyboardEvent) => {
      if (locked && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const showFocus = () => map.panInside(group.center, { padding: [28, 28], animate: false });
    const activate = (event: Event) => {
      event.stopPropagation();
      if (!locked) onActivate();
    };
    button.addEventListener('click', activate);
    button.addEventListener('focus', showFocus);
    button.addEventListener('mousedown', stop);
    button.addEventListener('dblclick', stop);
    button.addEventListener('keydown', blockKeys);
    return () => {
      button.removeEventListener('click', activate);
      button.removeEventListener('focus', showFocus);
      button.removeEventListener('mousedown', stop);
      button.removeEventListener('dblclick', stop);
      button.removeEventListener('keydown', blockKeys);
    };
  }, [button, group.center, locked, map, onActivate]);
  return (
    <Marker position={group.center} icon={icon} keyboard={false}>
      <Tooltip>{label}</Tooltip>
    </Marker>
  );
}

function ReportGroups({ reports, selectedId, locked, onSelect, onReveal }: {
  reports: Report[]; selectedId: number | null; locked: boolean;
  onSelect: (id: number) => void; onReveal: (ids: number[]) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  // Viewport's first fit may precede this child's event subscription.
  useEffect(() => { setZoom(map.getZoom()); }, [map]);
  const groups = useMemo(() => groupReports(reports, zoom), [reports, zoom]);
  return groups.map((group) => (
    <GroupMarker key={group.id} group={group} selectedId={selectedId} locked={locked}
      onActivate={() => {
        if (group.members.length === 1) {
          onSelect(group.members[0]!.id);
          return;
        }
        onReveal(group.members.map((report) => report.id));
        const [first] = group.members;
        const colocated = group.members.every((report) =>
          report.latLngTuple[0] === first!.latLngTuple[0] && report.latLngTuple[1] === first!.latLngTuple[1]);
        if (!colocated && map.getZoom() < MAX_REPORT_ZOOM) {
          map.setView(group.center, Math.min(MAX_REPORT_ZOOM, map.getZoom() + 2), { animate: false });
        }
      }} />
  ));
}

export function ReportMap({
  reports, selectedId, onSelect, position, selectionLocked = false, ready = true, viewportKey = '',
}: {
  reports: Report[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  position: [number, number] | null;
  selectionLocked?: boolean;
  ready?: boolean;
  viewportKey?: string;
}) {
  const [revealed, setRevealed] = useState<{ ids: number[]; geometry: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const geometry = JSON.stringify([viewportKey, reports.map((report) => [report.id, report.latLngTuple])]);
  const members = revealed?.geometry === geometry
    ? revealed.ids.flatMap((id) => reports.filter((report) => report.id === id)) : [];
  useEffect(() => {
    if (revealed) heading.current?.focus();
  }, [revealed]);
  const locked = selectionLocked || !ready;
  return (
    <div className="map-shell" aria-label="Schematische kaart met synthetische meldingen" aria-busy={!ready}>
      <div className="map-canvas">
        <MapContainer
          center={[51.0543, 3.7206]} zoom={13} maxZoom={MAX_REPORT_ZOOM}
          scrollWheelZoom={false} zoomAnimation={false} fadeAnimation={false} markerZoomAnimation={false}
          attributionControl={false} className="report-map"
        >
          <Viewport reports={reports} position={position} viewportKey={viewportKey} ready={ready} />
          <ReportGroups reports={reports} selectedId={selectedId} locked={locked} onSelect={onSelect}
            onReveal={(ids) => setRevealed({ ids, geometry })} />
          {position && (
            <CircleMarker center={position} radius={7} pathOptions={{ color: '#274cc1', fillOpacity: 1 }}>
              <Tooltip>Je huidige locatie</Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
        <p className="map-note">Schematische locatiekaart · geen straten of externe kaarttegels</p>
      </div>
      {!ready && <p className="map-refresh" role="status">Kaart wordt bijgewerkt · selectie tijdelijk geblokkeerd</p>}
      <p className="map-help">Getallen tellen meldingen, niet opruimacties. Activeer een groep om de meldingen te bekijken en waar mogelijk in te zoomen. De volledige lijst blijft beschikbaar.</p>
      {members.length > 0 && (
        <section className="map-members" aria-label="Meldingen uit gekozen groep">
          <h3 ref={heading} tabIndex={-1}>Meldingen uit gekozen groep ({members.length})</h3>
          <ul>{members.map((report) => (
            <li key={report.id}><button type="button" aria-disabled={locked}
              onKeyDown={(event) => {
                if (locked && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              aria-pressed={report.id === selectedId} onClick={() => { if (!locked) onSelect(report.id); }}>
              #{report.id} · {report.litterType ?? 'Afval'} · {cleanupLabel(report)}
            </button></li>
          ))}</ul>
          <button type="button" onClick={() => setRevealed(null)}>Groepslijst sluiten</button>
        </section>
      )}
    </div>
  );
}
