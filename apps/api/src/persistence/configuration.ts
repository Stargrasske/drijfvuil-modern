import { DataSource, type DataSourceOptions, type DeepPartial, type Repository } from 'typeorm';
import type { City, Quarter } from '../../../../libs/contracts/src/index.js';
import { CityEntity, QuarterEntity, ReportEntity, type ReportRow } from './entities.js';
import { InitialSchema1792108800000 } from './initial-schema.js';

export type StorageConfiguration = { mode: 'demo' } | { mode: 'postgres'; url: string };

export function storageConfiguration(mode: string | undefined, url?: string): StorageConfiguration {
  if (mode === 'demo') return { mode };
  if (mode !== 'postgres') {
    throw new Error('Kies expliciet DRIJFVUIL_MODE=demo (synthetische gegevens) of DRIJFVUIL_MODE=postgres.');
  }
  const invalid = () => new Error('Postgres vereist een geldige expliciete DRIJFVUIL_DATABASE_URL (postgres:// of postgresql:// met gebruiker, wachtwoord, host en databasenaam).');
  if (!url || url.trim() !== url) throw invalid();
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw invalid(); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname ||
    !parsed.username || !parsed.password || parsed.pathname.length <= 1 || parsed.hash) throw invalid();
  try {
    decodeURIComponent(parsed.username);
    decodeURIComponent(parsed.password);
    decodeURIComponent(parsed.pathname);
  } catch { throw invalid(); }
  // Disallow libpq/driver query overrides (including alternate hosts or TLS weakening).
  if (parsed.search) throw invalid();
  return { mode, url };
}

export function postgresOptions(config: Extract<StorageConfiguration, { mode: 'postgres' }>): DataSourceOptions {
  return {
    type: 'postgres', url: config.url,
    entities: [CityEntity, QuarterEntity, ReportEntity],
    migrations: [InitialSchema1792108800000],
    migrationsTableName: 'drijfvuil_m3_migrations',
    synchronize: false, migrationsRun: false, dropSchema: false,
    migrationsTransactionMode: 'all', logging: false,
    extra: { connectionTimeoutMillis: 5000 },
  };
}

export function migrationOptions(mode: string | undefined, url?: string): DataSourceOptions {
  const config = storageConfiguration(mode, url);
  if (config.mode !== 'postgres') throw new Error('Migraties vereisen DRIJFVUIL_MODE=postgres.');
  return postgresOptions(config);
}

export interface PersistenceSource {
  readonly isInitialized: boolean;
  initialize(): Promise<unknown>;
  destroy(): Promise<void>;
  readonly cities: Pick<Repository<City>, 'find'>;
  readonly quarters: Pick<Repository<Quarter>, 'find'>;
  readonly reports: Pick<Repository<ReportRow>, 'find' | 'findOneBy'> & {
    create(input: DeepPartial<ReportRow>): ReportRow;
    save(input: ReportRow): Promise<ReportRow>;
  };
}

export type SourceFactory = (options: DataSourceOptions) => PersistenceSource;
export const createSource: SourceFactory = (options) => {
  const source = new DataSource(options);
  return {
    get isInitialized() { return source.isInitialized; },
    initialize: () => source.initialize(),
    destroy: () => source.destroy(),
    cities: source.getRepository(CityEntity),
    quarters: source.getRepository(QuarterEntity),
    reports: source.getRepository(ReportEntity),
  };
};
