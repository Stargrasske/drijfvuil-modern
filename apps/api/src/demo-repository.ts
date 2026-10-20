import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import {
  type City, type CreateReportDto, type Quarter, type Report, type ReportFilters,
} from '../../../libs/contracts/src/index.js';
import { demoCleanupBudget, demoWriteBudget } from './demo-write-budget.js';
import type { ReportRepository } from './repository.js';
import { invalidReport, validateReport } from './validate-report.js';
import { DemoImages } from './demo-images.js';

const CITIES: City[] = [
  { id: 9000, name: 'Gent' },
  { id: 9050, name: 'Gentbrugge' },
];

const QUARTERS: Quarter[] = [
  { id: 1, cityId: 9000, quarter: 'Binnenstad' },
  { id: 2, cityId: 9000, quarter: 'Muide' },
  { id: 3, cityId: 9050, quarter: 'Gentbrugge centrum' },
];

function fixture(
  id: number,
  city: City,
  quarter: Quarter,
  latLngTuple: [number, number],
  litterType: string,
  locationType: string,
  extra: string,
): Report {
  return {
    id, cleaned: false, city, quarter, latLngTuple, litterType, locationType, extra,
    cityId: city.id,
    quarterId: quarter.id,
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    dbImageId: null,
    dbImage: null,
  };
}

const gent: City = { id: 9000, name: 'Gent' };
const gentbrugge: City = { id: 9050, name: 'Gentbrugge' };
const binnenstad: Quarter = { id: 1, cityId: 9000, quarter: 'Binnenstad' };
const muide: Quarter = { id: 2, cityId: 9000, quarter: 'Muide' };
const centrum: Quarter = { id: 3, cityId: 9050, quarter: 'Gentbrugge centrum' };

const REPORTS = [
  fixture(1, gent, binnenstad, [51.0543, 3.7206], 'Plastic', 'water', 'Enkele plastic flessen aan de waterkant.'),
  fixture(2, gent, binnenstad, [51.0484, 3.7265], 'Verpakking', 'land', 'Verpakkingen naast het wandelpad.'),
  fixture(3, gent, muide, [51.0734, 3.7301], 'Plastic', 'water', 'Een zak met klein plastic afval.'),
  fixture(4, gentbrugge, centrum, [51.0347, 3.7578], 'Gemengd afval', 'land', 'Afval langs de oever.'),
];

@Injectable()
export class DemoRepository implements ReportRepository {
  constructor(@Inject(DemoImages) private readonly images: DemoImages = new DemoImages()) {}
  readonly storage = { mode: 'demo', persistent: false, synthetic: true } as const;
  private readonly storedReports = structuredClone(REPORTS);

  cities(): City[] {
    return structuredClone(CITIES);
  }

  quarters(): Quarter[] {
    return structuredClone(QUARTERS);
  }

  reports({ cityId = 9000, quarterId }: ReportFilters = {}): Report[] {
    // Legacy offset/limit are deliberately ignored until a versioned contract change.
    return structuredClone(this.storedReports.filter((report) =>
      (!cityId || report.cityId === cityId) &&
      (!cityId || !quarterId || report.quarterId === quarterId),
    ));
  }

  report(id: number): Report {
    const report = this.storedReports.find((item) => item.id === id);
    if (!report) throw new NotFoundException(`Melding ${id} is niet gevonden.`);
    return structuredClone(report);
  }

  createReport(input: CreateReportDto): Report {
    demoWriteBudget.attempt();
    const { city, quarter, coordinates, locationType, litterType, extra } = validateReport(input, CITIES, QUARTERS, true);
    let image = null;
    if (input.dbImageId) {
      try { image = this.images.get(input.dbImageId).metadata; }
      catch { invalidReport('Onbekende demo-foto. Upload de foto opnieuw na een herstart.', 'dbImageId'); }
    }
    demoWriteBudget.reserve();
    const now = new Date().toISOString();
    const report: Report = {
      id: (this.storedReports.at(-1)?.id ?? 0) + 1,
      createdAt: now, updatedAt: now, cleaned: false,
      latLngTuple: [coordinates[0], coordinates[1]],
      cityId: city.id, city, quarterId: quarter?.id ?? null, quarter,
      locationType, litterType, extra,
      dbImageId: image?.id ?? null, dbImage: image,
    };
    this.storedReports.push(structuredClone(report));
    return structuredClone(report);
  }

  setReportCleaned(id: number, cleaned: boolean): Report {
    demoCleanupBudget.attempt();
    if (!Number.isInteger(id) || id <= 0 || typeof cleaned !== 'boolean') {
      invalidReport('Geef een positief meldingnummer en een expliciete opruimstatus op.', 'id');
    }
    const report = this.storedReports.find((item) => item.id === id);
    if (!report) throw new GraphQLError(`Melding ${id} is niet gevonden.`, { extensions: { code: 'NOT_FOUND' } });
    if (report.cleaned !== cleaned) {
      report.cleaned = cleaned;
      report.updatedAt = new Date().toISOString();
    }
    return structuredClone(report);
  }
}
