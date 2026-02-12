import { z } from "zod";

const EnvSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  SEAWEED_S3_ENDPOINT: z.string().url(),
  SEAWEED_S3_REGION: z.string().min(1),
  SEAWEED_S3_BUCKET: z.string().min(1),
  SEAWEED_S3_ACCESS_KEY: z.string().min(1),
  SEAWEED_S3_SECRET_KEY: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().email(),
  SIGN_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  QPDF_BIN: z.string().default("qpdf")
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
