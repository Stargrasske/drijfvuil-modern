import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Report } from '../../../libs/contracts/src';
import { App } from './app';
import { firstReport, mockResponse, testData } from './test-fixtures';

vi.mock('./report-map', () => ({
  ReportMap: ({ reports, onSelect }: { reports: Report[]; onSelect: (id: number) => void }) => (
    <div aria-label="Testkaart">
      {reports.map((report) => <button key={report.id} onClick={() => onSelect(report.id)}>Kaartpunt {report.id}</button>)}
    </div>
  ),
}));

async function loaded() {
  vi.mocked(fetch).mockImplementation(async () => mockResponse());
  const view = render(<App />);
  await screen.findByRole('list', { name: 'Gevonden meldingen' });
  return view;
}

describe('redesigned report explorer', () => {
  it('renders the selected report attachment in details with meaningful alternative text', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const report = { ...firstReport, dbImageId: id, dbImage: { id, key: `${id}.png`, url: `/files/images/${id}` } };
    vi.mocked(fetch).mockImplementation(async () => mockResponse({ ...testData, reports: [report, testData.reports[1]] }));
    render(<App />);
    const photo = await screen.findByRole('img', { name: 'Bijgevoegde foto bij melding #1: Plastic' });
    expect(photo).toHaveAttribute('src', `/files/images/${id}`);
    await userEvent.click(screen.getByRole('button', { name: /Verpakking/ }));
    expect(screen.queryByRole('img', { name: /Bijgevoegde foto/ })).not.toBeInTheDocument();
  });

  it('preserves demo disclosures after the API confirms demo storage', async () => {
    await loaded();
    expect(screen.getByText('Demo · tijdelijk geheugen')).toBeInTheDocument();
    expect(screen.getByText(/Dit is een demonstratie met verzonnen meldingen/)).toBeInTheDocument();
    expect(screen.getByText(/Synthetische gegevens · automatisch/)).toBeInTheDocument();
  });

  it('discloses PostgreSQL data and blocked production without mislabeling it demo (mock response only)', async () => {
    vi.mocked(fetch).mockImplementation(async () => mockResponse({
      ...testData, reports: [], storage: { mode: 'postgres', persistent: true, synthetic: false },
    }));
    render(<App />);
    await screen.findByText('PostgreSQL · opgeslagen meldingen');
    expect(screen.getByText(/Productiegebruik is niet goedgekeurd/)).toBeInTheDocument();
    expect(screen.getByText('Geen meldingen voor deze selectie. Kies een andere stad of wijk.')).toBeInTheDocument();
    expect(screen.getByText(/PostgreSQL-gegevens · automatisch/)).toBeInTheDocument();
    expect(screen.queryByText(/synthetische data|tijdelijk geheugen|verzonnen meldingen/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Melding toevoegen' })).toBeInTheDocument();
  });

  it('rejects malformed storage metadata without displaying a demo disclosure or create form', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ...testData, storage: { mode: 'postgres' } }));
    render(<App />);
    await screen.findByRole('alert');
    expect(screen.getByText('Opslagstatus niet bevestigd')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByText('Demo · tijdelijk geheugen')).not.toBeInTheDocument();
  });

  it('does not guess storage mode and shows loading before the response', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined));
    render(<App />);
    expect(screen.getByText('Meldingen laden…')).toBeInTheDocument();
    expect(screen.getByText('Opslagstatus niet bevestigd')).toBeInTheDocument();
    expect(screen.queryByText(/verzonnen meldingen/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /opslaan|inloggen|upload/i })).not.toBeInTheDocument();
  });

  it('renders report data and allows accessible selection in the list', async () => {
    await loaded();
    const list = screen.getByRole('list', { name: 'Gevonden meldingen' });
    const packaging = within(list).getByRole('button', { name: /Verpakking/ });
    await userEvent.click(packaging);
    expect(packaging).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('article', { name: 'Geselecteerde melding' }))
      .toHaveTextContent('Verzonnen verpakking naast het pad.');
  });

  it('allows map selection to update the same selected-report detail', async () => {
    await loaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Kaartpunt 2' }));
    expect(screen.getByRole('article')).toHaveTextContent('Verzonnen verpakking');
  });

  it('sends quarter filters and resets quarter when city changes', async () => {
    await loaded();
    await userEvent.selectOptions(screen.getByLabelText('Wijk'), '2');
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/graphql', expect.objectContaining({
      body: expect.stringContaining('"quarterId":2'),
    })));
    await userEvent.selectOptions(screen.getByLabelText('Stad'), '9050');
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/graphql', expect.objectContaining({
      body: expect.stringContaining('"cityId":9050,"quarterId":null'),
    })));
    expect(screen.getByLabelText('Wijk')).toHaveValue('');
  });

  it('all cities sends null and disables the misleading quarter-only filter', async () => {
    await loaded();
    await userEvent.selectOptions(screen.getByLabelText('Stad'), '');
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/graphql', expect.objectContaining({
      body: expect.stringContaining('"cityId":null,"quarterId":null'),
    })));
    expect(screen.getByLabelText('Wijk')).toBeDisabled();
  });

  it('shows errors and retries explicitly', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Verbinding verbroken'))
      .mockResolvedValueOnce(mockResponse());
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Verbinding verbroken');
    await userEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    expect(await screen.findByRole('list', { name: 'Gevonden meldingen' })).toBeInTheDocument();
  });

  it('shows empty results without stale selected details', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ ...testData, reports: [] }));
    render(<App />);
    expect(await screen.findByText(/Geen demo-meldingen/)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('only asks for geolocation on user action and handles denial visibly', async () => {
    const locate = vi.fn((_success: PositionCallback, error?: PositionErrorCallback | null) => {
      error?.({ code: 1, message: 'Denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true, value: { getCurrentPosition: locate },
    });
    await loaded();
    expect(locate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Toon mijn locatie/ }));
    expect(locate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Je locatie is niet beschikbaar/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Gevonden meldingen' })).toBeInTheDocument();
  });

  it('displays a successful opt-in location result', async () => {
    const locate = vi.fn((success: PositionCallback) => success({
      coords: { latitude: 51.05, longitude: 3.72, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
      timestamp: 0,
      toJSON: () => ({}),
    }));
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true, value: { getCurrentPosition: locate },
    });
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: /Toon mijn locatie/ }));
    expect(screen.getByText(/Je locatie staat op de kaart/)).toBeInTheDocument();
  });

  it('aborts in-flight requests when unmounted', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined));
    const view = render(<App />);
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    view.unmount();
    expect(options?.signal?.aborted).toBe(true);
  });

  it('ignores a late response from an obsolete filter request', async () => {
    let finishFirst: ((response: Response) => void) | undefined;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(async () => mockResponse());
    render(<App />);
    await userEvent.selectOptions(screen.getByLabelText('Stad'), '');
    await screen.findByRole('list', { name: 'Gevonden meldingen' });
    await act(async () => {
      finishFirst?.(mockResponse({ ...testData, reports: [] }));
    });
    expect(screen.getByRole('list', { name: 'Gevonden meldingen' }).children).toHaveLength(2);
    expect(screen.queryByText(/Geen demo-meldingen/)).not.toBeInTheDocument();
  });

  it('polls after 60 seconds and removes the timer on unmount', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(async () => mockResponse());
    const view = render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes list and map, selects the created report and reconciles incompatible explorer filters', async () => {
    const created: Report = {
      ...firstReport,
      id: 5, cityId: 9050, city: { id: 9050, name: 'Gentbrugge' },
      quarterId: 3, quarter: { id: 3, cityId: 9050, quarter: 'Gentbrugge centrum' },
      litterType: 'Nieuw afval', extra: 'Nieuwe tijdelijke melding',
    };
    let saved = false;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      if (String(body.query).includes('mutation')) {
        saved = true;
        return mockResponse({ createReport: created });
      }
      return mockResponse(saved ? { ...testData, reports: [created] } : testData);
    });
    render(<App />);
    await screen.findByRole('list', { name: 'Gevonden meldingen' });
    await userEvent.selectOptions(screen.getByLabelText('Wijk'), '2');
    await userEvent.selectOptions(screen.getByLabelText('Stad van melding'), '9050');
    await userEvent.selectOptions(screen.getByLabelText('Wijk van melding (optioneel)'), '3');
    await userEvent.type(screen.getByLabelText('Breedtegraad'), '51');
    await userEvent.type(screen.getByLabelText('Lengtegraad'), '3');
    await userEvent.type(screen.getByLabelText('Afvalsoort'), 'Nieuw afval');
    await userEvent.click(screen.getByRole('button', { name: 'Demo-melding toevoegen' }));
    await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent('Nieuwe tijdelijke melding'));
    expect(screen.getByLabelText('Stad')).toHaveValue('9050');
    expect(screen.getByLabelText('Wijk')).toHaveValue('3');
    expect(within(screen.getByRole('list', { name: 'Gevonden meldingen' }))
      .getByRole('button', { name: /Nieuw afval/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('button', { name: 'Kaartpunt 5' })).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith('/graphql', expect.objectContaining({
      body: expect.stringContaining('"cityId":9050,"quarterId":3'),
    }));
  });
});
