import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  UnauthorizedException
} from "@nestjs/common";
import type { User } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_PREFIX = "scrypt";
const SESSION_TOKEN_BYTES = 32;
const RESET_TOKEN_BYTES = 32;
const API_KEY_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 64;
const SESSION_LAST_USED_THROTTLE_MS = 10 * 60 * 1000;
const API_KEY_PREFIX = "ihp";
const DEFAULT_ADMIN_EMAIL = "ckasasira@renu.ac.ug";
const DEFAULT_ADMIN_PASSWORD = "password123#";
const DEFAULT_ADMIN_NAME = "Default Admin";

export type SafeUser = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  createdAt: Date;
};

export type ApiKeyPrincipal = {
  apiKeyId: string;
  user: SafeUser;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeOptionalString(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseCookieHeader(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const segment of header.split(";")) {
    const [rawKey, ...rawValue] = segment.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createOpaqueToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

function extractApiKey(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization) {
    const [scheme, value] = authorization.split(/\s+/, 2);
    if (value && ["bearer", "apikey"].includes(scheme.toLowerCase())) {
      return value.trim();
    }
  }

  const headerValue = request.headers["x-api-key"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }

  return null;
}

function safeUser(user: Pick<User, "id" | "email" | "name" | "isAdmin" | "createdAt">): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt
  };
}

