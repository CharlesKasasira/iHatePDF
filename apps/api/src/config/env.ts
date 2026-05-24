import { z } from "zod";

const BooleanFlagSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const EnvSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  APP_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  STORAGE_DIR: z.string().default("../../storage"),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().min(1),
  SIGN_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),
  FILE_SHARE_TTL_HOURS: z.coerce.number().int().positive().default(72),
  AUTH_SESSION_COOKIE: z.string().min(1).default("ihatepdf_session"),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  CLEANUP_ENABLED: BooleanFlagSchema.default(true),
  CLEANUP_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  CLEANUP_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(100),
  CLEANUP_WORKFLOW_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  USER_STORAGE_QUOTA_MB: z.coerce.number().int().positive().default(1024),
  ANTIVIRUS_ENABLED: BooleanFlagSchema.default(true),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  RATE_LIMIT_SIGNUP_MAX: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_SIGNUP_WINDOW_SECONDS: z.coerce.number().int().positive().default(60 * 60),
  RATE_LIMIT_PASSWORD_RESET_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_PASSWORD_RESET_WINDOW_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_UPLOAD_WINDOW_SECONDS: z.coerce.number().int().positive().default(60 * 60),
  RATE_LIMIT_TASK_QUEUE_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_TASK_QUEUE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60 * 60),
  RATE_LIMIT_SHARE_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_SHARE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60 * 60),
  QPDF_BIN: z.string().default("qpdf"),
  PDFTOPPM_BIN: z.string().default("pdftoppm"),
  PDF_RENDER_DPI: z.coerce.number().int().min(72).max(300).default(144)
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
