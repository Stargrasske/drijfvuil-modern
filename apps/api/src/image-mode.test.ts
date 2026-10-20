import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DemoImages, FilesController, ImageUploadInterceptor } from './demo-images.js';
import { REPORT_REPOSITORY } from './repository.js';
import { validateReport } from './validate-report.js';

// This is a storage-mode-only fake. No data source, repository driver or database is constructed.
@Module({
  controllers: [FilesController],
  providers: [
    DemoImages, ImageUploadInterceptor,
    { provide: REPORT_REPOSITORY, useValue: { storage: { mode: 'postgres', persistent: true, synthetic: false } } },
  ],
})
class FakePostgresMode {}

describe('image capability denied in PostgreSQL mode (fake context only)', () => {
  let app: INestApplication;
  let origin: string;
  beforeAll(async () => {
    app = await NestFactory.create(FakePostgresMode, { logger: false });
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });

  it('rejects upload before parsing multipart and never silently falls back to demo memory', async () => {
    const body = new FormData();
    body.append('upload', new Blob(['synthetic'], { type: 'image/png' }), 'synthetic.png');
    const response = await fetch(`${origin}/files/upload`, {
      method: 'POST', body, signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/demo-modus/);
  });

  it('rejects image retrieval and nonempty report image references', async () => {
    const response = await fetch(`${origin}/files/images/00000000-0000-4000-8000-000000000001`, { signal: AbortSignal.timeout(5000) });
    expect(response.status).toBe(404);
    expect(() => validateReport({
      latLngTuple: [51, 3], dbImageId: '00000000-0000-4000-8000-000000000001',
    }, [{ id: 9000, name: 'Gent' }], [], false)).toThrow(/nog niet ondersteund/);
  });
});
