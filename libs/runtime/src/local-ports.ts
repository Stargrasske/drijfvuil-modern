export class LocalPortConfigurationError extends Error {}

export function localDemoConfiguration(environment: Readonly<Record<string, string | undefined>>) {
  function port(name: string, fallback: number) {
    const value = environment[name];
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535 || String(parsed) !== value) {
      throw new LocalPortConfigurationError(`${name} moet een geheel decimaal poortnummer van 1 tot en met 65535 zijn, zonder spaties of voorloopnullen.`);
    }
    return parsed;
  }
  const apiPort = port('DRIJFVUIL_API_PORT', 3333);
  const webPort = port('DRIJFVUIL_WEB_PORT', 4200);
  if (apiPort === webPort) {
    throw new LocalPortConfigurationError('DRIJFVUIL_API_PORT en DRIJFVUIL_WEB_PORT moeten verschillend zijn.');
  }
  return {
    apiPort,
    webPort,
    apiTarget: new URL(`http://127.0.0.1:${apiPort}`).origin,
    allowedOrigins: new Set([apiPort, webPort].flatMap((value) =>
      ['127.0.0.1', 'localhost'].map((host) => new URL(`http://${host}:${value}`).origin))),
  };
}
