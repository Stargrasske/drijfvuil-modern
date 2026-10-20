import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApolloServerPlugin } from '@apollo/server';
import {
  Body, type CanActivate, Controller, type ExecutionContext, ForbiddenException, Get,
  HttpCode, HttpException, Inject, Injectable, Post, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { DemoAccount, DemoSession } from '../../../libs/contracts/src/index.js';
import { REPORT_REPOSITORY, type ReportRepository } from './repository.js';
import { localDemoConfiguration } from '../../../libs/runtime/src/local-ports.js';

const COOKIE = 'drijfvuil_demo';
export const SESSION_MS = 30 * 60_000;
export const LOGIN_LIMIT = 5;
export const SESSION_LIMIT = 20;
const fixtures = [
  {
    id: 'demo-water', name: 'Demo Water', login: 'water@demo.invalid',
    salt: '24e8826b1f5168c136e31463d9e89efe',
    hash: '58a1ec1d1f6ba0b3ae0b9a345850ff42c4e490493365f134116b77d221597b4cb037dece3aaca98040146696c0ea723e622437fad71f50edca6bb7a3e4782b62',
  },
  {
    id: 'demo-oever', name: 'Demo Oever', login: 'oever@demo.invalid',
    salt: 'b2a236173a96628a661ef6dbca587381',
    hash: '7c02f6c5bee8ad578bc430402e02c027f64f73a4edd4b24df265dd389f053511810a69ad0081203a8553041db40d9b4faef1db97b633dfd9a3781aef7cb48e5a',
  },
] as const;

export async function verifyDemoPassword(login: string, password: string): Promise<DemoAccount | null> {
  const account = fixtures.find((fixture) => fixture.login === login);
  const reference = account ?? fixtures[0];
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, reference.salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, value) => error ? reject(error) : resolve(value));
  });
  const matches = timingSafeEqual(derived, Buffer.from(reference.hash, 'hex'));
  return account && matches ? { id: account.id, name: account.name } : null;
}

type Session = { account: DemoAccount; expiresAt: number };

export class DemoAuthState {
  private readonly sessions = new Map<string, Session>();
  private attempts: number[] = [];
  private verifying = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  private prune() {
    const now = this.now();
    this.attempts = this.attempts.filter((time) => time > now - 60_000);
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }

  async login(body: unknown, oldToken?: string): Promise<{ token: string; session: DemoSession }> {
    this.prune();
    if (this.attempts.length >= LOGIN_LIMIT || this.verifying >= 2) {
      throw new HttpException('Demolimiet: wacht een minuut en probeer zelf opnieuw.', 429);
    }
    this.attempts.push(this.now());
    const input = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    if (typeof input.login !== 'string' || input.login.length > 80 ||
      typeof input.password !== 'string' || input.password.length > 128) {
      throw new UnauthorizedException('Aanmelden mislukt. Controleer de demogegevens.');
    }
    this.verifying++;
    let account: DemoAccount | null;
    try {
      account = await verifyDemoPassword(input.login, input.password);
    } finally {
      this.verifying--;
    }
    if (!account) throw new UnauthorizedException('Aanmelden mislukt. Controleer de demogegevens.');
    this.prune();
    if (this.sessions.size >= SESSION_LIMIT && (!oldToken || !this.sessions.has(oldToken))) {
      throw new HttpException('Alle demosessieplaatsen zijn bezet. Wacht tot een sessie verloopt.', 429);
    }
    if (oldToken) this.sessions.delete(oldToken);
    const token = randomBytes(32).toString('hex');
    const expiresAt = this.now() + SESSION_MS;
    this.sessions.set(token, { account, expiresAt });
    return { token, session: { account: { ...account }, expiresAt: new Date(expiresAt).toISOString() } };
  }

  session(token?: string): DemoSession | null {
    this.prune();
    const value = token ? this.sessions.get(token) : undefined;
    return value ? { account: { ...value.account }, expiresAt: new Date(value.expiresAt).toISOString() } : null;
  }

  logout(token?: string) {
    this.prune();
    if (token) this.sessions.delete(token);
  }
}

// All Nest application/provider instances share the same bounded process state.
const processState = new DemoAuthState();

export const authHttpStatusPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async willSendResponse({ response }) {
        if (response.body.kind !== 'single') return;
        const errors = response.body.singleResult.errors;
        if (errors?.some((error) => error.extensions?.code === 'UNAUTHENTICATED')) response.http.status = 401;
        else if (errors?.some((error) => error.extensions?.code === 'FORBIDDEN')) response.http.status = 403;
      },
    };
  },
};

export function sessionToken(request?: IncomingMessage): string | undefined {
  const values = (request?.headers.cookie ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return undefined;
  const token = values[0]!.slice(COOKIE.length + 1);
  return /^[0-9a-f]{64}$/.test(token) ? token : undefined;
}

export function requireDemoOrigin(request: IncomingMessage) {
  const { allowedOrigins } = localDemoConfiguration(process.env);
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !allowedOrigins.has(origin) ||
    request.headers.host !== new URL(origin).host ||
    (request.headers['sec-fetch-site'] !== undefined && request.headers['sec-fetch-site'] !== 'same-origin')) {
    throw new ForbiddenException('Alleen dezelfde lokale demo-oorsprong is toegestaan.');
  }
}

function cookie(response: ServerResponse, expiresAt?: string, token = '') {
  // Intentionally HTTP for loopback demos only; this transport is NOT production-safe.
  response.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expiresAt ? 1800 : 0}; Expires=${expiresAt ? new Date(expiresAt).toUTCString() : 'Thu, 01 Jan 1970 00:00:00 GMT'}`);
}

@Injectable()
export class DemoAuth {
  constructor(@Inject(REPORT_REPOSITORY) private readonly repository: ReportRepository) {}

  enabled() {
    if (this.repository.storage.mode !== 'demo') {
      throw new ForbiddenException('Aanmelden is uitsluitend beschikbaar in synthetische demo-modus.');
    }
  }

  session(request?: IncomingMessage) {
    this.enabled();
    return processState.session(sessionToken(request));
  }

  login(body: unknown, request: IncomingMessage) {
    this.enabled();
    requireDemoOrigin(request);
    return processState.login(body, sessionToken(request));
  }

  logout(request: IncomingMessage) {
    this.enabled();
    requireDemoOrigin(request);
    processState.logout(sessionToken(request));
  }
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(DemoAuth) private readonly auth: DemoAuth) {}

  @Get('session')
  session(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    const session = this.auth.session(request);
    if (!session) cookie(response);
    return { session };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    const result = await this.auth.login(body, request);
    cookie(response, result.session.expiresAt, result.token);
    return { session: result.session };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    this.auth.logout(request);
    cookie(response);
    return { session: null };
  }
}

@Injectable()
export class DemoAccountGuard implements CanActivate {
  constructor(@Inject(DemoAuth) private readonly auth: DemoAuth) {}

  canActivate(context: ExecutionContext) {
    const request = GqlExecutionContext.create(context).getContext<{ req?: IncomingMessage }>()?.req;
    this.auth.enabled();
    if (!this.auth.session(request)) {
      throw new UnauthorizedException('Je demosessie is verlopen of je bent niet aangemeld.');
    }
    return true;
  }
}
