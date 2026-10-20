import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoApplication } from './bootstrap.js';
import { DemoImages } from './demo-images.js';
import { DemoRepository } from './demo-repository.js';
import { CREATE_REPORT_MUTATION, type DbImage } from '../../../libs/contracts/src/index.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
const webp = Buffer.from('524946460c000000574542505650384c00000000', 'hex');

describe('actual loopback multipart demo image vertical slice', () => {
  let app: INestApplication;
  let origin: string;
  let first: DbImage;
  const timeout = () => AbortSignal.timeout(5000);

  beforeAll(async () => {
    app = await createDemoApplication('demo');
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });

  async function upload(bytes: Buffer, type = 'image/png', count = 1, field = 'upload', target = origin) {
    const body = new FormData();
    for (let i = 0; i < count; i++) body.append(field, new Blob([new Uint8Array(bytes)], { type }), '../../private-name.png');
    return fetch(`${target}/files/upload`, { method: 'POST', body, signal: timeout() });
  }
  async function gql(query: string, variables?: unknown) {
    const response = await fetch(`${origin}/graphql`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }), signal: timeout(),
    });
    return response.json();
  }

  it.each([
    [Buffer.alloc(0), 'image/png', 1, 'upload'],
    [png, 'image/jpeg', 1, 'upload'],
    [Buffer.from('not a photo'), 'image/png', 1, 'upload'],
    [png, 'image/svg+xml', 1, 'upload'],
    [png, 'image/png', 2, 'upload'],
    [png, 'image/png', 1, 'wrong'],
    [png, 'image/png', 0, 'upload'],
  ] as const)('rejects empty, mismatched, unsupported, multiple or missing uploads %#', async (bytes, type, count, field) => {
    expect((await upload(bytes, type, count, field)).status).toBe(400);
  });

  it('rejects 5,000,001 bytes without consuming capacity', async () => {
    const bytes = Buffer.alloc(5_000_001);
    png.copy(bytes);
    expect((await upload(bytes)).status).toBe(413);
  });

  it('rejects malformed multipart and releases its reservation', async () => {
    const response = await fetch(`${origin}/files/upload`, {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic' },
      body: '--synthetic\r\nContent-Disposition: form-data; name="upload"; filename="x"\r\n\r\nbroken',
      signal: timeout(),
    });
    expect(response.status).toBe(400);
  });

  it.each([[png, 'image/png', 'png'], [jpeg, 'image/jpeg', 'jpg'], [webp, 'image/webp', 'webp']] as const)(
    'roundtrips supported signature bytes and safe headers %#', async (bytes, type, extension) => {
      const response = await upload(bytes, type);
      expect(response.status).toBe(201);
      const image = await response.json() as DbImage;
      first ??= { id: image.id, key: image.key, url: image.url };
      expect(image.key).toBe(`${image.id}.${extension}`);
      const result = await fetch(`${origin}${image.url}`, { signal: timeout() });
      expect(result.status).toBe(200);
      expect(result.headers.get('content-type')).toBe(type);
      expect(result.headers.get('x-content-type-options')).toBe('nosniff');
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(result.headers.get('content-disposition')).toBe(`inline; filename="${image.key}"`);
      expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
    },
  );

  it('accepts exactly 5,000,000 bytes inclusive', async () => {
    const bytes = Buffer.alloc(5_000_000);
    png.copy(bytes);
    const response = await upload(bytes);
    expect(response.status).toBe(201);
    const image = await response.json() as DbImage;
    expect((await fetch(`${origin}${image.url}`, { signal: timeout() })).headers.get('content-length')).toBe('5000000');
  });

  it('creates, reads and filters an actual uploaded GraphQL reference; unknown references do not write', async () => {
    const repository = app.get(DemoRepository);
    const before = repository.reports({ cityId: null }).length;
    const invalid = await gql(CREATE_REPORT_MUTATION, { createReportInput: { latLngTuple: [51, 3], dbImageId: 'unknown' } });
    expect(invalid.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    expect(repository.reports({ cityId: null })).toHaveLength(before);
    const result = await gql(CREATE_REPORT_MUTATION, { createReportInput: { latLngTuple: [51, 3], dbImageId: first.id } });
    expect(result.errors).toBeUndefined();
    expect(result.data.createReport.dbImage).toEqual(first);
    const id = result.data.createReport.id;
    const read = await gql(`{ report(id: ${id}) { dbImage { id key url } } reports { id dbImage { url } } }`);
    expect(read.data.report.dbImage).toEqual(first);
    expect(read.data.reports).toContainEqual({ id, dbImage: { url: first.url } });
    result.data.createReport.dbImage.key = 'changed';
    const copy = repository.report(id);
    copy.dbImage!.key = 'changed';
    expect(repository.report(id).dbImage).toEqual(first);
    const store = new DemoImages();
    const stored = store.get(first.id);
    stored.bytes.fill(0);
    stored.metadata.key = 'changed';
    expect(store.get(first.id).bytes).toEqual(png);
    expect(store.get(first.id).metadata).toEqual(first);
  });

  it.each(['nope', '00000000-0000-4000-8000-000000000000', '..%2Fprivate'])('rejects invalid/unknown route id %s', async (id) => {
    expect((await fetch(`${origin}/files/images/${id}`, { signal: timeout() })).status).toBe(404);
  });

  it('shares the 10-image cap across concurrent requests and provider instances; failures released every reservation', async () => {
    const second = await createDemoApplication('demo');
    try {
      await second.listen(0, '127.0.0.1');
      const otherOrigin = await second.getUrl();
      const responses = await Promise.all(Array.from({ length: 12 }, (_, index) =>
        upload(png, 'image/png', 1, 'upload', index % 2 ? origin : otherOrigin)));
      expect(responses.filter((response) => response.status === 201)).toHaveLength(6);
      expect(responses.filter((response) => response.status === 503)).toHaveLength(6);
      expect(() => new DemoImages().reserve()).toThrow(/10/);
      expect((await upload(png)).status).toBe(503);
    } finally {
      await second.close();
    }
  });
});
