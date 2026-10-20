import { startApplication } from './bootstrap.js';
import { LocalPortConfigurationError } from '../../../libs/runtime/src/local-ports.js';

async function main() {
  const app = await startApplication();
  console.info(`Drijfvuil API: ${await app.getUrl()}/graphql (${process.env.DRIJFVUIL_MODE})`);
}

main().catch((cause: unknown) => {
  if (cause instanceof LocalPortConfigurationError) console.error(cause.message);
  else if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EADDRINUSE') {
    console.error('De ingestelde API-poort is bezet; geen automatische poortkeuze of terugval.');
  } else console.error('Drijfvuil API kon niet starten. Controleer modus en configuratie; geen automatische terugval.');
  process.exitCode = 1;
});
