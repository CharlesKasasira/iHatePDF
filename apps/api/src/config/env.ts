import { z } from "zod";

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
  MAIL_FROM: z.string().email(),
  SIGN_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  QPDF_BIN: z.string().default("qpdf")
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
