import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { CleanupAction } from './cleanup-action';
import { CleanupUncertain, fetchReportStatus, parseExplorerData, setReportCleaned } from './client';
import { SessionExpired } from './auth-client';
import { useExplorer } from './use-explorer';
import { firstReport, mockResponse, testData } from './test-fixtures';
import type { Report } from '../../../libs/contracts/src';

vi.mock('./report-map', () => ({
  ReportMap: ({ reports, onSelect }: { reports: Report[]; onSelect: (id: number) => void }) => (
    <div aria-label="Testkaart">{reports.map((report) =>
      <button key={report.id} onClick={() => onSelect(report.id)}>Kaartpunt {report.id}: {report.cleaned ? 'opgeruimd' : 'open'}</button>)}</div>
  ),
}));
const session = () => ({
  account: { id: 'demo-water', name: 'Demo Water' }, expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const confirmed = { ...firstReport, cleaned: true };

function action(authenticated = true) {
  const props = { report: firstReport, session: authenticated ? session() : null,
    onConfirmed: vi.fn(), onExpired: vi.fn(), onBusy: vi.fn() };
  render(<CleanupAction {...props} />);
  return props;
}

describe('M6 typed cleanup client', () => {
  it('requires explicit boolean demo status and null unsupported PG status', () => {
    expect(() => parseExplorerData({ ...testData, reports: [{ ...firstReport, cleaned: undefined }] })).toThrow();
    expect(() => parseExplorerData({ ...testData, reports: [{ ...firstReport, cleaned: 'true' }] })).toThrow();
    expect(() => parseExplorerData({ ...testData, reports: [{ ...firstReport, cleaned: null }] })).toThrow();
    expect(parseExplorerData({ ...testData, storage: { mode: 'postgres', persistent: true, synthetic: false },
      reports: [{ ...firstReport, cleaned: null }] }).reports[0]!.cleaned).toBeNull();
  });

  it('sends explicit desired state and same-origin cookies once, validates ID/state and returns isolated copies', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ setReportCleaned: confirmed }));
    const result = await setReportCleaned(1, true, new AbortController().signal);
    const options = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(options).toMatchObject({ credentials: 'same-origin', cache: 'no-store', method: 'POST' });
    expect(JSON.parse(String(options.body)).variables).toEqual({ id: 1, cleaned: true });
    expect(result).toEqual(confirmed);
    expect(result).not.toBe(confirmed);
    for (const invalid of [{ ...confirmed, id: 2 }, { ...confirmed, cleaned: false }, { ...confirmed, cleaned: null }]) {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ setReportCleaned: invalid }));
      await expect(setReportCleaned(1, true, new AbortController().signal)).rejects.toBeInstanceOf(CleanupUncertain);
    }
  });

  it.each([401, 403, 429])('handles HTTP %s without claiming success or automatically retrying', async (status) => {
    vi.mocked(fetch).mockResolvedValue(json({}, status));
    await expect(setReportCleaned(1, true, new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['UNAUTHENTICATED', 'FORBIDDEN', 'DEMO_RATE_LIMIT', 'BAD_USER_INPUT', 'NOT_FOUND', 'GRAPHQL_VALIDATION_FAILED'])(
    'handles GraphQL %s as a rejected write', async (code) => {
      vi.mocked(fetch).mockResolvedValue(json({ errors: [{ message: 'Controleer melding.', extensions: { code } }], data: null }));
      const result = setReportCleaned(1, true, new AbortController().signal);
      if (code === 'UNAUTHENTICATED') await expect(result).rejects.toBeInstanceOf(SessionExpired);
      else await expect(result).rejects.not.toBeInstanceOf(CleanupUncertain);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

  it.each(['network', 'invalid-json', 'server', 'bad-payload', 'internal-error'])(
    'reports uncertain outcome for %s and never retries', async (failure) => {
      if (failure === 'network') vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
      else if (failure === 'invalid-json') vi.mocked(fetch).mockResolvedValue(new Response('invalid'));
      else if (failure === 'server') vi.mocked(fetch).mockResolvedValue(json({}, 503));
      else if (failure === 'internal-error') vi.mocked(fetch).mockResolvedValue(json({ errors: [{ extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }));
      else vi.mocked(fetch).mockResolvedValue(json({ data: {} }));
      await expect(setReportCleaned(1, true, new AbortController().signal)).rejects.toBeInstanceOf(CleanupUncertain);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

  it('manual reconciliation is read-only, rejects failed reads and never writes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ report: confirmed }));
    expect((await fetchReportStatus(1, new AbortController().signal)).cleaned).toBe(true);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body)).query).not.toContain('mutation');
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 503));
    await expect(fetchReportStatus(1, new AbortController().signal)).rejects.toThrow('Er is niets opnieuw verstuurd');
  });

  it('reports HTTP 400 GraphQL input rejection explicitly instead of a success or hidden retry', async () => {
    vi.mocked(fetch).mockResolvedValue(json({
      errors: [{ message: 'cleaned moet een boolean zijn.', extensions: { code: 'BAD_USER_INPUT' } }],
    }, 400));
    await expect(setReportCleaned(1, true, new AbortController().signal)).rejects.toThrow('cleaned moet een boolean zijn.');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('failed manual network read retains uncertainty and explains that no write was resent', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
    await expect(fetchReportStatus(1, new AbortController().signal)).rejects.toThrow('Er is niets opnieuw verstuurd');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('M6 cleanup controls', () => {
  it('shows public status/guidance and no functional anonymous write control', () => {
    action(false);
    expect(screen.getByText('Status: Nog niet opgeruimd')).toBeInTheDocument();
    expect(screen.getByText(/beide verzonnen accounts/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Markeer als opgeruimd' })).not.toBeInTheDocument();
    expect(screen.getByText(/Open je demosessie/)).toBeInTheDocument();
  });

  it('retains confirmed state while pending, blocks duplicate submits and only updates after confirmation', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done; }));
    const props = action();
    const button = screen.getByRole('button', { name: 'Markeer als opgeruimd' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(screen.getByText('Status: Nog niet opgeruimd')).toBeInTheDocument();
    expect(props.onConfirmed).not.toHaveBeenCalled();
    await act(async () => { resolve(mockResponse({ setReportCleaned: confirmed })); });
    expect(props.onConfirmed).toHaveBeenCalledWith(confirmed);
    expect(screen.getByText(/Opruimstatus bevestigd/)).toBeInTheDocument();
  });

  it('treats lost committed response as uncertain and only re-enables writes after manual read recovery', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('response lost'));
    const props = action();
    await userEvent.click(screen.getByRole('button', { name: 'Markeer als opgeruimd' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('kan toch gewijzigd zijn');
    expect(screen.getByRole('button', { name: 'Markeer als opgeruimd' })).toBeDisabled();
    expect(props.onConfirmed).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 503));
    await userEvent.click(screen.getByRole('button', { name: 'Actuele opruimstatus ophalen' }));
    expect(screen.getByRole('button', { name: 'Markeer als opgeruimd' })).toBeDisabled();
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ report: confirmed }));
    await userEvent.click(screen.getByRole('button', { name: 'Actuele opruimstatus ophalen' }));
    expect(props.onConfirmed).toHaveBeenCalledWith(confirmed);
    expect(screen.getByText(/Actuele opruimstatus opgehaald/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('expiry notifies shared auth state, retains status and never retries', async () => {
    vi.mocked(fetch).mockResolvedValue(json({}, 401));
    const props = action();
    await userEvent.click(screen.getByRole('button', { name: 'Markeer als opgeruimd' }));
    expect(props.onExpired).toHaveBeenCalledTimes(1);
    expect(props.onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('demosessie is verlopen');
  });

  it('expired local session cannot submit', () => {
    render(<CleanupAction report={firstReport} session={{ ...session(), expiresAt: new Date(0).toISOString() }}
      onConfirmed={vi.fn()} onExpired={vi.fn()} onBusy={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Markeer als opgeruimd' })).not.toBeInTheDocument();
  });

  it('cannot write against old report data during a filter refresh', () => {
    render(<CleanupAction report={firstReport} session={session()} available={false}
      onConfirmed={vi.fn()} onExpired={vi.fn()} onBusy={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Markeer als opgeruimd' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([403, 429])('HTTP %s keeps confirmed status with actionable rejection', async (status) => {
    vi.mocked(fetch).mockResolvedValue(json({}, status));
    const props = action();
    await userEvent.click(screen.getByRole('button', { name: 'Markeer als opgeruimd' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 403 ? 'Geen toestemming' : 'Te veel opruimpogingen');
    expect(props.onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByText('Status: Nog niet opgeruimd')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('M6 explorer integration', () => {
  it('ignores an older in-flight read after a mutation confirmation', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse())
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(mockResponse({ ...testData, reports: [confirmed] }));
    const { result } = renderHook(() => useExplorer(9000, null));
    await waitFor(() => expect(result.current.status).toBe('success'));
    act(() => result.current.retry());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    act(() => result.current.confirmReport(confirmed));
    await act(async () => { finish(mockResponse()); });
    expect(result.current.data!.reports[0]!.cleaned).toBe(true);
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reconciles details/list/map, preserves city/quarter selection, reopens and removes controls on logout', async () => {
    let cleaned = false;
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (url === '/auth/session') return json({ session: session() });
      if (url === '/auth/logout') return json({ session: null });
      const body = JSON.parse(String(options?.body));
      if (body.query.includes('mutation SetDemoReportCleaned')) {
        cleaned = body.variables.cleaned;
        return mockResponse({ setReportCleaned: { ...firstReport, cleaned } });
      }
      return mockResponse({ ...testData, reports: [{ ...firstReport, cleaned }] });
    });
    render(<App />);
    await screen.findByRole('list', { name: 'Gevonden meldingen' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Wijk' }), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Demosessie openen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Markeer als opgeruimd' }));
    expect(await screen.findByText('Status: Opgeruimd')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('Opgeruimd')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kaartpunt 1: opgeruimd' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Stad' })).toHaveValue('9000');
    expect(screen.getByRole('combobox', { name: 'Wijk' })).toHaveValue('1');
    expect(screen.getByRole('article')).toHaveTextContent('MELDING #1');
    await userEvent.click(screen.getByRole('button', { name: 'Melding heropenen' }));
    expect(await screen.findByText('Status: Nog niet opgeruimd')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Afmelden' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Markeer als opgeruimd' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Demo-melding toevoegen' })).toBeInTheDocument();
  });
});
