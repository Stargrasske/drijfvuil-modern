import {
  EXPLORER_QUERY,
  CREATE_REPORT_MUTATION,
  REPORT_QUERY,
  SET_REPORT_CLEANED_MUTATION,
  EXTRA_MAX_LENGTH,
  LITTER_MAX_LENGTH,
  type City,
  type DbImage,
  type CreateReportDto,
  type ExplorerData,
  type Quarter,
  type Report,
  type ReportFilters,
  type StorageMetadata,
} from '../../../libs/contracts/src';
import { SessionExpired } from './auth-client';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function city(value: unknown): value is City {
  return record(value) && Number.isInteger(value.id) && typeof value.name === 'string';
}

function quarter(value: unknown): value is Quarter {
  return record(value) && Number.isInteger(value.id) &&
    Number.isInteger(value.cityId) && typeof value.quarter === 'string';
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function localImageUrl(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\/files\/images\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function image(value: unknown): value is DbImage {
  return record(value) && typeof value.id === 'string' &&
    typeof value.key === 'string' && localImageUrl(value.url) &&
    value.url === `/files/images/${value.id}`;
}

function report(value: unknown): value is Report {
  if (!record(value) || !Array.isArray(value.latLngTuple)) return false;
  const [lat, lng] = value.latLngTuple;
  return Number.isInteger(value.id) && Number.isInteger(value.cityId) &&
    (typeof value.cleaned === 'boolean' || value.cleaned === null) &&
    (value.quarterId === null || Number.isInteger(value.quarterId)) &&
    value.latLngTuple.length === 2 &&
    typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180 &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)) &&
    typeof value.locationType === 'string' && nullableString(value.litterType) &&
    nullableString(value.extra) && nullableString(value.dbImageId) &&
    city(value.city) && (value.quarter === null || quarter(value.quarter)) &&
    (value.dbImage === null ? value.dbImageId === null :
      image(value.dbImage) && value.dbImageId === value.dbImage.id);
}

export function parseExplorerData(value: unknown): ExplorerData {
  if (!record(value) || !Array.isArray(value.reports) || !value.reports.every(report) ||
    !Array.isArray(value.cities) || !value.cities.every(city) ||
    !Array.isArray(value.quarters) || !value.quarters.every(quarter) ||
    !storage(value.storage)) {
    throw new Error('De server stuurde ongeldige meldingsgegevens.');
  }
  const mode = value.storage.mode;
  if (!value.reports.every((item: Report) => mode === 'demo' ? typeof item.cleaned === 'boolean' : item.cleaned === null)) {
    throw new Error('De server stuurde een ongeldige opruimstatus voor deze opslagmodus.');
  }
  return { reports: value.reports, cities: value.cities, quarters: value.quarters, storage: value.storage };
}

export class CleanupUncertain extends Error {
  constructor() {
    super('Geen betrouwbare bevestiging. De opruimstatus kan toch gewijzigd zijn. Controleer de status met de leesknop; er wordt niet automatisch opnieuw verstuurd.');
  }
}

class CleanupRejected extends Error {}

function cleanupReport(payload: unknown, field: string, id: number): Report {
  if (!record(payload) || !record(payload.data) || !report(payload.data[field]) ||
    payload.data[field].id !== id || typeof payload.data[field].cleaned !== 'boolean') {
    throw new Error('De server stuurde een ongeldige opruimstatus.');
  }
  const value = payload.data[field];
  if (value.city.id !== value.cityId || (value.quarter === null ? value.quarterId !== null :
    value.quarter.id !== value.quarterId || value.quarter.cityId !== value.cityId)) {
    throw new Error('De server stuurde ongeldige meldingsrelaties.');
  }
  return structuredClone(value);
}

export async function fetchReportStatus(id: number, signal: AbortSignal): Promise<Report> {
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch('/graphql', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: REPORT_QUERY, variables: { id } }), signal,
    });
    payload = await response.json();
  } catch {
    throw new Error('Geen actuele status ontvangen. De eerder getoonde status blijft staan; probeer de leesknop later opnieuw. Er is niets opnieuw verstuurd.');
  }
  if (!response.ok) throw new Error(`Status controleren mislukt (HTTP ${response.status}). Er is niets opnieuw verstuurd.`);
  if (record(payload) && Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error('Status controleren mislukt. Er is niets opnieuw verstuurd.');
  }
  return cleanupReport(payload, 'report', id);
}

export async function setReportCleaned(id: number, cleaned: boolean, signal: AbortSignal): Promise<Report> {
  let payload: unknown;
  try {
    const response = await fetch('/graphql', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: SET_REPORT_CLEANED_MUTATION, variables: { id, cleaned } }),
      signal,
    });
    if (response.status === 401) throw new SessionExpired();
    if (response.status === 403) throw new CleanupRejected('Geen toestemming: alleen dezelfde lokale demo-oorsprong met een geldige demosessie mag deze status wijzigen.');
    if (response.status === 429) throw new CleanupRejected('Te veel opruimpogingen. Wacht minstens een minuut en probeer daarna zelf opnieuw.');
    if (!response.ok && response.status !== 400) throw new CleanupUncertain();
    payload = await response.json();
  } catch (cause) {
    if (cause instanceof SessionExpired || cause instanceof CleanupRejected) throw cause;
    throw new CleanupUncertain();
  }
  if (record(payload) && Array.isArray(payload.errors) && payload.errors.length) {
    const error: unknown = payload.errors[0];
    if (record(error) && record(error.extensions)) {
      if (error.extensions.code === 'UNAUTHENTICATED') throw new SessionExpired();
      if (error.extensions.code === 'FORBIDDEN') throw new CleanupRejected('Geen toestemming om de opruimstatus te wijzigen.');
      if (error.extensions.code === 'DEMO_RATE_LIMIT') throw new CleanupRejected('Te veel opruimpogingen. Wacht minstens een minuut en probeer daarna zelf opnieuw.');
      if (['BAD_USER_INPUT', 'NOT_FOUND', 'GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_PARSE_FAILED'].includes(String(error.extensions.code))) {
        throw new CleanupRejected(typeof error.message === 'string' ? error.message : 'Controleer het meldingnummer en de opruimstatus.');
      }
    }
    throw new CleanupUncertain();
  }
  try {
    const result = cleanupReport(payload, 'setReportCleaned', id);
    if (result.cleaned !== cleaned) throw new CleanupUncertain();
    return result;
  } catch { throw new CleanupUncertain(); }
}
function storage(value: unknown): value is StorageMetadata {
  return record(value) && (
    (value.mode === 'demo' && value.persistent === false && value.synthetic === true) ||
    (value.mode === 'postgres' && value.persistent === true && value.synthetic === false)
  );
}

