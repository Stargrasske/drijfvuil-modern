import { GraphQLError } from 'graphql';

const WINDOW_MS = 60_000;

class DemoWriteBudget {
  constructor(private readonly limit = 5) {}
  private attempts: number[] = [];
  private additions = 0;

  attempt() {
    const now = Date.now();
    this.attempts = this.attempts.filter((time) => time > now - WINDOW_MS);
    if (this.attempts.length >= this.limit) {
      const retryAfterMs = Math.max(1, (this.attempts[0] ?? now) + WINDOW_MS - now);
      throw new GraphQLError('Te veel pogingen. Probeer later opnieuw.', {
        extensions: {
          code: 'DEMO_RATE_LIMIT',
          retryAfterMs,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        },
      });
    }
    this.attempts.push(now);
  }

  reserve(demo = true) {
    if (this.additions >= 100) {
      throw new GraphQLError(demo
        ? 'De demo is vol: maximaal 100 nieuwe meldingen per proces.'
        : 'De proceslimiet is bereikt: maximaal 100 nieuwe meldingen per proces.', {
        extensions: { code: 'DEMO_CAPACITY' },
      });
    }
    this.additions += 1;
  }
}

// Shared by every Nest app/repository in this process; never reset by a request.
export const demoWriteBudget = new DemoWriteBudget();
// Separate budget: cleanup never consumes anonymous creation attempts or capacity.
export const demoCleanupBudget = new DemoWriteBudget(20);
