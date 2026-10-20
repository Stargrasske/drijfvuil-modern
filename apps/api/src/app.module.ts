import 'reflect-metadata';
import { Module, type DynamicModule } from '@nestjs/common';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { GraphQLScalarType, Kind } from 'graphql';
import { REPORT_SCHEMA } from '../../../libs/contracts/src/index.js';
import { DemoRepository } from './demo-repository.js';
import { ReportsResolver } from './reports.resolver.js';
import { REPORT_REPOSITORY } from './repository.js';
import type { SourceFactory, StorageConfiguration } from './persistence/configuration.js';
import { PostgresRepository } from './persistence/postgres-repository.js';
import { DemoImages, FilesController, ImageUploadInterceptor } from './demo-images.js';
import { AuthController, DemoAuth, DemoAccountGuard, authHttpStatusPlugin } from './demo-auth.js';

function dateTime(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('DateTime vereist een geldige ISO-datum.');
  }
  return new Date(value).toISOString();
}

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typeDefs: REPORT_SCHEMA,
      path: '/graphql',
      playground: false,
      context: ({ req }: { req: unknown }) => ({ req }),
      plugins: [authHttpStatusPlugin],
      // Nest otherwise resets resolver execution failures to HTTP 200 after our auth plugin.
      preserveHttpStatusForExecutionErrors: false,
      resolvers: {
        DateTime: new GraphQLScalarType({
          name: 'DateTime',
          serialize: dateTime,
          parseValue: dateTime,
          parseLiteral(node) {
            if (node.kind !== Kind.STRING) throw new TypeError('DateTime vereist een string.');
            return dateTime(node.value);
          },
        }),
      },
    }),
  ],
  controllers: [FilesController, AuthController],
  providers: [ReportsResolver, DemoImages, ImageUploadInterceptor, DemoAuth, DemoAccountGuard],
})
export class AppModule {
  static storage(config: StorageConfiguration, factory?: SourceFactory): DynamicModule {
    return {
      module: AppModule,
      providers: config.mode === 'demo'
        ? [DemoRepository, { provide: REPORT_REPOSITORY, useExisting: DemoRepository }]
        : [{
        provide: REPORT_REPOSITORY,
        useFactory: () => PostgresRepository.open(config, factory),
      }],
    };
  }
}
