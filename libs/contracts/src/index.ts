export interface City {
  id: number;
  name: string;
}

export interface DemoAccount {
  id: string;
  name: string;
}

export interface DemoSession {
  account: DemoAccount;
  expiresAt: string;
}

export const DEMO_ACCOUNT_QUERY = 'query DemoAccount { demoAccount { id name } }';

export interface Quarter {
  id: number;
  cityId: number;
  quarter: string;
}

export interface DbImage {
  id: string;
  key: string;
  url: string;
}

export interface Report {
  id: number;
  cleaned: boolean | null;
  createdAt: string;
  updatedAt: string;
  latLngTuple: [number, number];
  cityId: number;
  city: City;
  quarterId: number | null;
  quarter: Quarter | null;
  dbImageId: string | null;
  dbImage: DbImage | null;
  extra: string | null;
  locationType: string;
  litterType: string | null;
}

export interface ReportFilters {
  cityId?: number | null;
  quarterId?: number | null;
  offset?: number | null;
  limit?: number | null;
}

export type StorageMetadata =
  | { mode: 'demo'; persistent: false; synthetic: true }
  | { mode: 'postgres'; persistent: true; synthetic: false };

export interface ExplorerData {
  storage: StorageMetadata;
  reports: Report[];
  cities: City[];
  quarters: Quarter[];
}

export interface CreateReportDto {
  latLngTuple: [number, number];
  cityId?: number | null;
  quarterId?: number | null;
  locationType?: string | null;
  litterType?: string | null;
  extra?: string | null;
  dbImageId?: string | null;
}

export const EXTRA_MAX_LENGTH = 364;
export const LITTER_MAX_LENGTH = 80;

export const CREATE_REPORT_MUTATION = `
  mutation CreateDemoReport($createReportInput: CreateReportDto!) {
    createReport(createReportInput: $createReportInput) {
      id cleaned createdAt updatedAt latLngTuple cityId quarterId
      locationType litterType extra dbImageId
      dbImage { id key url }
      city { id name }
      quarter { id cityId quarter }
    }
  }
`;

export const EXPLORER_QUERY = `
  query ReportExplorer($cityId: Int, $quarterId: Int) {
    reports(cityId: $cityId, quarterId: $quarterId) {
      id cleaned createdAt updatedAt latLngTuple cityId quarterId
      locationType litterType extra dbImageId
      dbImage { id key url }
      city { id name }
      quarter { id cityId quarter }
    }
    cities { id name }
    quarters { id cityId quarter }
    storage { mode persistent synthetic }
  }
`;

export const REPORT_SCHEMA = `
  scalar DateTime
  type City { id: Int!, name: String! }
  type Quarter { id: Int!, cityId: Int!, quarter: String! }
  type DbImage { id: String!, key: String!, url: String! }
  type StorageMetadata { mode: String!, persistent: Boolean!, synthetic: Boolean! }
  type Report {
    id: Int!
    cleaned: Boolean
    createdAt: DateTime!
    updatedAt: DateTime!
    latLngTuple: [Float!]!
    cityId: Int!
    city: City!
    quarterId: Int
    quarter: Quarter
    dbImageId: String
    dbImage: DbImage
    extra: String
    locationType: String!
    litterType: String
  }
  type Query {
    demoAccount: DemoAccount!
    storage: StorageMetadata!
    reports(offset: Int = 0, limit: Int = 30, cityId: Int = 9000, quarterId: Int): [Report!]!
    report(id: Int!): Report!
    cities: [City!]!
    quarters: [Quarter!]!
  }
  type DemoAccount { id: String!, name: String! }
  input CreateReportDto {
    latLngTuple: [Float!]!
    cityId: Int = 9000
    quarterId: Int
    locationType: String = "water"
    litterType: String
    extra: String
    dbImageId: String
  }
  type Mutation {
    createReport(createReportInput: CreateReportDto!): Report!
    setReportCleaned(id: Int!, cleaned: Boolean!): Report!
  }
`;

export const REPORT_QUERY = `
  query DemoReportStatus($id: Int!) {
    report(id: $id) {
      id cleaned createdAt updatedAt latLngTuple cityId quarterId
      locationType litterType extra dbImageId
      dbImage { id key url }
      city { id name }
      quarter { id cityId quarter }
    }
  }
`;

export const SET_REPORT_CLEANED_MUTATION = `
  mutation SetDemoReportCleaned($id: Int!, $cleaned: Boolean!) {
    setReportCleaned(id: $id, cleaned: $cleaned) {
      id cleaned createdAt updatedAt latLngTuple cityId quarterId
      locationType litterType extra dbImageId
      dbImage { id key url }
      city { id name }
      quarter { id cityId quarter }
    }
  }
`;
