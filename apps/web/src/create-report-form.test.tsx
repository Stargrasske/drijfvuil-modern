import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateReportForm } from './create-report-form';
import { firstReport, mockResponse, testData } from './test-fixtures';

function setup() {
  const onCreated = vi.fn();
  const view = render(<CreateReportForm storage={testData.storage} cities={testData.cities} quarters={testData.quarters} onCreated={onCreated} />);
  return { ...view, onCreated };
}

async function fill() {
  await userEvent.type(screen.getByLabelText('Breedtegraad'), '51.0543');
  await userEvent.type(screen.getByLabelText('Lengtegraad'), '3.7206');
  await userEvent.type(screen.getByLabelText('Afvalsoort'), 'Plastic flessen');
  await userEvent.type(screen.getByLabelText('Extra informatie (optioneel)'), 'Een verzonnen melding');
}

describe('inline Dutch demo report form', () => {
  it('discloses persistent PostgreSQL mode and saved success without temporary/synthetic claims (mock API only)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ createReport: firstReport }));
    const onCreated = vi.fn();
    render(<CreateReportForm
      storage={{ mode: 'postgres', persistent: true, synthetic: false }}
      cities={testData.cities} quarters={testData.quarters} onCreated={onCreated}
    />);
    expect(screen.getByText(/verdwijnen niet bij herstart/)).toHaveTextContent('Nog niet goedgekeurd voor productie');
    expect(screen.queryByText(/tijdelijk|synthetisch|verzonnen gegevens/i)).not.toBeInTheDocument();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Melding toevoegen' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('opgeslagen in PostgreSQL'));
    expect(screen.getByRole('status')).not.toHaveTextContent(/tijdelijk|Demo/);
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(firstReport);
  });

  it('discloses temporary process storage and optional synthetic photo limits without login', () => {
    setup();
    expect(screen.getByText(/verdwijnen bij herstart/)).toHaveTextContent('Geen database of account');
    expect(screen.getByLabelText(/Foto \(optioneel/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload|inloggen/i })).not.toBeInTheDocument();
  });

  it('validates required fields with a focused visible summary and associated field errors before any request', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Demo-melding toevoegen' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Er is nog niets verstuurd');
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Breedtegraad')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Afvalsoort')).toHaveAccessibleDescription('Vul een afvalsoort van 1 tot 80 tekens in.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates coordinate ranges and extra 365 characters even when native controls are bypassed', async () => {
    setup();
    await fill();
    fireEvent.change(screen.getByLabelText('Breedtegraad'), { target: { value: '91' } });
    fireEvent.change(screen.getByLabelText('Lengtegraad'), { target: { value: '-181' } });
    fireEvent.change(screen.getByLabelText('Extra informatie (optioneel)'), { target: { value: 'x'.repeat(365) } });
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByRole('alert')).toHaveTextContent('maximaal 364');
    expect(screen.getByLabelText('Breedtegraad')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Lengtegraad')).toHaveAttribute('aria-invalid', 'true');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('submits valid boundary data, handles pending/success and synchronously blocks duplicate submissions', async () => {
    let finish: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { onCreated } = setup();
    await fill();
    fireEvent.change(screen.getByLabelText('Breedtegraad'), { target: { value: '-90' } });
    fireEvent.change(screen.getByLabelText('Lengtegraad'), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText('Extra informatie (optioneel)'), { target: { value: 'x'.repeat(364) } });
    const form = screen.getByRole('form');
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Demo-melding versturen…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Even geduld');
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () => { finish?.(mockResponse({ createReport: firstReport })); });
    expect(screen.getByRole('status')).toHaveTextContent('tijdelijke geheugen');
    expect(onCreated).toHaveBeenCalledWith(firstReport);
    expect(screen.getByLabelText('Afvalsoort')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Demo-melding toevoegen' })).toBeEnabled();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).variables.createReportInput)
      .toMatchObject({ latLngTuple: [-90, 180], locationType: 'water', extra: 'x'.repeat(364) });
  });

  it('shows API validation/rate errors without losing values or pretending to save', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      errors: [{ message: 'Te veel pogingen', extensions: { code: 'DEMO_RATE_LIMIT', retryAfterSeconds: 35 } }],
    })));
    const { onCreated } = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Demo-melding toevoegen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('35 seconden');
    expect(screen.getByLabelText('Afvalsoort')).toHaveValue('Plastic flessen');
    expect(screen.getByLabelText('Extra informatie (optioneel)')).toHaveValue('Een verzonnen melding');
    expect(onCreated).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retains values on uncertain network outcome with no automatic retry', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Offline'));
    const { onCreated } = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Demo-melding toevoegen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('kan toch zijn toegevoegd');
    expect(screen.getByLabelText('Breedtegraad')).toHaveValue(51.0543);
    expect(screen.getByLabelText('Afvalsoort')).toHaveValue('Plastic flessen');
    expect(onCreated).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resets an incompatible form quarter when its city changes', async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText('Wijk van melding (optioneel)'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Stad van melding'), '9050');
    const quarter = screen.getByLabelText('Wijk van melding (optioneel)');
    expect(quarter).toHaveValue('');
    expect(within(quarter).queryByRole('option', { name: 'Binnenstad' })).not.toBeInTheDocument();
    expect(within(quarter).getByRole('option', { name: 'Gentbrugge centrum' })).toBeInTheDocument();
  });

  it('aborts an in-flight write on unmount and ignores any late success without claiming rollback', async () => {
    let finish: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount, onCreated } = setup();
    await fill();
    fireEvent.submit(screen.getByRole('form'));
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { finish?.(mockResponse({ createReport: firstReport })); });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('allows a deliberate corrected resubmission after server validation failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      errors: [{ message: 'Controleer de wijk.', extensions: { code: 'BAD_USER_INPUT' } }],
    }))).mockResolvedValueOnce(mockResponse({ createReport: firstReport }));
    const { onCreated } = setup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Demo-melding toevoegen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Controleer de wijk');
    await userEvent.selectOptions(screen.getByLabelText('Wijk van melding (optioneel)'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Demo-melding toevoegen' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
