import { BadRequestException, Injectable } from "@nestjs/common";
import type { FileObject } from "@prisma/client";
import { inflateRawSync, inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { StorageService } from "../storage/storage.service.js";

export type PdfEntity = {
  value: string;
  count: number;
};

export type PdfIntelligenceResponse = {
  fileId: string;
  fileName: string;
  sizeBytes: string;
  pageCount: number;
  compression: {
    estimatedSavingsPercent: number;
    estimatedOutputBytes: string;
    confidence: "low" | "medium" | "high";
    reason: string;
  };
  text: {
    lineCount: number;
    characterCount: number;
    sampleLines: string[];
    ocrRecommended: boolean;
    ocrReason: string;
  };
  summary: string[];
  entities: {
    emails: PdfEntity[];
    dates: PdfEntity[];
    names: PdfEntity[];
    invoiceTotals: PdfEntity[];
  };
  detection: {
    imageCount: number;
    scannedLikely: boolean;
    encrypted: boolean;
    hasAcroForm: boolean;
    hasSignatureFields: boolean;
    hasDigitalSignatures: boolean;
    hasLikelyHandwrittenSignature: boolean;
    hasRedactionRisk: boolean;
  };
  fileRisks: Array<{
    level: "info" | "warning" | "critical";
    label: string;
    detail: string;
  }>;
  suggestedActions: Array<{
    action: "ocr" | "compress" | "sign" | "protect" | "redact" | "search" | "organize" | "convert";
    label: string;
    reason: string;
  }>;
  recommendedWorkflow: string[];
  redactionCandidates: Array<{
    kind: "email" | "date" | "invoice-total";
    value: string;
  }>;
};

function decodePdfStringToken(token: string): string {
  if (token.startsWith("<")) {
    const hex = token.replace(/[<>\s]/g, "");
    if (hex.length === 0 || hex.length % 2 !== 0) {
      return "";
    }

    const bytes = Buffer.from(hex, "hex");
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return bytes.toString("utf16le").replace(/\u0000/g, "");
    }
    return bytes.toString("latin1");
  }

  const body = token.slice(1, -1);
  return body
    .replace(/\\([nrtbf()\\])/g, (_match, value: string) => {
      const escaped: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "(": "(",
        ")": ")",
        "\\": "\\"
      };
      return escaped[value] ?? value;
    })
    .replace(/\\(\d{1,3})/g, (_match, value: string) => String.fromCharCode(Number.parseInt(value, 8)));
}

function trimTrailingLineBreaks(input: Buffer): Buffer {
  let start = 0;
  let end = input.length;

  while (start < end && (input[start] === 0x0a || input[start] === 0x0d)) {
    start += 1;
  }
  while (end > start && (input[end - 1] === 0x0a || input[end - 1] === 0x0d)) {
    end -= 1;
  }

  return input.subarray(start, end);
}

function decodePdfStream(dictionary: string, rawStream: Buffer): Buffer | null {
  const stream = trimTrailingLineBreaks(rawStream);
  if (!dictionary.includes("/Filter")) {
    return stream;
  }

  if (dictionary.includes("/FlateDecode")) {
    try {
      return inflateSync(stream);
    } catch {
      try {
        return inflateRawSync(stream);
      } catch {
        return null;
      }
    }
  }

  return stream;
}