export async function fetchExplorer(
  filters: Pick<ReportFilters, 'cityId' | 'quarterId'>,
  signal: AbortSignal,
): Promise<ExplorerData> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: EXPLORER_QUERY, variables: filters }),
    signal,
  });
  if (!response.ok) throw new Error(`Meldingen laden mislukt (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (!record(payload)) throw new Error('De server stuurde geen geldig GraphQL-antwoord.');
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error('De server kon de meldingen niet ophalen.');
  }
  return parseExplorerData(payload.data);
}

export function parseCreatedReport(value: unknown): Report {
  if (!record(value) || !report(value.createReport) ||
    value.createReport.city.id !== value.createReport.cityId ||
    (value.createReport.quarter === null ? value.createReport.quarterId !== null :
      value.createReport.quarter.id !== value.createReport.quarterId ||
      value.createReport.quarter.cityId !== value.createReport.cityId) ||
    !['water', 'land'].includes(value.createReport.locationType) ||
    (value.createReport.extra !== null && value.createReport.extra.length > EXTRA_MAX_LENGTH) ||
    (value.createReport.litterType !== null &&
      (value.createReport.litterType.trim().length === 0 || value.createReport.litterType.length > LITTER_MAX_LENGTH))) {
    throw new Error('Ongeldig antwoord. De melding kan toch zijn toegevoegd; controleer de lijst voordat je opnieuw verstuurt.');
  }
  return value.createReport;
}

export function validatePhoto(file: File): string | null {
  if (file.size === 0 || file.size > 5_000_000) return 'Kies een niet-lege foto van maximaal 5.000.000 bytes.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Kies JPEG, PNG of WebP.';
  return null;
}

export async function uploadPhoto(file: File, signal: AbortSignal): Promise<DbImage> {
  const invalid = validatePhoto(file);
  if (invalid) throw new Error(invalid);
  const form = new FormData();
  form.append('upload', file);
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch('/files/upload', { method: 'POST', body: form, signal });
    payload = await response.json();
  } catch {
    throw new Error('Geen uploadbevestiging. De foto kan toch opgeslagen zijn en een van de 10 plaatsen innemen. Geen automatische herhaling; beslis zelf of je opnieuw verstuurt.');
  }
  if (!response.ok) {
    if (response.status >= 500 && response.status !== 503) {
      throw new Error('Geen betrouwbare uploadbevestiging. De foto kan toch opgeslagen zijn en een plaats innemen; geen automatische herhaling.');
    }
    throw new Error(record(payload) && typeof payload.message === 'string'
      ? payload.message : `Foto uploaden mislukt (HTTP ${response.status}).`);
  }
  if (!image(payload) || !record(payload) || payload.dbImageId !== payload.id) {
    throw new Error('Ongeldige uploadbevestiging. De foto kan toch opgeslagen zijn; er wordt niet automatisch herhaald.');
  }
  return payload;
}

export async function createReport(input: CreateReportDto, signal: AbortSignal): Promise<Report> {
  let payload: unknown;
  try {
    const response = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: CREATE_REPORT_MUTATION,
        variables: { createReportInput: input },
      }),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch {
    throw new Error('Geen bevestiging ontvangen. De melding kan toch zijn toegevoegd; controleer de lijst voordat je opnieuw verstuurt. Er wordt niet automatisch opnieuw verstuurd.');
  }
  if (record(payload) && Array.isArray(payload.errors) && payload.errors.length > 0) {
    const error: unknown = payload.errors[0];
    if (record(error) && record(error.extensions)) {
      const { code, retryAfterSeconds } = error.extensions;
      if (code === 'DEMO_RATE_LIMIT' && typeof retryAfterSeconds === 'number' &&
        Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
        throw new Error(`Te veel pogingen. Wacht ${retryAfterSeconds} seconden voordat je opnieuw verstuurt.`);
      }
      if (code === 'DEMO_CAPACITY') throw new Error('De proceslimiet is bereikt (100 nieuwe meldingen). Er is niets toegevoegd.');
      if (code === 'BAD_USER_INPUT') {
        throw new Error(typeof error.message === 'string' ? error.message : 'Controleer de ingevulde gegevens.');
      }
    }
    throw new Error('Geen betrouwbare bevestiging. De melding kan toch zijn toegevoegd; controleer de lijst voordat je opnieuw verstuurt.');
  }
  return parseCreatedReport(record(payload) ? payload.data : null);
}
