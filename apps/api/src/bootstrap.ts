import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { storageConfiguration, type SourceFactory } from './persistence/configuration.js';
import { localDemoConfiguration } from '../../../libs/runtime/src/local-ports.js';

export async function createApplication(mode: string | undefined, url?: string, factory?: SourceFactory) {
  const config = storageConfiguration(mode, url);
  const app = await NestFactory.create(AppModule.storage(config, factory), {
    logger: ['error', 'warn'], abortOnError: false,
  });
  app.enableShutdownHooks();
  return app;
}

export async function createDemoApplication(mode: string | undefined) {
  if (mode !== 'demo') {
    throw new Error('Deze demo-start ondersteunt alleen synthetische demo-data. Stel DRIJFVUIL_MODE=demo expliciet in.');
  }
  return createApplication(mode);
}

export async function startApplication() {
  const { apiPort } = localDemoConfiguration(process.env);
  const app = await createApplication(process.env.DRIJFVUIL_MODE, process.env.DRIJFVUIL_DATABASE_URL);
  try {
    await app.listen(apiPort, '127.0.0.1');
    return app;
  } catch (cause) {
    await app.close();
    throw cause;
  }
}
