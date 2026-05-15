import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  RATE_LIMIT_METADATA_KEY,
  type RateLimitProfile,
  SKIP_RATE_LIMIT_METADATA_KEY
} from "./rate-limit.decorator.js";
import { RateLimitService } from "./rate-limit.service.js";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_METADATA_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (skip) {
      return true;
    }

    const profile = this.reflector.getAllAndOverride<RateLimitProfile>(RATE_LIMIT_METADATA_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!profile) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const response = http.getResponse<FastifyReply>();
    const result = await this.rateLimitService.consume(profile, request);

    response.header("X-RateLimit-Limit", String(result.limit));
    response.header("X-RateLimit-Remaining", String(result.remaining));
    response.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt.getTime() / 1000)));

    if (result.exceeded) {
      response.header("Retry-After", String(result.retryAfterSeconds));
      throw new HttpException(result.message, HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}
