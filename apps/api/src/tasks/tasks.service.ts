import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TaskType } from "@prisma/client";
import { type PdfTaskJobName, QueueService } from "../queue/queue.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import {
  CompressPdfDto,
  ConvertPdfDto,
  EditPdfDto,
  EditImageDto,
  EditPageNumbersDto,
  EditPageRotationDto,
  EditRectangleDto,
  EditTextDto,
  EditWatermarkDto,
  ExtractPagesDto,
  JpgToPdfDto,
  MergePdfDto,
  OrganizePdfDto,
  ProtectPdfDto,
  RemovePagesDto,
  SignPdfDto,
  SplitPdfDto,
  UnlockPdfDto
} from "./dto.js";

interface MergeJobPayload {
  taskId: string;
  fileKeys: string[];
  outputName: string;
}

interface JpgToPdfJobPayload {
  taskId: string;
  fileKeys: string[];
  outputName: string;
}

interface SplitJobPayload {
  taskId: string;
  fileKey: string;
  pageRanges: string[];
  outputPrefix: string;
}

interface RemovePagesJobPayload {
  taskId: string;
  fileKey: string;
  pageRanges: string[];
  outputName: string;
}

interface ExtractPagesJobPayload {
  taskId: string;
  fileKey: string;
  pageRanges: string[];
  outputName: string;
}

interface OrganizePdfJobPayload {
  taskId: string;
  fileKey: string;
  pageOrder: number[];
  outputName: string;
}

interface SignJobPayload {
  taskId: string;
  fileKey: string;
  signatureDataUrl: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  outputName: string;
}

interface CompressJobPayload {
  taskId: string;
  fileKey: string;
  outputName: string;
}

interface ProtectJobPayload {
  taskId: string;
  fileKey: string;
  password: string;
  outputName: string;
}

interface UnlockJobPayload {
  taskId: string;
  fileKey: string;
  password: string;
  outputName: string;
}

interface ConvertJobPayload {
  taskId: string;
  fileKey: string;
  outputName: string;
}

interface EditJobPayload {
  taskId: string;
  fileKey: string;
  textEdits: EditTextDto[];
  rectangleEdits: EditRectangleDto[];
  imageEdits: EditImageDto[];
  pageRotations: EditPageRotationDto[];
  pageNumbers?: EditPageNumbersDto;
  watermark?: EditWatermarkDto;
  outputName: string;
  expiresAtIso?: string;
}

const PDF_MIME_TYPES = ["application/pdf"] as const;
const JPEG_MIME_TYPES = ["image/jpeg", "image/jpg"] as const;
const WORD_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
] as const;
const EXCEL_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
] as const;
const POWERPOINT_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
] as const;

export type TaskRequestContext = {
  ownerId?: string;
};

