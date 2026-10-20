import { EntitySchema } from 'typeorm';
import type { City, Quarter } from '../../../../libs/contracts/src/index.js';

export interface ReportRow {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  latitude: number;
  longitude: number;
  cityId: number;
  quarterId: number | null;
  locationType: string;
  litterType: string | null;
  extra: string | null;
}

export const CityEntity = new EntitySchema<City>({
  name: 'City', schema: 'drijfvuil_m3', tableName: 'city',
  columns: { id: { type: 'integer', primary: true }, name: { type: 'text' } },
});

export const QuarterEntity = new EntitySchema<Quarter>({
  name: 'Quarter', schema: 'drijfvuil_m3', tableName: 'quarter',
  columns: {
    id: { type: 'integer', primary: true },
    cityId: { name: 'city_id', type: 'integer' },
    quarter: { type: 'text' },
  },
});

export const ReportEntity = new EntitySchema<ReportRow>({
  name: 'Report', schema: 'drijfvuil_m3', tableName: 'report',
  columns: {
    id: { type: 'integer', primary: true, generated: 'increment' },
    createdAt: { name: 'created_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' },
    updatedAt: { name: 'updated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' },
    latitude: { type: 'double precision' },
    longitude: { type: 'double precision' },
    cityId: { name: 'city_id', type: 'integer' },
    quarterId: { name: 'quarter_id', type: 'integer', nullable: true },
    locationType: { name: 'location_type', type: 'text' },
    litterType: { name: 'litter_type', type: 'text', nullable: true },
    extra: { type: 'text', nullable: true },
  },
});
