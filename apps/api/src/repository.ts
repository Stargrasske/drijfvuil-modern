import type {
  City, Quarter, Report, ReportFilters, CreateReportDto, StorageMetadata,
} from '../../../libs/contracts/src/index.js';

type Result<T> = T | Promise<T>;
export const REPORT_REPOSITORY = Symbol('REPORT_REPOSITORY');

export interface ReportRepository {
  readonly storage: StorageMetadata;
  cities(): Result<City[]>;
  quarters(): Result<Quarter[]>;
  reports(filters?: ReportFilters): Result<Report[]>;
  report(id: number): Result<Report>;
  createReport(input: CreateReportDto): Result<Report>;
  setReportCleaned(id: number, cleaned: boolean): Result<Report>;
}
