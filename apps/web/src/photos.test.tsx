import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateReportForm } from './create-report-form';
import { localImageUrl, parseExplorerData, uploadPhoto, validatePhoto } from './client';
import { firstReport, mockResponse, testData } from './test-fixtures';

const id = '00000000-0000-4000-8000-000000000001';
const image = { id, key: `${id}.png`, url: `/files/images/${id}` };
const attached = { ...firstReport, dbImageId: id, dbImage: image };
const file = () => new File(['synthetic'], 'synthetic.png', { type: 'image/png' });
const uploadResponse = () => new Response(JSON.stringify({ ...image, dbImageId: id }), { status: 201 });

function setup() {
  const onCreated = vi.fn();
  const view = render(<CreateReportForm storage={testData.storage} cities={testData.cities} quarters={testData.quarters} onCreated={onCreated} />);
  fireEvent.change(screen.getByLabelText('Breedtegraad'), { target: { value: '51' } });
  fireEvent.change(screen.getByLabelText('Lengtegraad'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Afvalsoort'), { target: { value: 'Plastic' } });
  const chosen = file();
  fireEvent.change(screen.getByLabelText(/Foto \(optioneel/), { target: { files: [chosen] } });
  return { ...view, onCreated, chosen };
}

describe('optional synthetic photo client workflow', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('validates exact inclusive size, empty and unsupported type before network', () => {
    expect(validatePhoto(new File([new Uint8Array(5_000_000)], 'x', { type: 'image/png' }))).toBeNull();
    expect(validatePhoto(new File([new Uint8Array(5_000_001)], 'x', { type: 'image/png' }))).toMatch(/5.000.000/);
    expect(validatePhoto(new File([], 'x', { type: 'image/png' }))).not.toBeNull();
    expect(validatePhoto(new File(['x'], 'x', { type: 'image/svg+xml' }))).toMatch(/JPEG/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('previews without uploading and revokes on replacement and unmount', () => {
    const { unmount } = setup();
    expect(screen.getByAltText(/Voorbeeld/)).toHaveAttribute('src', 'blob:synthetic');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Foto \(optioneel/), { target: { files: [file()] } });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('latches synchronously through upload and mutation and selects attached success', async () => {
    let finish: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(mockResponse({ createReport: attached }));
    const { onCreated } = setup();
    const form = screen.getByRole('form');
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/files/upload');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
    await act(async () => { finish?.(uploadResponse()); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith(attached));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)).variables.createReportInput.dbImageId).toBe(id);
    expect(screen.queryByAltText(/Voorbeeld/)).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('retains values/file after upload rejection and never calls mutation', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Ongeldige foto' }), { status: 400 }));
    const { chosen, onCreated } = setup();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ongeldige foto');
    expect((screen.getByLabelText(/Foto \(optioneel/) as HTMLInputElement).files?.[0]).toBe(chosen);
    expect(screen.getByLabelText('Afvalsoort')).toHaveValue('Plastic');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('reuses confirmed upload on corrected report retry and warns it was not rolled back', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(uploadResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: 'Kies een wijk', extensions: { code: 'BAD_USER_INPUT' } }] })))
      .mockResolvedValueOnce(mockResponse({ createReport: attached }));
    const { onCreated } = setup();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('niet teruggedraaid');
    fireEvent.change(screen.getByLabelText('Afvalsoort'), { target: { value: '' } });
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByRole('alert')).toHaveTextContent('foto is al opgeslagen');
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('Afvalsoort'), { target: { value: 'Plastic' } });
    fireEvent.change(screen.getByLabelText('Extra informatie (optioneel)'), { target: { value: 'Correctie' } });
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(attached));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/files/upload')).toHaveLength(1);
  });

  it('warns lost upload response may consume capacity without automatic retries', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('lost response'));
    setup();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('toch opgeslagen');
    expect(screen.getByAltText(/Voorbeeld/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats an unexpected server upload failure as uncertain and does not write a report', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 500 }));
    setup();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('toch opgeslagen');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('warns lost report response may have created a report and retains the confirmed photo', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(uploadResponse()).mockRejectedValueOnce(new TypeError('lost response'));
    setup();
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('melding kan toch zijn toegevoegd');
    expect(screen.getByRole('alert')).toHaveTextContent('foto is al opgeslagen');
    expect(screen.getByAltText(/Voorbeeld/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not advertise photo capability in PostgreSQL mode', () => {
    render(<CreateReportForm storage={{ mode: 'postgres', persistent: true, synthetic: false }}
      cities={testData.cities} quarters={testData.quarters} onCreated={vi.fn()} />);
    expect(screen.queryByLabelText(/Foto \(optioneel/)).not.toBeInTheDocument();
    expect(screen.getByText(/Geen foto of account/)).toBeInTheDocument();
  });

  it('aborts in-flight upload on unmount', () => {
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => undefined));
    const { unmount } = setup();
    fireEvent.submit(screen.getByRole('form'));
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it.each(['https://external.invalid/photo', '//external.invalid/x', 'javascript:alert(1)', 'data:image/png;base64,x', '/files/images/../x'])(
    'rejects unexpected image URL %s before rendering or using an upload', async (url) => {
      expect(localImageUrl(url)).toBe(false);
      expect(() => parseExplorerData({ ...testData, reports: [{ ...attached, dbImage: { ...image, url } }] })).toThrow();
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...image, url, dbImageId: id })));
      await expect(uploadPhoto(file(), new AbortController().signal)).rejects.toThrow(/Ongeldige uploadbevestiging/);
    },
  );
});
