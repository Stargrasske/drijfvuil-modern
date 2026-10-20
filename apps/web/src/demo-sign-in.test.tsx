import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DemoSignIn } from './demo-sign-in';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function session(milliseconds = 1_800_000) {
  return { account: { id: 'demo-water', name: 'Demo Water' }, expiresAt: new Date(Date.now() + milliseconds).toISOString() };
}

async function open() {
  const user = userEvent.setup();
  render(<DemoSignIn />);
  await user.click(screen.getByRole('button', { name: 'Demosessie openen' }));
  await screen.findByText('Je bent niet aangemeld.');
  return user;
}

describe('optional Dutch demo sign-in flow', () => {
  it('does not contact auth until requested and discloses non-real credentials and transport limits', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ session: null }));
    vi.stubGlobal('fetch', fetch);
    render(<DemoSignIn />);
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Demosessie openen' }));
    expect(await screen.findByText(/openbare demogegevens/)).toBeVisible();
    expect(screen.getByText('water@demo.invalid')).toBeVisible();
    expect(screen.getByText('oever@demo.invalid')).toBeVisible();
    expect(screen.getByText(/niet productieveilig/)).toBeVisible();
    await screen.findByText('Je bent niet aangemeld.');
  });

  it('blocks duplicate pending sign-in and signs in, checks protected account, then signs out', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(json({ session: null }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(json({ data: { demoAccount: session().account } }))
      .mockResolvedValueOnce(json({ session: null }));
    vi.stubGlobal('fetch', fetch);
    const user = await open();
    await user.type(screen.getByLabelText('Demowachtwoord'), 'Demo-water-1!');
    await user.click(screen.getByRole('button', { name: 'Aanmelden' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Demo aanmelden' }));
    expect(screen.getByRole('button', { name: 'Aanmelden' })).toBeDisabled();
    expect(screen.getByText('Demosessie verwerken…')).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => finish(json({ session: session() })));
    expect(await screen.findByText('Demo Water')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Controleer mijn demo-account' }));
    expect(await screen.findByText(/Beschermde accountcontrole geslaagd/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Afmelden' }));
    expect(await screen.findByText('Je bent afgemeld.')).toBeVisible();
    expect(screen.getByLabelText('Demowachtwoord')).toHaveValue('');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('clears passwords on generic failure and retries only after explicit submit', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ session: null }))
      .mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ session: session() }));
    vi.stubGlobal('fetch', fetch);
    const user = await open();
    await user.type(screen.getByLabelText('Demowachtwoord'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Aanmelden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Aanmelden mislukt');
    expect(screen.getByLabelText('Demowachtwoord')).toHaveValue('');
    expect(fetch).toHaveBeenCalledTimes(2);
    await user.type(screen.getByLabelText('Demowachtwoord'), 'Demo-water-1!');
    await user.click(screen.getByRole('button', { name: 'Aanmelden' }));
    expect(await screen.findByText('Demo Water')).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('recovers uncertain sign-in by manual session check without automatically repeating login', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ session: null }))
      .mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(json({ session: session() }));
    vi.stubGlobal('fetch', fetch);
    const user = await open();
    await user.type(screen.getByLabelText('Demowachtwoord'), 'Demo-water-1!');
    await user.click(screen.getByRole('button', { name: 'Aanmelden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('kan toch verwerkt');
    expect(fetch).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Sessiestatus controleren' }));
    expect(await screen.findByText('Demo Water')).toBeVisible();
    expect(fetch.mock.calls.map((call) => call[0])).toEqual(['/auth/session', '/auth/login', '/auth/session']);
  });

  it('restores existing cookies only through server confirmation and retains state on failed logout', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ session: session() }))
      .mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(json({ session: null }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DemoSignIn />);
    await user.click(screen.getByRole('button', { name: 'Demosessie openen' }));
    expect(await screen.findByText('Demo Water')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Afmelden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('kan toch verwerkt');
    expect(screen.getByText('Demo Water')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Sessiestatus controleren' }));
    expect(await screen.findByText('Je bent niet aangemeld.')).toBeVisible();
  });

  it('handles server-side expiry in the protected operation and offers sign-in recovery', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ session: session() }))
      .mockResolvedValueOnce(json({}, 401));
    vi.stubGlobal('fetch', fetch);
    render(<DemoSignIn />);
    await userEvent.click(screen.getByRole('button', { name: 'Demosessie openen' }));
    await screen.findByText('Demo Water');
    await userEvent.click(screen.getByRole('button', { name: 'Controleer mijn demo-account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('sessie is verlopen');
    expect(screen.getByRole('button', { name: 'Aanmelden' })).toBeEnabled();
  });

  it('expires the visible session at its absolute deadline without polling, renewal or login retries', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(json({ session: session(1000) }));
    vi.stubGlobal('fetch', fetch);
    render(<DemoSignIn />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Demosessie openen' })));
    expect(screen.getByText('Demo Water')).toBeVisible();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/sessie is verlopen/)).toBeVisible();
    expect(screen.queryByText('Demo Water', { selector: 'strong' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts pending work on unmount and reports initial session failure with manual recovery', async () => {
    const fetch = vi.fn();
    let pendingSignal: AbortSignal | undefined;
    fetch.mockImplementationOnce((_url: string, options: RequestInit) => {
      pendingSignal = options.signal ?? undefined;
      return new Promise(() => {});
    }).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const view = render(<DemoSignIn />);
    fireEvent.click(screen.getByRole('button', { name: 'Demosessie openen' }));
    view.unmount();
    expect(pendingSignal?.aborted).toBe(true);
    render(<DemoSignIn />);
    fireEvent.click(screen.getByRole('button', { name: 'Demosessie openen' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Geen sessiebevestiging'));
    expect(screen.getByRole('button', { name: 'Sessiestatus controleren' })).toBeEnabled();
  });
});