function extractStreamText(content: string): string[] {
  const fragments: string[] = [];
  const textBlocks = content.match(/BT[\s\S]*?ET/g) ?? [];
  const sources = textBlocks.length > 0 ? textBlocks : [content];
  const directTokenRegex = /(\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>)\s*(?:Tj|['"])/g;
  const arrayTokenRegex = /\[((?:\\.|[\s\S])*?)\]\s*TJ/g;
  const stringTokenRegex = /\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>/g;

  for (const source of sources) {
    directTokenRegex.lastIndex = 0;
    arrayTokenRegex.lastIndex = 0;
    let directMatch: RegExpExecArray | null = directTokenRegex.exec(source);
    while (directMatch) {
      fragments.push(decodePdfStringToken(directMatch[1]));
      directMatch = directTokenRegex.exec(source);
    }

    let arrayMatch: RegExpExecArray | null = arrayTokenRegex.exec(source);
    while (arrayMatch) {
      stringTokenRegex.lastIndex = 0;
      let tokenMatch: RegExpExecArray | null = stringTokenRegex.exec(arrayMatch[1]);
      while (tokenMatch) {
        fragments.push(decodePdfStringToken(tokenMatch[0]));
        tokenMatch = stringTokenRegex.exec(arrayMatch[1]);
      }
      arrayMatch = arrayTokenRegex.exec(source);
    }
  }

  return fragments;
}

function uniqueCleanText(values: string[], limit = 800): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const normalized = raw
      .replace(/\s+/g, " ")
      .replace(/[^\x09\x20-\x7e]+/g, "")
      .trim();

    if (!normalized || normalized.length < 2 || !/[a-zA-Z0-9]/.test(normalized)) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) {
      break;
    }
  }

  return output;
}

function extractPdfTextLines(input: Buffer): string[] {
  const source = input.toString("latin1");
  const objectRegex = /\b\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
  const fragments: string[] = [];

  let objectMatch: RegExpExecArray | null = objectRegex.exec(source);
  while (objectMatch) {
    const body = objectMatch[1];
    const streamIndex = body.indexOf("stream");
    const endstreamIndex = streamIndex === -1 ? -1 : body.indexOf("endstream", streamIndex + 6);

    if (streamIndex !== -1 && endstreamIndex !== -1) {
      let streamStart = streamIndex + 6;
      if (body[streamStart] === "\r" && body[streamStart + 1] === "\n") {
        streamStart += 2;
      } else if (body[streamStart] === "\n" || body[streamStart] === "\r") {
        streamStart += 1;
      }

      const dictionary = body.slice(0, streamIndex);
      const rawStream = Buffer.from(body.slice(streamStart, endstreamIndex), "latin1");
      const decoded = decodePdfStream(dictionary, rawStream);
      if (decoded) {
        fragments.push(...extractStreamText(decoded.toString("latin1")));
      }
    }

    objectMatch = objectRegex.exec(source);
  }

  const extracted = uniqueCleanText(fragments);
  if (extracted.length > 0) {
    return extracted;
  }

  const fallback = source.match(/[a-zA-Z0-9][a-zA-Z0-9 .,;:()_/\-]{5,}/g) ?? [];
  return uniqueCleanText(fallback);
}

function rankedEntities(values: string[], limit = 12): PdfEntity[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function buildSummary(lines: string[]): string[] {
  const candidates = lines
    .filter((line) => line.length >= 32 && line.length <= 220)
    .filter((line) => /[.!?:]|\b(total|invoice|agreement|summary|amount|date|customer|supplier)\b/i.test(line));

  return uniqueCleanText(candidates, 5);
}

function analyzeTextEntities(text: string): PdfIntelligenceResponse["entities"] {
  const emails = Array.from(text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)).map((match) => match[0]);
  const dates = Array.from(
    text.matchAll(
      /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi
    )
  ).map((match) => match[0]);
  const invoiceTotals = Array.from(
    text.matchAll(/\b(?:total|amount due|balance due|grand total|invoice total)\s*[:\-]?\s*(?:USD|UGX|EUR|GBP|\$)?\s*[\d,]+(?:\.\d{2})?\b/gi)
  ).map((match) => match[0]);
  const names = Array.from(text.matchAll(/\b(?:name|customer|client|supplier|vendor|prepared by|signed by)\s*[:\-]\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})\b/g)).map(
    (match) => match[1]
  );

  return {
    emails: rankedEntities(emails),
    dates: rankedEntities(dates),
    names: rankedEntities(names),
    invoiceTotals: rankedEntities(invoiceTotals)
  };
}

