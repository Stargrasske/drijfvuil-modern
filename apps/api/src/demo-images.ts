import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  BadRequestException, type CallHandler, Controller, type ExecutionContext, Get, Inject,
  Injectable, type NestInterceptor, NotFoundException, Param, PayloadTooLargeException, Post, Res, ServiceUnavailableException,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { defer, finalize, mergeMap, type Observable } from 'rxjs';
import type { DbImage } from '../../../libs/contracts/src/index.js';
import { REPORT_REPOSITORY, type ReportRepository } from './repository.js';

export const IMAGE_MAX_BYTES = 5_000_000;
export const IMAGE_CAPACITY = 10;
type Upload = { buffer: Buffer; mimetype: string };
type Stored = { metadata: DbImage; bytes: Buffer; type: string };
// Shared by every provider in this process. No reset or deletion endpoint.
const images = new Map<string, Stored>();
let reservations = 0;

function imageType(bytes: Buffer): { type: string; extension: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { type: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { type: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { type: 'image/webp', extension: 'webp' };
  }
  return null;
}

@Injectable()
export class DemoImages {
  reserve(): () => void {
    if (images.size + reservations >= IMAGE_CAPACITY) {
      throw new ServiceUnavailableException('Maximaal 10 foto’s per demoproces, inclusief ongekoppelde uploads. Herstart wist alle foto’s.');
    }
    reservations++;
    let released = false;
    return () => { if (!released) { released = true; reservations--; } };
  }

  store(file: Upload | undefined): DbImage {
    if (!file || file.buffer.length === 0) throw new BadRequestException('Kies één niet-lege foto in veld upload.');
    if (file.buffer.length > IMAGE_MAX_BYTES) throw new PayloadTooLargeException('Foto mag maximaal 5.000.000 bytes bevatten.');
    const detected = imageType(file.buffer);
    if (!detected || detected.type !== file.mimetype) {
      throw new BadRequestException('Alleen JPEG, PNG of WebP met overeenkomend bestandssignatuur en MIME-type.');
    }
    // Signatures identify the format only; this is not decoding or malware validation.
    if (images.size >= IMAGE_CAPACITY) throw new ServiceUnavailableException('Fotolimiet bereikt.');
    const id = randomUUID();
    const metadata = { id, key: `${id}.${detected.extension}`, url: `/files/images/${id}` };
    images.set(id, { metadata, bytes: Buffer.from(file.buffer), type: detected.type });
    return { ...metadata };
  }

  get(id: string): Stored {
    const value = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? images.get(id) : undefined;
    if (!value) throw new NotFoundException('Foto niet gevonden.');
    return { metadata: { ...value.metadata }, bytes: Buffer.from(value.bytes), type: value.type };
  }
}

@Injectable()
export class ImageUploadInterceptor implements NestInterceptor {
  constructor(
    @Inject(REPORT_REPOSITORY) private readonly repository: ReportRepository,
    @Inject(DemoImages) private readonly images: DemoImages,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.repository.storage.mode !== 'demo') throw new BadRequestException('Foto’s zijn uitsluitend beschikbaar in demo-modus.');
    const release = this.images.reserve();
    const request = context.switchToHttp().getRequest<IncomingMessage>();
    request.once('aborted', release);
    // Busboy marks equality as truncated: one sentinel byte makes exactly 5,000,000 inclusive.
    const Parser = FileInterceptor('upload', {
      limits: { fileSize: IMAGE_MAX_BYTES + 1, files: 1, fields: 0 },
    });
    return defer(async () => new Parser().intercept(context, next)).pipe(
      mergeMap((result) => result),
      finalize(() => {
        request.off('aborted', release);
        release();
      }),
    );
  }
}

type ImageResponse = {
  setHeader(name: string, value: string): void;
  send(bytes: Buffer): void;
};

@Controller('files')
export class FilesController {
  constructor(
    @Inject(REPORT_REPOSITORY) private readonly repository: ReportRepository,
    @Inject(DemoImages) private readonly images: DemoImages,
  ) {}

  @Post('upload')
  @UseInterceptors(ImageUploadInterceptor)
  upload(@UploadedFile() file?: Upload) {
    const metadata = this.images.store(file);
    return { ...metadata, dbImageId: metadata.id };
  }

  @Get('images/:id')
  image(@Param('id') id: string, @Res() response: ImageResponse) {
    if (this.repository.storage.mode !== 'demo') throw new NotFoundException('Foto’s niet beschikbaar.');
    const stored = this.images.get(id);
    response.setHeader('Content-Type', stored.type);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Disposition', `inline; filename="${stored.metadata.key}"`);
    response.send(stored.bytes);
  }
}
