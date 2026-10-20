import { describe, expect, it, vi } from 'vitest';
import { createReport, fetchExplorer, parseCreatedReport, parseExplorerData } from './client';
import { firstReport, mockResponse, testData } from './test-fixtures';

describe('GraphQL client', () => {
  it('sends explicit null filters to the local API with cancellation', async () => {
    const fetch = vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse());
    const controller = new AbortController();
    await expect(fetchExplorer({ cityId: null, quarterId: null }, controller.signal))
      .resolves.toEqual(testData);
    expect(fetch).toHaveBeenCalledWith('/graphql', expect.objectContaining({
      signal: controller.signal, method: 'POST',
    }));
    const request = fetch.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body)).variables).toEqual({ cityId: null, quarterId: null });
  });

  it('rejects non-success HTTP status explicitly', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    await expect(fetchExplorer({}, new AbortController().signal)).rejects.toThrow('HTTP 503');
  });

  it('rejects partial GraphQL errors instead of displaying success-shaped data', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      data: testData, errors: [{ message: 'Server failure' }],
    })));
    await expect(fetchExplorer({}, new AbortController().signal)).rejects.toThrow('kon de meldingen');
  });

  it('rejects missing/invalid response shapes', () => {
    for (const value of [null, {}, { ...testData, reports: [null] }, { ...testData, cities: [{}] }]) {
      expect(() => parseExplorerData(value)).toThrow('ongeldige');
    }
  });

  it('rejects malformed and out-of-range coordinates', () => {
    for (const latLngTuple of [[1], [91, 3], [50, 181], [Number.NaN, 3], [1, 2, 3]]) {
      expect(() => parseExplorerData({
        ...testData, reports: [{ ...firstReport, latLngTuple }],
      })).toThrow('ongeldige');
    }
  });

  it('accepts empty results and explicitly nullable legacy fields', () => {
    expect(parseExplorerData({ ...testData, reports: [] }).reports).toEqual([]);
    expect(parseExplorerData({
      ...testData,
      reports: [{ ...firstReport, quarter: null, quarterId: null, extra: null, litterType: null }],
    }).reports).toHaveLength(1);
  });

  it('accepts only truthful, fully specified storage metadata, never guesses demo on missing/unknown flags', () => {
    for (const storage of [
      undefined, null, {}, { mode: 'production', persistent: true, synthetic: false },
      { mode: 'demo', persistent: true, synthetic: true },
      { mode: 'postgres', persistent: false, synthetic: false },
      { mode: 'postgres', persistent: true, synthetic: true },
      { mode: 'postgres', persistent: 'true', synthetic: false },
    ]) expect(() => parseExplorerData({ ...testData, storage })).toThrow('ongeldige');
    const storage = { mode: 'postgres', persistent: true, synthetic: false };
    expect(parseExplorerData({ ...testData, storage, reports: [{ ...firstReport, cleaned: null }] }).storage).toEqual(storage);
    expect(parseExplorerData(testData).storage).toEqual(testData.storage);
  });

  it('surfaces network and invalid JSON errors rather than synthetic fallback data', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Offline'));
    await expect(fetchExplorer({}, new AbortController().signal)).rejects.toThrow('Offline');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not JSON'));
    await expect(fetchExplorer({}, new AbortController().signal)).rejects.toThrow();
  });

  it('sends one typed mutation with no automatic retries and validates the returned report', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ createReport: firstReport }));
    const controller = new AbortController();
    await expect(createReport({ latLngTuple: [51, 3] }, controller.signal)).resolves.toEqual(firstReport);
    expect(fetch).toHaveBeenCalledTimes(1);
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(options?.signal).toBe(controller.signal);
    expect(JSON.parse(String(options?.body))).toMatchObject({
      query: expect.stringContaining('createReport(createReportInput: $createReportInput)'),
      variables: { createReportInput: { latLngTuple: [51, 3] } },
    });
  });

  it('rejects malformed mutation replies and inconsistent city/quarter associations without claiming guaranteed failure', () => {
    for (const createReport of [
      null, {}, { ...firstReport, latLngTuple: [1] },
      { ...firstReport, cityId: 9050 }, { ...firstReport, quarterId: 2 },
      { ...firstReport, quarter: null }, { ...firstReport, locationType: 'sea' },
      { ...firstReport, dbImageId: 'unsupported' },
      { ...firstReport, extra: 'x'.repeat(365) }, { ...firstReport, litterType: 'x'.repeat(81) },
      { ...firstReport, litterType: ' ' },
    ]) {
      expect(() => parseCreatedReport({ createReport })).toThrow('kan toch zijn toegevoegd');
    }
  });

  it.each([
    ['DEMO_RATE_LIMIT', { retryAfterSeconds: 42 }, '42 seconden'],
    ['DEMO_CAPACITY', {}, '100 nieuwe meldingen'],
    ['BAD_USER_INPUT', {}, 'Ongeldige wijk'],
  ])('surfaces explicit mutation rejection %s', async (code, extensions, message) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      errors: [{ message: 'Ongeldige wijk', extensions: { code, ...extensions } }],
    })));
    await expect(createReport({ latLngTuple: [51, 3] }, new AbortController().signal)).rejects.toThrow(message);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['network', 'http', 'json', 'graphql'])('makes %s write outcome uncertainty explicit and never retries', async (kind) => {
    if (kind === 'network') vi.mocked(fetch).mockRejectedValueOnce(new Error('Offline'));
    if (kind === 'http') vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 503 }));
    if (kind === 'json') vi.mocked(fetch).mockResolvedValueOnce(new Response('not json'));
    if (kind === 'graphql') vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: 'Unknown' }] })));
    await expect(createReport({ latLngTuple: [51, 3] }, new AbortController().signal)).rejects.toThrow('kan toch zijn toegevoegd');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