function estimateCompression({
  sizeBytes,
  pageCount,
  imageCount,
  ocrRecommended
}: {
  sizeBytes: bigint;
  pageCount: number;
  imageCount: number;
  ocrRecommended: boolean;
}): PdfIntelligenceResponse["compression"] {
  const size = Number(sizeBytes);
  const imageDensity = pageCount > 0 ? imageCount / pageCount : 0;
  let estimatedSavingsPercent = 12;
  let confidence: PdfIntelligenceResponse["compression"]["confidence"] = "low";
  let reason = "Text-forward PDFs usually compress modestly.";

  if (size > 20_000_000 || imageDensity >= 2) {
    estimatedSavingsPercent = 45;
    confidence = "high";
    reason = "The PDF appears image-heavy or large, so image recompression should help.";
  } else if (size > 6_000_000 || imageDensity >= 0.75 || ocrRecommended) {
    estimatedSavingsPercent = 28;
    confidence = "medium";
    reason = "The PDF has enough image or scan signals to expect useful compression.";
  } else if (size < 750_000) {
    estimatedSavingsPercent = 8;
    reason = "The file is already small, so compression gains may be limited.";
  }

  const estimatedOutputBytes = Math.max(1, Math.round(size * (1 - estimatedSavingsPercent / 100)));

  return {
    estimatedSavingsPercent,
    estimatedOutputBytes: String(estimatedOutputBytes),
    confidence,
    reason
  };
}

function buildFileRisks({
  encrypted,
  hasRedactionRisk,
  ocrRecommended,
  hasDigitalSignatures,
  sizeBytes
}: {
  encrypted: boolean;
  hasRedactionRisk: boolean;
  ocrRecommended: boolean;
  hasDigitalSignatures: boolean;
  sizeBytes: bigint;
}): PdfIntelligenceResponse["fileRisks"] {
  const risks: PdfIntelligenceResponse["fileRisks"] = [];

  if (encrypted) {
    risks.push({
      level: "warning",
      label: "Encrypted PDF",
      detail: "Some inspection, editing, or conversion steps may fail without the document password."
    });
  }

  if (hasDigitalSignatures) {
    risks.push({
      level: "warning",
      label: "Digital signature markers",
      detail: "Editing this file may invalidate existing digital signature evidence."
    });
  }

  if (hasRedactionRisk) {
    risks.push({
      level: "critical",
      label: "Sensitive text found",
      detail: "Use true redaction for emails, totals, or dates. Visual cover boxes are not safe redaction."
    });
  }

  if (ocrRecommended) {
    risks.push({
      level: "info",
      label: "Scanned or image-heavy",
      detail: "Run OCR before search, text extraction, or text-based redaction."
    });
  }

  if (sizeBytes > 25_000_000n) {
    risks.push({
      level: "info",
      label: "Large file",
      detail: "Compression can improve sharing, previews, and workflow speed."
    });
  }

  return risks;
}

function buildSuggestedActions({
  ocrRecommended,
  estimatedSavingsPercent,
  hasSignatureFields,
  hasLikelyHandwrittenSignature,
  hasRedactionRisk,
  hasAcroForm,
  pageCount
}: {
  ocrRecommended: boolean;
  estimatedSavingsPercent: number;
  hasSignatureFields: boolean;
  hasLikelyHandwrittenSignature: boolean;
  hasRedactionRisk: boolean;
  hasAcroForm: boolean;
  pageCount: number;
}): PdfIntelligenceResponse["suggestedActions"] {
  const actions: PdfIntelligenceResponse["suggestedActions"] = [];

  if (ocrRecommended) {
    actions.push({ action: "ocr", label: "Run OCR", reason: "Make scanned pages searchable before editing or redaction." });
  } else {
    actions.push({ action: "search", label: "Search text", reason: "Embedded text is available for inspection." });
  }

  if (estimatedSavingsPercent >= 20) {
    actions.push({ action: "compress", label: "Compress", reason: `Estimated size reduction is about ${estimatedSavingsPercent}%.` });
  }

  if (hasSignatureFields || hasLikelyHandwrittenSignature) {
    actions.push({ action: "sign", label: "Prepare signing", reason: "Signature signals were detected in the document." });
  }

  if (hasRedactionRisk) {
    actions.push({ action: "redact", label: "Review redaction", reason: "Potential sensitive values were found." });
  }

  if (hasAcroForm) {
    actions.push({ action: "protect", label: "Protect after edits", reason: "Form-like PDFs often need controlled distribution after completion." });
  }

  if (pageCount > 8) {
    actions.push({ action: "organize", label: "Organize pages", reason: "Longer PDFs benefit from page review before sharing." });
  }

  return actions.slice(0, 6);
}

