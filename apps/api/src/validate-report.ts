import { GraphQLError } from 'graphql';
import {
  EXTRA_MAX_LENGTH, LITTER_MAX_LENGTH,
  type City, type Quarter, type CreateReportDto,
} from '../../../libs/contracts/src/index.js';

export function invalidReport(message: string, field: string): never {
  throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT', field } });
}

export function validateReport(input: CreateReportDto, cities: City[], quarters: Quarter[], demo: boolean) {
  const coordinates = input.latLngTuple;
  if (!Array.isArray(coordinates) || coordinates.length !== 2 ||
    !Number.isFinite(coordinates[0]) || Math.abs(coordinates[0]) > 90 ||
    !Number.isFinite(coordinates[1]) || Math.abs(coordinates[1]) > 180) {
    invalidReport('Coördinaten moeten precies twee eindige getallen zijn: breedtegraad -90–90, lengtegraad -180–180.', 'latLngTuple');
  }
  const cityId = input.cityId === undefined ? 9000 : input.cityId;
  const city = cities.find((item) => item.id === cityId) ?? invalidReport('Kies een bekende stad.', 'cityId');
  const quarter = input.quarterId == null ? null :
    quarters.find((item) => item.id === input.quarterId && item.cityId === city.id) ??
    invalidReport('Kies een bekende wijk die bij de stad hoort.', 'quarterId');
  const locationType = input.locationType ?? 'water';
  if (locationType !== 'water' && locationType !== 'land') invalidReport('Locatie moet water of land zijn.', 'locationType');
  if (input.extra != null && input.extra.length > EXTRA_MAX_LENGTH) {
    invalidReport('Extra informatie mag maximaal 364 tekens bevatten.', 'extra');
  }
  const litterType = input.litterType?.trim() ?? null;
  if (litterType !== null && (litterType.length === 0 ||
    (input.litterType?.length ?? 0) > LITTER_MAX_LENGTH)) {
    invalidReport('Afvalsoort moet 1 tot 80 tekens bevatten wanneer opgegeven.', 'litterType');
  }
  if (!demo && input.dbImageId != null && input.dbImageId !== '') {
    invalidReport('Foto’s worden nog niet ondersteund.', 'dbImageId');
  }
  return { city, quarter, coordinates, locationType, litterType, extra: input.extra ?? null };
}
