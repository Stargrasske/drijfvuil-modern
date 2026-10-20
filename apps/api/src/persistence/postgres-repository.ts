import { ForbiddenException, NotFoundException, type OnApplicationShutdown } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type {
  City, Quarter, Report, CreateReportDto, ReportFilters,
} from '../../../../libs/contracts/src/index.js';
import { demoWriteBudget } from '../demo-write-budget.js';
import type { ReportRepository } from '../repository.js';
import { invalidReport, validateReport } from '../validate-report.js';
import type { ReportRow } from './entities.js';
import { createSource, postgresOptions, type PersistenceSource, type SourceFactory, type StorageConfiguration } from './configuration.js';

const constraints: Record<string, { field: string; message: string; code: string }> = {
  report_latitude_check: { field: 'latLngTuple', message: 'Ongeldige breedtegraad.', code: '23514' },
  report_longitude_check: { field: 'latLngTuple', message: 'Ongeldige lengtegraad.', code: '23514' },
  report_city_fk: { field: 'cityId', message: 'Kies een bekende stad.', code: '23503' },
  report_quarter_city_fk: { field: 'quarterId', message: 'Kies een bekende wijk die bij de stad hoort.', code: '23503' },
  report_location_check: { field: 'locationType', message: 'Locatie moet water of land zijn.', code: '23514' },
  report_litter_check: { field: 'litterType', message: 'Afvalsoort moet 1 tot 80 tekens bevatten wanneer opgegeven.', code: '23514' },
  report_extra_check: { field: 'extra', message: 'Extra informatie mag maximaal 364 tekens bevatten.', code: '23514' },
};

export class PostgresRepository implements ReportRepository, OnApplicationShutdown {
  readonly storage = { mode: 'postgres', persistent: true, synthetic: false } as const;

  private constructor(private readonly source: PersistenceSource) {}

  static async open(
    config: Extract<StorageConfiguration, { mode: 'postgres' }>,
    factory: SourceFactory = createSource,
  ): Promise<PostgresRepository> {
    let source: PersistenceSource;
    try {
      source = factory(postgresOptions(config));
    } catch {
      throw new Error('Postgres provider kon niet worden gemaakt; geen demo-terugval.');
    }
    try {
      await source.initialize();
    } catch {
      try {
        if (source.isInitialized) await source.destroy();
      } catch {
        throw new Error('Postgres initialisatie en opruimen mislukt; geen demo-terugval.');
      }
      // Driver failures can contain the connection URL; never expose them at startup.
      throw new Error('Postgres initialisatie mislukt; geen demo-terugval. Controleer de configuratie buiten deze API.');
    }
    return new PostgresRepository(source);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.source.isInitialized) await this.source.destroy();
  }

  cities(): Promise<City[]> {
    return this.source.cities.find({ order: { id: 'ASC' } });
  }

  quarters(): Promise<Quarter[]> {
    return this.source.quarters.find({ order: { id: 'ASC' } });
  }

  private async map(rows: ReportRow[]): Promise<Report[]> {
    if (rows.length === 0) return [];
    const [cities, quarters] = await Promise.all([this.cities(), this.quarters()]);
    return rows.map((row) => {
      const city = cities.find((item) => item.id === row.cityId);
      const quarter = row.quarterId === null ? null : quarters.find((item) =>
        item.id === row.quarterId && item.cityId === row.cityId);
      if (!city || quarter === undefined) throw new Error('Postgres bevat ongeldige meldingsrelaties.');
      return {
        id: row.id, cleaned: null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        latLngTuple: [row.latitude, row.longitude], cityId: row.cityId, city: structuredClone(city),
        quarterId: row.quarterId, quarter: structuredClone(quarter),
        locationType: row.locationType, litterType: row.litterType, extra: row.extra,
        dbImageId: null, dbImage: null,
      };
    });
  }

  setReportCleaned(_id: number, _cleaned: boolean): never {
    void _id;
    void _cleaned;
    throw new ForbiddenException('Opruimstatus wijzigen is uitsluitend beschikbaar in synthetische demo-modus.');
  }

  async reports({ cityId = 9000, quarterId }: ReportFilters = {}): Promise<Report[]> {
    // Match the demo's truthy filters and deliberately ignored offset/limit.
    const rows = await this.source.reports.find({
      where: cityId ? { cityId, ...(quarterId ? { quarterId } : {}) } : {},
      order: { id: 'ASC' },
    });
    return this.map(rows);
  }

  async report(id: number): Promise<Report> {
    const row = await this.source.reports.findOneBy({ id });
    if (!row) throw new NotFoundException(`Melding ${id} is niet gevonden.`);
    const [report] = await this.map([row]);
    if (!report) throw new Error('Postgres melding kon niet worden toegewezen.');
    return report;
  }

  async createReport(input: CreateReportDto): Promise<Report> {
    demoWriteBudget.attempt();
    const [cities, quarters] = await Promise.all([this.cities(), this.quarters()]);
    const { city, quarter, coordinates, locationType, litterType, extra } = validateReport(input, cities, quarters, false);
    // Reserve before awaiting: concurrent or uncertain writes must not bypass the process cap.
    demoWriteBudget.reserve(false);
    const repository = this.source.reports;
    const row = repository.create({
      cityId: city.id, quarterId: quarter?.id ?? null,
      latitude: coordinates[0], longitude: coordinates[1], locationType, litterType, extra,
    });
    let saved: ReportRow;
    try {
      saved = await repository.save(row);
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const driver: unknown = error.driverError;
        if (typeof driver === 'object' && driver !== null &&
          'constraint' in driver && typeof driver.constraint === 'string' && 'code' in driver) {
          const known = Object.hasOwn(constraints, driver.constraint) ? constraints[driver.constraint] : undefined;
          if (known && driver.code === known.code) invalidReport(known.message, known.field);
        }
      }
      throw error;
    }
    return {
      id: saved.id, cleaned: null, createdAt: saved.createdAt.toISOString(), updatedAt: saved.updatedAt.toISOString(),
      latLngTuple: [saved.latitude, saved.longitude], cityId: saved.cityId, city,
      quarterId: saved.quarterId, quarter, locationType: saved.locationType,
      litterType: saved.litterType, extra: saved.extra, dbImageId: null, dbImage: null,
    };
  }
}