function buildRecommendedWorkflow(actions: PdfIntelligenceResponse["suggestedActions"]): string[] {
  const workflow = actions.map((action) => action.label);
  if (!workflow.includes("Protect after edits")) {
    workflow.push("Export");
  }
  return workflow.slice(0, 5);
}

@Injectable()
export class PdfIntelligenceService {
  constructor(private readonly storageService: StorageService) {}

  async inspect(file: FileObject): Promise<PdfIntelligenceResponse> {
    if (file.mimeType !== "application/pdf") {
      throw new BadRequestException("Document intelligence is only available for PDF files.");
    }

    let buffer: Buffer;
    let pageCount: number;

    try {
      buffer = await this.storageService.readObjectBuffer(file.objectKey);
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      pageCount = pdf.getPageCount();
    } catch {
      throw new BadRequestException("Unable to inspect PDF intelligence.");
    }

    const rawPdf = buffer.toString("latin1");
    const lines = extractPdfTextLines(buffer);
    const fullText = lines.join("\n");
    const entities = analyzeTextEntities(fullText);
    const characterCount = fullText.length;
    const ocrRecommended = characterCount < Math.max(80, pageCount * 40);
    const hasAcroForm = rawPdf.includes("/AcroForm") || rawPdf.includes("/Subtype/Widget") || rawPdf.includes("/Subtype /Widget");
    const hasSignatureFields = /\/FT\s*\/Sig|\/T\s*\([^)]*(?:sign|signature|initial)[^)]*\)/i.test(rawPdf);
    const hasDigitalSignatures = rawPdf.includes("/ByteRange") || rawPdf.includes("/DocMDP");
    const hasLikelyHandwrittenSignature = /\b(signature|signed by|initials|authorized signatory)\b/i.test(fullText);
    const hasRedactionRisk = entities.emails.length > 0 || entities.invoiceTotals.length > 0;
    const imageCount = (rawPdf.match(/\/Subtype\s*\/Image\b/g) ?? []).length;
    const encrypted = rawPdf.includes("/Encrypt");
    const scannedLikely = ocrRecommended && imageCount >= pageCount;
    const compression = estimateCompression({
      sizeBytes: file.sizeBytes,
      pageCount,
      imageCount,
      ocrRecommended
    });
    const fileRisks = buildFileRisks({
      encrypted,
      hasRedactionRisk,
      ocrRecommended,
      hasDigitalSignatures,
      sizeBytes: file.sizeBytes
    });
    const suggestedActions = buildSuggestedActions({
      ocrRecommended,
      estimatedSavingsPercent: compression.estimatedSavingsPercent,
      hasSignatureFields,
      hasLikelyHandwrittenSignature,
      hasRedactionRisk,
      hasAcroForm,
      pageCount
    });

    return {
      fileId: file.id,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes.toString(),
      pageCount,
      compression,
      text: {
        lineCount: lines.length,
        characterCount,
        sampleLines: lines.slice(0, 30),
        ocrRecommended,
        ocrReason: ocrRecommended
          ? "Very little embedded text was found. This is likely scanned or image-heavy, so OCR is recommended before search and redaction."
          : "Embedded text was found and can be searched without OCR."
      },
      summary: buildSummary(lines),
      entities,
      detection: {
        imageCount,
        scannedLikely,
        encrypted,
        hasAcroForm,
        hasSignatureFields,
        hasDigitalSignatures,
        hasLikelyHandwrittenSignature,
        hasRedactionRisk
      },
      fileRisks,
      suggestedActions,
      recommendedWorkflow: buildRecommendedWorkflow(suggestedActions),
      redactionCandidates: [
        ...entities.emails.map((entity) => ({ kind: "email" as const, value: entity.value })),
        ...entities.dates.slice(0, 8).map((entity) => ({ kind: "date" as const, value: entity.value })),
        ...entities.invoiceTotals.map((entity) => ({ kind: "invoice-total" as const, value: entity.value }))
      ].slice(0, 24)
    };
  }
}