export interface TaskStatusView {
  id: string;
  status: string;
  type: string;
  progressPercent: number;
  progressMessage: string | null;
  errorMessage: string | null;
  outputDownloadUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storageService: StorageService
  ) {}

  private async requireInputFile(
    fileId: string,
    allowedMimeTypes?: readonly string[],
    expectedFileTypeLabel = "a supported file format",
    context: TaskRequestContext = {}
  ): Promise<{ id: string; objectKey: string; mimeType: string; ownerId: string | null }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundException("Input file was not found.");
    }

    if (file.ownerId && file.ownerId !== context.ownerId) {
      throw new NotFoundException("Input file was not found.");
    }

    if (allowedMimeTypes && !allowedMimeTypes.includes(file.mimeType)) {
      throw new BadRequestException(
        `Unsupported input file type "${file.mimeType}". Expected ${expectedFileTypeLabel}.`
      );
    }

    return file;
  }

  private async createTaskAndEnqueue<TPayload>(input: {
    type: TaskType;
    inputFileId?: string;
    ownerId?: string;
    payload: Prisma.InputJsonValue;
    jobName: PdfTaskJobName;
    buildJobPayload: (taskId: string) => TPayload;
  }): Promise<{ taskId: string }> {
    const task = await this.prisma.task.create({
      data: {
        type: input.type,
        status: "queued",
        inputFileId: input.inputFileId,
        ownerId: input.ownerId ?? null,
        payload: input.payload
      }
    });

    try {
      await this.queueService.enqueue(input.jobName, input.buildJobPayload(task.id));
      return { taskId: task.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to queue task.";

      await this.prisma.task
        .update({
          where: { id: task.id },
          data: {
            status: "failed",
            errorMessage: message,
            progressMessage: message
          }
        })
        .catch(() => undefined);

      throw error;
    }
  }

  async queueMerge(dto: MergePdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    if (dto.fileIds.length < 2) {
      throw new BadRequestException("Merge requires at least two files.");
    }

    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: dto.fileIds } }
    });

    if (files.length !== dto.fileIds.length) {
      throw new NotFoundException("One or more input files were not found.");
    }

    const fileMap = new Map(files.map((file) => [file.id, file]));
    const fileKeys = dto.fileIds.map((id) => {
      const item = fileMap.get(id);
      if (!item) {
        throw new NotFoundException(`Input file ${id} not found.`);
      }
      if (item.ownerId && item.ownerId !== context.ownerId) {
        throw new NotFoundException(`Input file ${id} not found.`);
      }
      if (item.mimeType !== "application/pdf") {
        throw new BadRequestException("Merge requires PDF input files.");
      }
      return item.objectKey;
    });

    return this.createTaskAndEnqueue({
      type: TaskType.merge,
      ownerId: context.ownerId,
      payload: {
        fileKeys,
        outputName: dto.outputName
      },
      jobName: "merge",
      buildJobPayload: (taskId): MergeJobPayload => ({
        taskId,
        fileKeys,
        outputName: dto.outputName
      })
    });
  }

  async queueJpgToPdf(dto: JpgToPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    if (dto.fileIds.length === 0) {
      throw new BadRequestException("JPG to PDF requires at least one image.");
    }

    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: dto.fileIds } }
    });

    if (files.length !== dto.fileIds.length) {
      throw new NotFoundException("One or more input images were not found.");
    }

    const fileMap = new Map(files.map((file) => [file.id, file]));
    const fileKeys = dto.fileIds.map((id) => {
      const item = fileMap.get(id);
      if (!item) {
        throw new NotFoundException(`Input image ${id} not found.`);
      }
      if (item.ownerId && item.ownerId !== context.ownerId) {
        throw new NotFoundException(`Input image ${id} not found.`);
      }
      if (!JPEG_MIME_TYPES.includes(item.mimeType as (typeof JPEG_MIME_TYPES)[number])) {
        throw new BadRequestException("JPG to PDF requires JPG or JPEG input files.");
      }
      return item.objectKey;
    });

    return this.createTaskAndEnqueue({
      type: TaskType.jpg_to_pdf,
      ownerId: context.ownerId,
      payload: {
        fileKeys,
        outputName: dto.outputName
      },
      jobName: "jpg-to-pdf",
      buildJobPayload: (taskId): JpgToPdfJobPayload => ({
        taskId,
        fileKeys,
        outputName: dto.outputName
      })
    });
  }

  async queueSplit(dto: SplitPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.split,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        pageRanges: dto.pageRanges,
        outputPrefix: dto.outputPrefix
      },
      jobName: "split",
      buildJobPayload: (taskId): SplitJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        pageRanges: dto.pageRanges,
        outputPrefix: dto.outputPrefix
      })
    });
  }

  async queueRemovePages(dto: RemovePagesDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.remove_pages,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        pageRanges: dto.pageRanges,
        outputName: dto.outputName
      },
      jobName: "remove-pages",
      buildJobPayload: (taskId): RemovePagesJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        pageRanges: dto.pageRanges,
        outputName: dto.outputName
      })
    });
  }

  async queueExtractPages(dto: ExtractPagesDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.extract_pages,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        pageRanges: dto.pageRanges,
        outputName: dto.outputName
      },
      jobName: "extract-pages",
      buildJobPayload: (taskId): ExtractPagesJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        pageRanges: dto.pageRanges,
        outputName: dto.outputName
      })
    });
  }

  async queueOrganizePdf(dto: OrganizePdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.organize_pdf,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName,
        pageOrderLength: dto.pageOrder.length
      },
      jobName: "organize-pdf",
      buildJobPayload: (taskId): OrganizePdfJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        pageOrder: dto.pageOrder,
        outputName: dto.outputName
      })
    });
  }

  async queueSign(dto: SignPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.sign,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        signatureDataUrl: dto.signatureDataUrl,
        page: dto.page,
        x: dto.x,
        y: dto.y,
        width: dto.width,
        height: dto.height,
        outputName: dto.outputName
      },
      jobName: "sign",
      buildJobPayload: (taskId): SignJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        signatureDataUrl: dto.signatureDataUrl,
        page: dto.page,
        x: dto.x,
        y: dto.y,
        width: dto.width,
        height: dto.height,
        outputName: dto.outputName
      })
    });
  }

  async queueCompress(dto: CompressPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.compress,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName
      },
      jobName: "compress",
      buildJobPayload: (taskId): CompressJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        outputName: dto.outputName
      })
    });
  }

  async queueProtect(dto: ProtectPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    const password = dto.password.trim();
    if (!password) {
      throw new BadRequestException("Password is required.");
    }

    return this.createTaskAndEnqueue({
      type: TaskType.protect,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName,
        passwordProvided: true
      },
      jobName: "protect",
      buildJobPayload: (taskId): ProtectJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        password,
        outputName: dto.outputName
      })
    });
  }

  async queueUnlock(dto: UnlockPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    const password = dto.password.trim();
    if (!password) {
      throw new BadRequestException("Password is required.");
    }

    return this.createTaskAndEnqueue({
      type: TaskType.unlock,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName,
        passwordProvided: true
      },
      jobName: "unlock",
      buildJobPayload: (taskId): UnlockJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        password,
        outputName: dto.outputName
      })
    });
  }

  async queuePdfToWord(dto: ConvertPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.pdf_to_word,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName
      },
      jobName: "pdf-to-word",
      buildJobPayload: (taskId): ConvertJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        outputName: dto.outputName
      })
    });
  }

  async queuePdfToJpg(dto: ConvertPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.pdf_to_jpg,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName
      },
      jobName: "pdf-to-jpg",
      buildJobPayload: (taskId): ConvertJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        outputName: dto.outputName
      })
    });
  }

  async queuePdfToPowerpoint(dto: ConvertPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.pdf_to_powerpoint,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName
      },
      jobName: "pdf-to-powerpoint",
      buildJobPayload: (taskId): ConvertJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        outputName: dto.outputName
      })
    });
  }

  async queuePdfToExcel(dto: ConvertPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    return this.createTaskAndEnqueue({
      type: TaskType.pdf_to_excel,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName
      },
      jobName: "pdf-to-excel",
      buildJobPayload: (taskId): ConvertJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        outputName: dto.outputName
      })
    });
  }

  async queueWordToPdf(dto: ConvertPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(
      dto.fileId,
      WORD_MIME_TYPES,
      "a Word file (.docx)",
      context
    );

    return this.createTaskAndEnqueue({
      type: TaskType.word_to_pdf,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName
      },
      jobName: "word-to-pdf",
      buildJobPayload: (taskId): ConvertJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        outputName: dto.outputName
      })
    });
  }

  async queueExcelToPdf(dto: ConvertPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(
      dto.fileId,
      EXCEL_MIME_TYPES,
      "an Excel file (.xlsx)",
      context
    );

    return this.createTaskAndEnqueue({
      type: TaskType.excel_to_pdf,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName
      },
      jobName: "excel-to-pdf",
      buildJobPayload: (taskId): ConvertJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        outputName: dto.outputName
      })
    });
  }

  async queuePowerpointToPdf(dto: ConvertPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(
      dto.fileId,
      POWERPOINT_MIME_TYPES,
      "a PowerPoint file (.pptx)",
      context
    );

    return this.createTaskAndEnqueue({
      type: TaskType.powerpoint_to_pdf,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName
      },
      jobName: "powerpoint-to-pdf",
      buildJobPayload: (taskId): ConvertJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        outputName: dto.outputName
      })
    });
  }

  async queueEdit(dto: EditPdfDto, context: TaskRequestContext = {}): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId, PDF_MIME_TYPES, "a PDF file", context);

    const textEdits = dto.textEdits ?? [];
    const rectangleEdits = dto.rectangleEdits ?? [];
    const imageEdits = dto.imageEdits ?? [];
    const pageRotations = dto.pageRotations ?? [];
    const pageNumbers = dto.pageNumbers;
    const watermark = dto.watermark;

    if (
      textEdits.length +
        rectangleEdits.length +
        imageEdits.length +
        pageRotations.length +
        (pageNumbers ? 1 : 0) +
        (watermark ? 1 : 0) ===
      0
    ) {
      throw new BadRequestException("At least one edit operation is required.");
    }

    return this.createTaskAndEnqueue({
      type: TaskType.edit,
      inputFileId: file.id,
      ownerId: context.ownerId,
      payload: {
        fileKey: file.objectKey,
        outputName: dto.outputName,
        retentionHours: dto.retentionHours ?? null,
        editCounts: {
          text: textEdits.length,
          rectangles: rectangleEdits.length,
          images: imageEdits.length,
          rotations: pageRotations.length,
          pageNumbers: Boolean(pageNumbers),
          watermark: Boolean(watermark)
        }
      },
      jobName: "edit",
      buildJobPayload: (taskId): EditJobPayload => ({
        taskId,
        fileKey: file.objectKey,
        textEdits,
        rectangleEdits,
        imageEdits,
        pageRotations,
        pageNumbers,
        watermark,
        outputName: dto.outputName,
        expiresAtIso: dto.retentionHours
          ? new Date(Date.now() + dto.retentionHours * 60 * 60 * 1000).toISOString()
          : undefined
      })
    });
  }

  private toTaskStatusView(task: {
    id: string;
    status: string;
    type: string;
    ownerId: string | null;
    progressPercent: number;
    progressMessage: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
    outputFile: {
      id: string;
      expiresAt: Date | null;
    } | null;
  }): TaskStatusView {
    const outputDownloadUrl = task.outputFile
      ? !task.outputFile.expiresAt || task.outputFile.expiresAt.getTime() > Date.now()
        ? this.storageService.createDownloadUrl(task.outputFile.id)
        : null
      : null;

    return {
      id: task.id,
      status: task.status,
      type: task.type,
      progressPercent: task.progressPercent,
      progressMessage: task.progressMessage,
      errorMessage: task.errorMessage,
      outputDownloadUrl,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };
  }

  async getTask(taskId: string, context: TaskRequestContext = {}): Promise<TaskStatusView> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { outputFile: true }
    });

    if (!task) {
      throw new NotFoundException("Task not found.");
    }

    if (task.ownerId && task.ownerId !== context.ownerId) {
      throw new NotFoundException("Task not found.");
    }

    return this.toTaskStatusView(task);
  }
}
