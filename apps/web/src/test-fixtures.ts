import type { ExplorerData, Report } from '../../../libs/contracts/src';

export const firstReport: Report = {
  id: 1,
  cleaned: false,
  cityId: 9000,
  city: { id: 9000, name: 'Gent' },
  quarterId: 1,
  quarter: { id: 1, cityId: 9000, quarter: 'Binnenstad' },
  createdAt: '2026-10-16T09:00:00.000Z',
  updatedAt: '2026-10-16T09:00:00.000Z',
  latLngTuple: [51.0543, 3.7206],
  locationType: 'water',
  litterType: 'Plastic',
  extra: 'Verzonnen flessen aan het water.',
  dbImageId: null,
  dbImage: null,
};

export const testData: ExplorerData = {
  storage: { mode: 'demo', persistent: false, synthetic: true },
  reports: [
    firstReport,
    {
      ...firstReport,
      id: 2,
      quarterId: 2,
      quarter: { id: 2, cityId: 9000, quarter: 'Muide' },
      litterType: 'Verpakking',
      extra: 'Verzonnen verpakking naast het pad.',
    },
  ],
  cities: [{ id: 9000, name: 'Gent' }, { id: 9050, name: 'Gentbrugge' }],
  quarters: [
    { id: 1, cityId: 9000, quarter: 'Binnenstad' },
    { id: 2, cityId: 9000, quarter: 'Muide' },
    { id: 3, cityId: 9050, quarter: 'Gentbrugge centrum' },
  ],
};

export function mockResponse(data: unknown = testData) {
  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
