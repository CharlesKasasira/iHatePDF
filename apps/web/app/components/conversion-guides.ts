type ConversionGuide = {
  bestFor: string;
  bestAvoidedFor: string;
  qualityExpectation: string;
  scannedDocumentGuidance: string;
  digitalPdfGuidance: string;
  estimateOutputSize: (file: File) => string;
  previewMode?: "pdf" | "source";
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function estimateRange(minRatio: number, maxRatio: number): (file: File) => string {
  return (file) => {
    const min = Math.max(1, Math.round(file.size * minRatio));
    const max = Math.max(min, Math.round(file.size * maxRatio));
    return `${formatBytes(min)} to ${formatBytes(max)}`;
  };
}

export const pdfToWordGuide: ConversionGuide = {
  bestFor: "Digital PDFs with selectable text and simple layouts.",
  bestAvoidedFor: "Scanned PDFs, complex tables, multi-column brochures, and heavily designed forms.",
  qualityExpectation: "Text and basic structure usually transfer well; exact fonts, spacing, and page breaks may need cleanup.",
  digitalPdfGuidance: "Digital PDFs are the best input because text can be extracted directly.",
  scannedDocumentGuidance: "Scanned documents need OCR first; otherwise the DOCX may contain images instead of editable text.",
  estimateOutputSize: estimateRange(0.35, 1.1),
  previewMode: "pdf"
};

export const pdfToExcelGuide: ConversionGuide = {
  bestFor: "Digital PDFs with clear tables, invoices, statements, and repeated row structures.",
  bestAvoidedFor: "Scanned tables, merged cells, rotated tables, and decorative reports.",
  qualityExpectation: "Clean tables convert best; users should review formulas, merged cells, and totals after export.",
  digitalPdfGuidance: "Digital PDFs with selectable table text give the strongest workbook result.",
  scannedDocumentGuidance: "Scanned tables require OCR and may still need manual column correction.",
  estimateOutputSize: estimateRange(0.2, 0.9),
  previewMode: "pdf"
};

export const pdfToPowerPointGuide: ConversionGuide = {
  bestFor: "Slide-like PDFs, reports that should become editable decks, and page-per-slide handouts.",
  bestAvoidedFor: "Long text documents where Word is a better editing target.",
  qualityExpectation: "Pages are converted into a deck structure; fine-grained editability depends on how the source PDF was built.",
  digitalPdfGuidance: "Digital PDFs usually preserve text and vector elements better.",
  scannedDocumentGuidance: "Scanned PDFs behave like image slides unless OCR/vector reconstruction is done first.",
  estimateOutputSize: estimateRange(0.7, 1.8),
  previewMode: "pdf"
};

export const pdfToJpgGuide: ConversionGuide = {
  bestFor: "Visual previews, thumbnails, sharing page images, and scanned PDFs.",
  bestAvoidedFor: "Workflows that need selectable text or editable Office output.",
  qualityExpectation: "This is a raster export, so text becomes pixels; zoom quality depends on render resolution.",
  digitalPdfGuidance: "Digital PDFs render cleanly, but the output is no longer searchable text.",
  scannedDocumentGuidance: "Scanned PDFs are a natural fit because they are already image-based.",
  estimateOutputSize: estimateRange(0.6, 2.4),
  previewMode: "pdf"
};

export const wordToPdfGuide: ConversionGuide = {
  bestFor: "DOCX files with standard fonts, normal page layouts, and document-style content.",
  bestAvoidedFor: "Documents relying on unavailable fonts, macros, or external linked objects.",
  qualityExpectation: "PDF output should be close to the source; font substitution can change line wrapping.",
  digitalPdfGuidance: "The output PDF is best for distribution and retention, not for future editing.",
  scannedDocumentGuidance: "Scanned content embedded in Word remains image-based in the PDF.",
  estimateOutputSize: estimateRange(0.7, 1.6),
  previewMode: "source"
};

export const excelToPdfGuide: ConversionGuide = {
  bestFor: "Spreadsheets with print areas, reports, and sheets intended for distribution.",
  bestAvoidedFor: "Large workbooks without print settings or sheets wider than a page.",
  qualityExpectation: "Page breaks and scaling follow workbook print settings where available; wide sheets may shrink.",
  digitalPdfGuidance: "The output PDF is ideal for review, approval, and archiving.",
  scannedDocumentGuidance: "Images inside cells remain images; spreadsheet text remains crisp when exported.",
  estimateOutputSize: estimateRange(0.5, 1.4),
  previewMode: "source"
};

export const powerpointToPdfGuide: ConversionGuide = {
  bestFor: "Presentation decks, handouts, and slide archives.",
  bestAvoidedFor: "Decks with missing fonts, unsupported animations, or embedded media that must remain interactive.",
  qualityExpectation: "Static slide appearance should be preserved; animations and videos become non-interactive.",
  digitalPdfGuidance: "The PDF is best for sharing a fixed version of the deck.",
  scannedDocumentGuidance: "Image-heavy slides stay visual and can increase output size.",
  estimateOutputSize: estimateRange(0.6, 1.7),
  previewMode: "source"
};
