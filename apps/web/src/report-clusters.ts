import { CRS, latLng } from 'leaflet';
import type { Report } from '../../../libs/contracts/src';

export const MAX_REPORT_ZOOM = 18;
export const CLUSTER_RADIUS = 56;

export interface ReportGroup {
  id: number;
  members: Report[];
  center: [number, number];
}

// At most 104 demo reports (4 fixtures + the existing 100-addition cap).
// Stable ID-ordered seeds, a fixed screen-pixel radius, no spatial index.
// This is schematic grouping, not geographic/antimeridian clustering.
export function groupReports(reports: Report[], zoom: number): ReportGroup[] {
  const groups: (ReportGroup & { point: { x: number; y: number } })[] = [];
  for (const report of [...reports].sort((a, b) => a.id - b.id)) {
    const point = CRS.EPSG3857.latLngToPoint(latLng(report.latLngTuple), zoom);
    const group = groups.find((candidate) =>
      Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y) <= CLUSTER_RADIUS);
    if (group) group.members.push(report);
    else groups.push({ id: report.id, members: [report], center: report.latLngTuple, point });
  }
  return groups.map(({ id, members }) => ({
    id, members,
    center: [
      members.reduce((sum, report) => sum + report.latLngTuple[0], 0) / members.length,
      members.reduce((sum, report) => sum + report.latLngTuple[1], 0) / members.length,
    ],
  }));
}

export function cleanupLabel(report: Report) {
  return report.cleaned === null ? 'Opruimstatus niet ondersteund'
    : report.cleaned ? 'Opgeruimd' : 'Nog niet opgeruimd';
}

export function groupLabel(group: ReportGroup, selectedId: number | null) {
  const selected = group.members.find((report) => report.id === selectedId);
  if (group.members.length === 1) {
    const report = group.members[0]!;
    return `Melding #${report.id}: ${report.litterType ?? 'Afval'} · ${cleanupLabel(report)}${selected ? ' · geselecteerd' : ''}`;
  }
  return `${group.members.length} meldingen in deze groep · bekijk meldingen en zoom waar mogelijk${
    selected ? ` · geselecteerde melding #${selected.id}: ${cleanupLabel(selected)}` : ''}`;
}
