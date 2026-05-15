import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_METADATA_KEY = "ihatepdf:rate-limit";
export const SKIP_RATE_LIMIT_METADATA_KEY = "ihatepdf:skip-rate-limit";

export type RateLimitProfile = "login" | "signup" | "passwordReset" | "uploads" | "taskQueue";

export function RateLimit(profile: RateLimitProfile): MethodDecorator & ClassDecorator {
  return SetMetadata(RATE_LIMIT_METADATA_KEY, profile);
}

export function SkipRateLimit(): MethodDecorator & ClassDecorator {
  return SetMetadata(SKIP_RATE_LIMIT_METADATA_KEY, true);
}