function sessionCookie(value: string, maxAgeSeconds: number): string {
  const parts = [
    `${env.AUTH_SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (env.API_PUBLIC_URL.startsWith("https://") || env.APP_BASE_URL.startsWith("https://")) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaultAdminAccount();
  }

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(PASSWORD_SALT_BYTES).toString("base64url");
    const derived = (await scrypt(password, salt, PASSWORD_HASH_BYTES)) as Buffer;
    return `${PASSWORD_HASH_PREFIX}$${salt}$${derived.toString("base64url")}`;
  }

  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [prefix, salt, encodedHash] = storedHash.split("$");
    if (prefix !== PASSWORD_HASH_PREFIX || !salt || !encodedHash) {
      return false;
    }

    const expected = Buffer.from(encodedHash, "base64url");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private setSessionCookie(reply: FastifyReply, token: string): void {
    const maxAgeSeconds = env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60;
    reply.header("Set-Cookie", sessionCookie(token, maxAgeSeconds));
  }

  clearSessionCookie(reply: FastifyReply): void {
    reply.header("Set-Cookie", sessionCookie("", 0));
  }

  getSessionToken(request: FastifyRequest): string | null {
    return parseCookieHeader(request.headers.cookie, env.AUTH_SESSION_COOKIE);
  }

  async currentSessionUser(request: FastifyRequest): Promise<SafeUser | null> {
    const token = this.getSessionToken(request);
    if (!token) {
      return null;
    }

    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true }
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    if (!session.lastUsedAt || session.lastUsedAt.getTime() <= Date.now() - SESSION_LAST_USED_THROTTLE_MS) {
      await this.prisma.userSession
        .update({
          where: { id: session.id },
          data: { lastUsedAt: new Date() }
        })
        .catch(() => undefined);
    }

    return safeUser(session.user);
  }

  async currentApiKeyPrincipal(request: FastifyRequest): Promise<ApiKeyPrincipal | null> {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return null;
    }

    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashToken(apiKey) },
      include: { owner: true }
    });

    if (!record || record.revokedAt || (record.expiresAt && record.expiresAt.getTime() <= Date.now())) {
      return null;
    }

    await this.prisma.apiKey
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() }
      })
      .catch(() => undefined);

    return {
      apiKeyId: record.id,
      user: safeUser(record.owner)
    };
  }

  async currentUser(request: FastifyRequest): Promise<SafeUser | null> {
    return (await this.currentSessionUser(request)) ?? (await this.currentApiKeyPrincipal(request))?.user ?? null;
  }

  async requireUser(request: FastifyRequest): Promise<SafeUser> {
    const user = await this.currentUser(request);
    if (!user) {
      throw new UnauthorizedException("Sign in to continue.");
    }

    return user;
  }

  async requireSessionUser(request: FastifyRequest): Promise<SafeUser> {
    const user = await this.currentSessionUser(request);
    if (!user) {
      throw new UnauthorizedException("Sign in to continue.");
    }

    return user;
  }

  async requireAdminUser(request: FastifyRequest): Promise<SafeUser> {
    const user = await this.requireSessionUser(request);
    if (!user.isAdmin) {
      throw new ForbiddenException("Admin access is required.");
    }

    return user;
  }

  async requireApiKey(request: FastifyRequest): Promise<ApiKeyPrincipal> {
    const principal = await this.currentApiKeyPrincipal(request);
    if (!principal) {
      throw new UnauthorizedException("Provide a valid API key in the Authorization: Bearer or X-API-Key header.");
    }

    return principal;
  }

  async createApiKey(
    request: FastifyRequest,
    input: { name: string; expiresAt?: string }
  ): Promise<{
    id: string;
    name: string;
    key: string;
    keyPrefix: string;
    expiresAt: Date | null;
    createdAt: Date;
  }> {
    const user = await this.requireSessionUser(request);
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException("API key name is required.");
    }

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
      throw new BadRequestException("API key expiration must be a future date.");
    }

    const key = `${API_KEY_PREFIX}_${createOpaqueToken(API_KEY_BYTES)}`;
    const created = await this.prisma.apiKey.create({
      data: {
        ownerId: user.id,
        name,
        keyPrefix: key.slice(0, 12),
        keyHash: hashToken(key),
        expiresAt
      }
    });

    return {
      id: created.id,
      name: created.name,
      key,
      keyPrefix: created.keyPrefix,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt
    };
  }

  async listApiKeys(request: FastifyRequest): Promise<Array<{
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }>> {
    const user = await this.requireSessionUser(request);
    return this.prisma.apiKey.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true
      }
    });
  }

  async revokeApiKey(request: FastifyRequest, id: string): Promise<{ ok: true }> {
    const user = await this.requireSessionUser(request);
    await this.prisma.apiKey.updateMany({
      where: {
        id,
        ownerId: user.id,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    return { ok: true };
  }

  async signup(input: { email: string; password: string; name?: string }, reply: FastifyReply): Promise<SafeUser> {
    const email = normalizeEmail(input.email);
    if (input.password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters.");
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("An account already exists for this email.");
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name: normalizeOptionalString(input.name),
        passwordHash: await this.hashPassword(input.password)
      }
    });

    await this.createSession(user.id, reply);
    return safeUser(user);
  }

  async login(input: { email: string; password: string }, reply: FastifyReply): Promise<SafeUser> {
    const email = normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await this.verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    await this.createSession(user.id, reply);
    return safeUser(user);
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<{ ok: true }> {
    const token = this.getSessionToken(request);
    if (token) {
      await this.prisma.userSession
        .updateMany({
          where: {
            tokenHash: hashToken(token),
            revokedAt: null
          },
          data: {
            revokedAt: new Date()
          }
        })
        .catch(() => undefined);
    }

    this.clearSessionCookie(reply);
    return { ok: true };
  }

  async createSession(userId: string, reply: FastifyReply): Promise<void> {
    const token = createOpaqueToken(SESSION_TOKEN_BYTES);
    await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
      }
    });

    this.setSessionCookie(reply, token);
  }

  private async ensureDefaultAdminAccount(): Promise<void> {
    const email = normalizeEmail(DEFAULT_ADMIN_EMAIL);
    const passwordHash = await this.hashPassword(DEFAULT_ADMIN_PASSWORD);

    await this.prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: DEFAULT_ADMIN_NAME,
        passwordHash,
        isAdmin: true
      },
      update: {
        name: DEFAULT_ADMIN_NAME,
        passwordHash,
        isAdmin: true
      }
    });
  }

  async requestPasswordReset(emailValue: string): Promise<{ ok: true }> {
    const email = normalizeEmail(emailValue);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { ok: true };
    }

    const token = createOpaqueToken(RESET_TOKEN_BYTES);
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000)
      }
    });

    await this.mailService.sendPasswordResetMail({
      to: user.email,
      name: user.name ?? undefined,
      resetLink: `${env.APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`,
      expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES
    });

    return { ok: true };
  }

  async confirmPasswordReset(input: { token: string; password: string }): Promise<{ ok: true }> {
    if (input.password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters.");
    }

    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(input.token) }
    });

    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Password reset link is invalid or expired.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash: await this.hashPassword(input.password) }
      });
      await tx.passwordResetToken.update({
        where: { id: reset.id },
        data: { usedAt: new Date() }
      });
      await tx.userSession.updateMany({
        where: {
          userId: reset.userId,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
    });

    return { ok: true };
  }
}
