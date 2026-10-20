import { describe, expect, it } from 'vitest';
import { CRS, latLng, point } from 'leaflet';
import { firstReport } from './test-fixtures';
import { CLUSTER_RADIUS, groupLabel, groupReports, MAX_REPORT_ZOOM } from './report-clusters';
import type { Report } from '../../../libs/contracts/src';

const nearby: Report = { ...firstReport, id: 2, latLngTuple: [51.0543, 3.7226], cleaned: true };
const ids = (reports: Report[], zoom: number) => groupReports(reports, zoom).map((group) => group.members.map((report) => report.id));

describe('M7 bounded schematic Leaflet grouping', () => {
  it('handles empty and single inputs without inventing counts', () => {
    expect(groupReports([], 13)).toEqual([]);
    expect(ids([firstReport], 13)).toEqual([[1]]);
    expect(groupReports([firstReport], 13)[0]!.center).toEqual(firstReport.latLngTuple);
  });

  it('groups nearby points at low zoom and splits them at higher zoom', () => {
    expect(ids([firstReport, nearby], 13)).toEqual([[1, 2]]);
    expect(ids([firstReport, nearby], MAX_REPORT_ZOOM)).toEqual([[1], [2]]);
  });

  it('uses a fixed pixel radius with stable seed assignment, not transitive chains', () => {
    const origin = CRS.EPSG3857.latLngToPoint(latLng(firstReport.latLngTuple), 13);
    const at = (id: number, distance: number): Report => {
      const location = CRS.EPSG3857.pointToLatLng(point(origin.x + distance, origin.y), 13);
      return { ...firstReport, id, latLngTuple: [location.lat, location.lng] };
    };
    expect(ids([at(3, CLUSTER_RADIUS * 1.5), at(2, CLUSTER_RADIUS * .75), firstReport], 13))
      .toEqual([[1, 2], [3]]);
  });

  it('is deterministic regardless of response order and does not mutate reports', () => {
    const inputs = [nearby, firstReport];
    expect(ids(inputs, 13)).toEqual(ids([...inputs].reverse(), 13));
    expect(inputs.map((report) => report.id)).toEqual([2, 1]);
  });

  it('retains all colocated members at maximum zoom for the member chooser', () => {
    const reports = Array.from({ length: 104 }, (_, index) => ({ ...firstReport, id: index + 1 }));
    expect(ids(reports, MAX_REPORT_ZOOM)).toEqual([reports.map((report) => report.id)]);
  });

  it.each([0, 8, 13, 15, 18])('has exact unique membership at zoom %s over the full demo capacity', (zoom) => {
    const reports = Array.from({ length: 104 }, (_, index): Report => ({
      ...firstReport, id: index + 1, latLngTuple: [51 + (index % 11) * .001, 3.7 + index * .0007],
    }));
    const groups = groupReports(reports, zoom);
    const members = groups.flatMap((group) => group.members.map((report) => report.id));
    expect(members).toHaveLength(reports.length);
    expect(new Set(members).size).toBe(reports.length);
    expect([...members].sort((a, b) => a - b)).toEqual(reports.map((report) => report.id));
    expect(groups.reduce((total, group) => total + group.members.length, 0)).toBe(104);
  });

  it('reflects filtering, adding and removing without retaining stale members', () => {
    expect(ids([firstReport, nearby], 13)).toEqual([[1, 2]]);
    expect(ids([nearby], 13)).toEqual([[2]]);
    expect(ids([nearby, { ...firstReport, id: 3 }], 13)).toEqual([[2, 3]]);
    expect(ids([], 13)).toEqual([]);
  });

  it('does not filter cleaned reports or confuse cluster counts with cleanup counts', () => {
    const group = groupReports([firstReport, nearby], 13)[0]!;
    expect(group.members).toHaveLength(2);
    expect(groupLabel(group, 2)).toContain('2 meldingen');
    expect(groupLabel(group, 2)).toContain('geselecteerde melding #2: Opgeruimd');
    expect(groupLabel(group, 999)).not.toContain('geselecteerde');
    expect(groupLabel(groupReports([{ ...firstReport, cleaned: null }], 13)[0]!, 1))
      .toContain('Opruimstatus niet ondersteund');
  });
});
