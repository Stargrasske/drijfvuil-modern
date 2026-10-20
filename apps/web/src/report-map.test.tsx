import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map } from 'leaflet';
import type { ComponentProps } from 'react';
import type * as ReactLeaflet from 'react-leaflet';
import { App } from './app';
import { ReportMap } from './report-map';
import { firstReport, mockResponse, testData } from './test-fixtures';

const harness = vi.hoisted(() => ({ map: null as Map | null }));
vi.mock('react-leaflet', async (original) => {
  const actual = await original<typeof ReactLeaflet>();
  function Probe() { harness.map = actual.useMap(); return null; }
  return {
    ...actual,
    MapContainer: ({ children, ...props }: ComponentProps<typeof actual.MapContainer>) => (
      <actual.MapContainer {...props}><Probe />{children}</actual.MapContainer>
    ),
  };
});

describe('M7 actual lazy map/explorer integration', () => {
  it('retains cleanup selection locks through cluster/list, lost writes and failed manual reads', async () => {
    let rejectWrite!: (cause: Error) => void;
    let recovery = false;
    let cleaned = false;
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (url === '/auth/session') return new Response(JSON.stringify({ session: {
        account: { id: 'demo-water', name: 'Demo Water' },
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      } }));
      const body = JSON.parse(String(options?.body));
      if (body.query.includes('mutation SetDemoReportCleaned')) {
        return new Promise((_resolve, reject) => { rejectWrite = reject; });
      }
      if (body.query.includes('query DemoReportStatus')) {
        if (!recovery) throw new Error('synthetic failed manual read');
        cleaned = true;
        return mockResponse({ report: { ...firstReport, cleaned } });
      }
      return mockResponse({ ...testData, reports: [{ ...firstReport, cleaned }, second] });
    });
    render(<App />);
    await screen.findByRole('list', { name: 'Gevonden meldingen' });
    await screen.findByRole('button', { name: /^2 meldingen in deze groep/ });
    await userEvent.click(cluster());
    await userEvent.click(screen.getByRole('button', { name: 'Demosessie openen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Markeer als opgeruimd' }));
    expect(cluster()).toHaveAttribute('aria-disabled', 'true');
    const member = screen.getByRole('button', { name: /#2 · Verpakking/ });
    const listButton = within(screen.getByRole('list', { name: 'Gevonden meldingen' }))
      .getByRole('button', { name: /Verpakking/ });
    expect(member).toHaveAttribute('aria-disabled', 'true');
    expect(listButton).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(member);
    expect(screen.getByRole('article')).toHaveTextContent('MELDING #1');
    await act(async () => { rejectWrite(new TypeError('synthetic lost write response')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('kan toch gewijzigd zijn');
    await userEvent.click(screen.getByRole('button', { name: 'Actuele opruimstatus ophalen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Er is niets opnieuw verstuurd');
    expect(cluster()).toHaveAttribute('aria-disabled', 'true');
    expect(listButton).toHaveAttribute('aria-disabled', 'true');
    expect(member).toHaveAttribute('aria-disabled', 'true');
    recovery = true;
    await userEvent.click(screen.getByRole('button', { name: 'Actuele opruimstatus ophalen' }));
    await waitFor(() => expect(cluster()).toHaveAttribute('aria-disabled', 'false'));
    expect(cluster()).toHaveAccessibleName(/geselecteerde melding #1: Opgeruimd/);
    expect(screen.getByRole('article')).toHaveTextContent('MELDING #1');
    await userEvent.click(member);
    expect(screen.getByRole('article')).toHaveTextContent('MELDING #2');
    expect(within(screen.getByRole('list', { name: 'Gevonden meldingen' }))
      .getByRole('button', { name: /Verpakking/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the lazy map instance through reads, ignores obsolete filter responses and unmounts safely', async () => {
    let finishOld!: (response: Response) => void;
    let reads = 0;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      reads++;
      if (reads === 2) return new Promise((resolve) => { finishOld = resolve; });
      return mockResponse({ ...testData, reports: body.variables.cityId === null ? [second] : [firstReport, second] });
    });
    const view = render(<App />);
    await screen.findByRole('button', { name: /^2 meldingen in deze groep/ });
    const map = harness.map!;
    await userEvent.selectOptions(screen.getByLabelText('Wijk'), '1');
    expect(screen.getByText(/Kaart wordt bijgewerkt/)).toBeInTheDocument();
    expect(cluster()).toHaveAttribute('aria-disabled', 'true');
    expect(harness.map).toBe(map);
    await userEvent.selectOptions(screen.getByLabelText('Stad'), '');
    await screen.findByRole('button', { name: /^Melding #2:/ });
    await act(async () => { finishOld(mockResponse()); });
    expect(document.querySelectorAll('.map-report-button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Melding #2:/ })).toBeInTheDocument();
    expect(harness.map).toBe(map);
    view.unmount();
    expect(document.querySelector('.leaflet-container')).toBeNull();
  });

  it('fits only newly confirmed filter data, never the previous filter on the intermediate render', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ...testData, reports: [firstReport] }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await screen.findByRole('button', { name: /^Melding #1:/ });
    const fit = vi.spyOn(harness.map!, 'fitBounds');
    await userEvent.selectOptions(screen.getByLabelText('Stad'), '');
    expect(fit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Melding #1:/ })).toHaveAttribute('aria-disabled', 'true');
    const remote = { ...second, latLngTuple: [51.1, 3.8] as [number, number] };
    await act(async () => { finish(mockResponse({ ...testData, reports: [remote] })); });
    expect(fit).toHaveBeenCalledTimes(1);
    expect(harness.map!.getCenter().lat).toBeCloseTo(remote.latLngTuple[0], 4);
    expect(harness.map!.getCenter().lng).toBeCloseTo(remote.latLngTuple[1], 4);
  });

  const pollingData = () => ({ ...testData, reports: [
    firstReport, second,
    { ...firstReport, id: 3, latLngTuple: [51.0734, 3.7301] as [number, number], litterType: 'Derde' },
  ] });
  async function pollingApp() {
    const intervals = vi.spyOn(window, 'setInterval');
    let finish!: (response: Response) => void;
    let reads = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === '/auth/session') return new Response(JSON.stringify({ session: {
        account: { id: 'demo-water', name: 'Demo Water' },
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      } }));
      if (++reads === 1) return mockResponse(pollingData());
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<App />);
    await screen.findByRole('button', { name: /^2 meldingen in deze groep/ });
    await userEvent.click(cluster());
    await userEvent.click(screen.getByRole('button', { name: /#2 · Verpakking/ }));
    const callback = intervals.mock.calls.find((call) => call[1] === 60_000)![0];
    expect(typeof callback).toBe('function');
    return {
      poll: () => act(() => { if (typeof callback === 'function') callback(); }),
      finish: async (data = pollingData()) => act(async () => { finish(mockResponse(data)); }),
    };
  }

  it.each(['chooser', 'cluster', 'singleton', 'list', 'cleanup read', 'cleanup write'] as const)(
    'retains actual App %s focus before/pending/settled periodic reads while blocking all activation',
    async (control) => {
      const pending = await pollingApp();
      if (control === 'cleanup write') {
        await userEvent.click(screen.getByRole('button', { name: 'Demosessie openen' }));
        await screen.findByRole('button', { name: 'Melding heropenen' });
      }
      const list = screen.getByRole('list', { name: 'Gevonden meldingen' });
      const target = control === 'chooser' ? screen.getByRole('button', { name: /#2 · Verpakking/ })
        : control === 'cluster' ? cluster()
          : control === 'singleton' ? screen.getByRole('button', { name: /^Melding #3:/ })
            : control === 'cleanup read' ? screen.getByRole('button', { name: 'Actuele opruimstatus ophalen' })
              : control === 'cleanup write' ? screen.getByRole('button', { name: 'Melding heropenen' })
                : within(list).getByRole('button', { name: /Verpakking/ });
      act(() => { target.focus(); });
      const map = harness.map!;
      const center = map.getCenter();
      const zoom = map.getZoom();
      expect(target).toHaveFocus();
      const beforeReads = vi.mocked(fetch).mock.calls.length;
      pending.poll();
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(beforeReads + 1));
      expect(target.isConnected).toBe(true);
      expect(target).toHaveFocus();
      expect(target).not.toBeDisabled();
      expect(target).toHaveAttribute('aria-disabled', 'true');
      expect(fireEvent.keyDown(target, { key: 'Enter' })).toBe(false);
      expect(fireEvent.keyDown(target, { key: ' ' })).toBe(false);
      await userEvent.keyboard('{Enter} ');
      // Programmatic click bypasses neither aria-disabled nor cleanup/read guards.
      act(() => {
        document.querySelectorAll<HTMLButtonElement>('.map-report-button,.map-members li button,.report-card,.cleanup-action button')
          .forEach((button) => {
            expect(button).toHaveAttribute('aria-disabled', 'true');
            button.click();
          });
      });
      expect(screen.getByRole('article')).toHaveTextContent('MELDING #2');
      expect(fetch).toHaveBeenCalledTimes(beforeReads + 1);
      expect(target).toHaveFocus();
      expect(map.getCenter()).toEqual(center);
      expect(map.getZoom()).toBe(zoom);
      await pending.finish();
      await waitFor(() => expect(target).toHaveAttribute('aria-disabled', 'false'));
      expect(target.isConnected).toBe(true);
      expect(target).toHaveFocus();
      expect(map.getCenter()).toEqual(center);
      expect(map.getZoom()).toBe(zoom);
    },
  );

  it.each(['Tab', 'click'] as const)('does not restore old focus after intentional %s during a real App read', async (move) => {
    const pending = await pollingApp();
    const member = screen.getByRole('button', { name: /#2 · Verpakking/ });
    member.focus();
    pending.poll();
    await waitFor(() => expect(member).toHaveAttribute('aria-disabled', 'true'));
    if (move === 'Tab') await userEvent.tab();
    else await userEvent.click(screen.getByRole('button', { name: /Toon mijn locatie/ }));
    const chosenFocus = document.activeElement;
    expect(chosenFocus).not.toBe(member);
    await pending.finish();
    expect(chosenFocus).toHaveFocus();
    expect(member).not.toHaveFocus();
  });

  it('does not refocus a chooser invalidated by new membership during the periodic read', async () => {
    const pending = await pollingApp();
    const member = screen.getByRole('button', { name: /#2 · Verpakking/ });
    member.focus();
    pending.poll();
    await waitFor(() => expect(member).toHaveAttribute('aria-disabled', 'true'));
    await pending.finish({ ...pollingData(), reports: [pollingData().reports[2]!] });
    expect(member.isConnected).toBe(false);
    expect(member).not.toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Meldingen uit gekozen groep' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Melding #3:/ })).not.toHaveFocus();
  });
});

const second = { ...firstReport, id: 2, litterType: 'Verpakking', cleaned: true };
function props() {
  return { reports: [firstReport, second], selectedId: 1, position: null, onSelect: vi.fn() };
}
const cluster = () => screen.getByRole('button', { name: /^2 meldingen in deze groep/ });
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(370);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(370);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, width: 800, height: 370, right: 800, bottom: 370,
    toJSON: () => ({}),
  });
});

describe('M7 real Leaflet controls and lifecycle (jsdom)', () => {
  it('exposes Dutch native cluster buttons, selection and truthful member statuses', async () => {
    const input = props();
    render(<ReportMap {...input} />);
    expect(cluster()).toHaveAttribute('type', 'button');
    expect(cluster()).toHaveAccessibleName(/geselecteerde melding #1: Nog niet opgeruimd/);
    await userEvent.click(cluster());
    const chooser = screen.getByRole('region', { name: 'Meldingen uit gekozen groep' });
    expect(within(chooser).getByRole('heading')).toHaveFocus();
    expect(within(chooser).getByRole('button', { name: /#2 · Verpakking · Opgeruimd/ })).toBeEnabled();
    await userEvent.click(within(chooser).getByRole('button', { name: /#2 ·/ }));
    expect(input.onSelect).toHaveBeenCalledExactlyOnceWith(2);
    expect(screen.getByText(/Getallen tellen meldingen, niet opruimacties/)).toBeInTheDocument();
  });

  it.each(['{Enter}', ' '])('really activates the cluster and member with keyboard %s', async (key) => {
    const input = props();
    render(<ReportMap {...input} />);
    cluster().focus();
    await userEvent.keyboard(key);
    const member = screen.getByRole('button', { name: /#2 · Verpakking/ });
    member.focus();
    await userEvent.keyboard(key);
    expect(input.onSelect).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('zooms a noncolocated cluster and preserves single-report activation', async () => {
    const input = { ...props(), reports: [firstReport, { ...second, latLngTuple: [51.0543, 3.7226] as [number, number] }] };
    render(<ReportMap {...input} />);
    act(() => { harness.map!.setZoom(13, { animate: false }); });
    await userEvent.click(cluster());
    expect(harness.map!.getZoom()).toBe(15);
    act(() => { harness.map!.setZoom(18, { animate: false }); });
    await userEvent.click(screen.getByRole('button', { name: /^Melding #2:/ }));
    expect(input.onSelect).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('reveals colocated/max-zoom members without an infinite zoom or inaccessible report', async () => {
    render(<ReportMap {...props()} />);
    act(() => { harness.map!.setZoom(18, { animate: false }); });
    const setView = vi.spyOn(harness.map!, 'setView');
    await userEvent.click(cluster());
    expect(setView).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /#1 · Plastic/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /#2 · Verpakking/ })).toBeEnabled();
  });

  it('updates selected/status labels in the cluster and open chooser without focus theft or recenter', async () => {
    const input = props();
    const view = render(<ReportMap {...input} />);
    await userEvent.click(cluster());
    const member = screen.getByRole('button', { name: /#2 · Verpakking/ });
    member.focus();
    const setView = vi.spyOn(harness.map!, 'setView');
    view.rerender(<ReportMap {...input} selectedId={2} reports={[firstReport, { ...second, cleaned: false }]} />);
    expect(cluster()).toHaveAccessibleName(/geselecteerde melding #2: Nog niet opgeruimd/);
    expect(member).toHaveAttribute('aria-pressed', 'true');
    expect(member).toHaveTextContent('Nog niet opgeruimd');
    expect(member).toHaveFocus();
    expect(setView).not.toHaveBeenCalled();
  });

  it('keeps the same native marker button and focus across status-only updates', () => {
    const input = props();
    const view = render(<ReportMap {...input} />);
    const button = cluster();
    button.focus();
    view.rerender(<ReportMap {...input} reports={[{ ...firstReport, cleaned: true }, second]} />);
    expect(cluster()).toBe(button);
    expect(button).toHaveFocus();
    expect(button).toHaveAccessibleName(/geselecteerde melding #1: Opgeruimd/);
  });

  it('brings an explicitly keyboard-focused offscreen marker into view without zooming', () => {
    render(<ReportMap {...props()} />);
    const map = harness.map!;
    act(() => { map.setView([52, 4], 15, { animate: false }); });
    const zoom = map.getZoom();
    const pan = vi.spyOn(map, 'panInside');
    act(() => { cluster().focus(); });
    expect(pan).toHaveBeenCalledWith(firstReport.latLngTuple, { padding: [28, 28], animate: false });
    expect(map.getZoom()).toBe(zoom);
  });

  it('locks cluster/member/single controls for pending or uncertain cleanup and pending reads', async () => {
    const input = props();
    const view = render(<ReportMap {...input} />);
    await userEvent.click(cluster());
    view.rerender(<ReportMap {...input} selectionLocked />);
    expect(cluster()).toHaveAttribute('aria-disabled', 'true');
    const member = screen.getByRole('button', { name: /#2 · Verpakking/ });
    expect(member).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(member);
    expect(input.onSelect).not.toHaveBeenCalled();
    view.rerender(<ReportMap {...input} ready={false} />);
    expect(cluster()).toHaveAttribute('aria-disabled', 'true');
    view.rerender(<ReportMap {...input} reports={[firstReport]} selectionLocked />);
    const single = screen.getByRole('button', { name: /^Melding #1:/ });
    expect(single).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(single);
    expect(input.onSelect).not.toHaveBeenCalled();
  });

  it('handles filter/add/remove/empty cycles, closes obsolete member sets and has no stale markers', async () => {
    const input = props();
    const view = render(<ReportMap {...input} />);
    await userEvent.click(cluster());
    view.rerender(<ReportMap {...input} reports={[second]} viewportKey="quarter2" />);
    expect(screen.queryByRole('region', { name: 'Meldingen uit gekozen groep' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^2 meldingen/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Melding #2:/ })).toBeInTheDocument();
    view.rerender(<ReportMap {...input} reports={[]} />);
    expect(document.querySelectorAll('.map-report-button')).toHaveLength(0);
    view.rerender(<ReportMap {...input} reports={[...input.reports, { ...firstReport, id: 3 }]} />);
    expect(screen.getByRole('button', { name: /^3 meldingen/ })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not reset user pan/zoom during polling/status updates, but fits explicit new filters', () => {
    const input = props();
    const view = render(<ReportMap {...input} viewportKey="all" />);
    act(() => { harness.map!.setView([51.1, 3.8], 12, { animate: false }); });
    const fit = vi.spyOn(harness.map!, 'fitBounds');
    view.rerender(<ReportMap {...input} ready={false} viewportKey="all" />);
    view.rerender(<ReportMap {...input} reports={[...input.reports]} viewportKey="all" />);
    expect(fit).not.toHaveBeenCalled();
    expect(harness.map!.getZoom()).toBe(12);
    view.rerender(<ReportMap {...input} viewportKey="quarter1" />);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('survives repeated zoom/filter/unmount/remount cycles without pending animated map work', async () => {
    for (let index = 0; index < 4; index++) {
      const input = props();
      const view = render(<ReportMap {...input} />);
      const map = harness.map!;
      expect(map.options.zoomAnimation).toBe(false);
      expect(map.options.fadeAnimation).toBe(false);
      act(() => { map.setZoom(13, { animate: false }); });
      await userEvent.click(cluster());
      view.rerender(<ReportMap {...input} reports={[]} viewportKey={String(index)} />);
      view.unmount();
      expect(document.querySelector('.leaflet-container')).toBeNull();
    }
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });
});
