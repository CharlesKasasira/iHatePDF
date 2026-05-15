import { Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Redis } from "ioredis";
import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import type { RateLimitProfile } from "./rate-limit.decorator.js";

type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  maxRetriesPerRequest: null;
};

type RateLimitScope = "ip" | "actor" | "email" | "resetToken";

type RateLimitPolicy = {
  limit: number;
  windowSeconds: number;
  scopes: RateLimitScope[];
  message: string;
};

export type RateLimitResult = {
  exceeded: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
  message: string;
};

const RATE_LIMIT_POLICIES: Record<RateLimitProfile, RateLimitPolicy> = {
  login: {
    limit: env.RATE_LIMIT_LOGIN_MAX,
    windowSeconds: env.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
    scopes: ["ip", "email"],
    message: "Too many login attempts. Try again later."
  },
  signup: {
    limit: env.RATE_LIMIT_SIGNUP_MAX,
    windowSeconds: env.RATE_LIMIT_SIGNUP_WINDOW_SECONDS,
    scopes: ["ip", "email"],
    message: "Too many signup attempts. Try again later."
  },
  passwordReset: {
    limit: env.RATE_LIMIT_PASSWORD_RESET_MAX,
    windowSeconds: env.RATE_LIMIT_PASSWORD_RESET_WINDOW_SECONDS,
    scopes: ["ip", "email", "resetToken"],
    message: "Too many password reset attempts. Try again later."
  },
  uploads: {
    limit: env.RATE_LIMIT_UPLOAD_MAX,
    windowSeconds: env.RATE_LIMIT_UPLOAD_WINDOW_SECONDS,
    scopes: ["actor", "ip"],
    message: "Too many uploads. Try again later."
  },
  taskQueue: {
    limit: env.RATE_LIMIT_TASK_QUEUE_MAX,
    windowSeconds: env.RATE_LIMIT_TASK_QUEUE_WINDOW_SECONDS,
    scopes: ["actor", "ip"],
    message: "Too many queued tasks. Try again later."
  }
};

const LUA_INCREMENT_WITH_TTL = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

function redisConnectionOptions(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null
  };
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizeToken(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
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

function clientIp(request: FastifyRequest): string {
  const forwardedFor = firstHeaderValue(request.headers["x-forwarded-for"]);
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",");
    if (firstIp?.trim()) {
      return firstIp.trim();
    }
  }

  return (
    firstHeaderValue(request.headers["cf-connecting-ip"]) ??
    firstHeaderValue(request.headers["x-real-ip"]) ??
    request.ip ??
    "unknown"
  );
}

function actorIdentifier(request: FastifyRequest): string {
  const apiKey = firstHeaderValue(request.headers["x-api-key"]);
  if (apiKey?.trim()) {
    return `api-key:${hashIdentifier(apiKey.trim())}`;
  }

  const authorization = request.headers.authorization;
  if (authorization?.trim()) {
    return `authorization:${hashIdentifier(authorization.trim())}`;
  }

  const sessionToken = parseCookieHeader(request.headers.cookie, env.AUTH_SESSION_COOKIE);
  if (sessionToken) {
    return `session:${hashIdentifier(sessionToken)}`;
  }

  return `ip:${hashIdentifier(clientIp(request))}`;
}

function requestBody(request: FastifyRequest): Record<string, unknown> {
  return request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private redis: Redis | null = null;

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis(redisConnectionOptions(env.REDIS_URL));
    }

    return this.redis;
  }

  async consume(profile: RateLimitProfile, request: FastifyRequest): Promise<RateLimitResult> {
    const policy = RATE_LIMIT_POLICIES[profile];
    const windowMs = policy.windowSeconds * 1000;
    const keys = this.keysForPolicy(profile, policy, request);

    try {
      const attempts = await Promise.all(keys.map((key) => this.increment(key, windowMs)));
      const remaining = Math.max(0, Math.min(...attempts.map((attempt) => policy.limit - attempt.count)));
      const exceededAttempts = attempts.filter((attempt) => attempt.count > policy.limit);
      const ttlMs = Math.max(...attempts.map((attempt) => attempt.ttlMs), 0);
      const exceededTtlMs = Math.max(...exceededAttempts.map((attempt) => attempt.ttlMs), 0);

      return {
        exceeded: exceededAttempts.length > 0,
        limit: policy.limit,
        remaining,
        resetAt: new Date(Date.now() + ttlMs),
        retryAfterSeconds: Math.max(1, Math.ceil((exceededTtlMs || ttlMs) / 1000)),
        message: policy.message
      };
    } catch (error) {
      throw new ServiceUnavailableException("Rate limiting is temporarily unavailable.");
    }
  }

  private keysForPolicy(profile: RateLimitProfile, policy: RateLimitPolicy, request: FastifyRequest): string[] {
    const body = requestBody(request);
    const keys = new Set<string>();

    for (const scope of policy.scopes) {
      const identifier = this.identifierForScope(scope, request, body);
      if (identifier) {
        keys.add(`rate-limit:${profile}:${scope}:${identifier}`);
      }
    }

    if (keys.size === 0) {
      keys.add(`rate-limit:${profile}:ip:${hashIdentifier(clientIp(request))}`);
    }

    return [...keys];
  }

  private identifierForScope(
    scope: RateLimitScope,
    request: FastifyRequest,
    body: Record<string, unknown>
  ): string | null {
    switch (scope) {
      case "ip":
        return hashIdentifier(clientIp(request));
      case "actor":
        return actorIdentifier(request);
      case "email": {
        const email = normalizeEmail(body.email);
        return email ? hashIdentifier(email) : null;
      }
      case "resetToken": {
        const token = normalizeToken(body.token);
        return token ? hashIdentifier(token) : null;
      }
    }
  }

  private async increment(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
    const result = await this.getRedis().eval(LUA_INCREMENT_WITH_TTL, 1, key, String(windowMs));

    if (!Array.isArray(result)) {
      throw new Error("Unexpected rate limit response.");
    }

    return {
      count: Number(result[0]),
      ttlMs: Number(result[1])
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
