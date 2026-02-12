import { z } from "zod";

export const PdfTaskType = z.enum(["merge", "split", "sign", "signature-request"]);
export type PdfTaskType = z.infer<typeof PdfTaskType>;

export const MergePdfPayloadSchema = z.object({
  fileKeys: z.array(z.string()).min(2),
  outputName: z.string().min(1).max(128)
});

export const SplitPdfPayloadSchema = z.object({
  fileKey: z.string(),
  pageRanges: z.array(z.string()).min(1),
  outputPrefix: z.string().min(1).max(128)
});

export const SignPdfPayloadSchema = z.object({
  fileKey: z.string(),
  signatureDataUrl: z.string().startsWith("data:image/"),
  page: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  outputName: z.string().min(1).max(128)
});

export const SignatureRequestPayloadSchema = z.object({
  fileKey: z.string(),
  requesterEmail: z.string().email(),
  signerEmail: z.string().email(),
  message: z.string().max(500).optional()
});

export type MergePdfPayload = z.infer<typeof MergePdfPayloadSchema>;
export type SplitPdfPayload = z.infer<typeof SplitPdfPayloadSchema>;
export type SignPdfPayload = z.infer<typeof SignPdfPayloadSchema>;
export type SignatureRequestPayload = z.infer<typeof SignatureRequestPayloadSchema>;

export type PdfTaskPayload =
  | MergePdfPayload
  | SplitPdfPayload
  | SignPdfPayload
  | SignatureRequestPayload;

export const TaskStatusSchema = z.enum(["queued", "processing", "completed", "failed"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
