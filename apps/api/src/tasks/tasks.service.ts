import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { TaskType } from "@prisma/client";
import { QueueService } from "../queue/queue.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import {
  CompressPdfDto,
  ConvertPdfDto,
  EditPdfDto,
  EditImageDto,
  EditRectangleDto,
  EditTextDto,
  MergePdfDto,
  ProtectPdfDto,
  SignPdfDto,
  SplitPdfDto,
  UnlockPdfDto
} from "./dto.js";

interface MergeJobPayload {
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
  outputName: string;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storageService: StorageService
  ) {}

  private async requireInputFile(fileId: string): Promise<{ id: string; objectKey: string }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundException("Input file was not found.");
    }

    return file;
  }

  async queueMerge(dto: MergePdfDto): Promise<{ taskId: string }> {
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
      return item.objectKey;
    });

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.merge,
        status: "queued",
        payload: {
          fileKeys,
          outputName: dto.outputName
        }
      }
    });

    const payload: MergeJobPayload = {
      taskId: task.id,
      fileKeys,
      outputName: dto.outputName
    };

    await this.queueService.enqueue("merge", payload);
    return { taskId: task.id };
  }

  async queueSplit(dto: SplitPdfDto): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId);

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.split,
        status: "queued",
        inputFileId: file.id,
        payload: {
          fileKey: file.objectKey,
          pageRanges: dto.pageRanges,
          outputPrefix: dto.outputPrefix
        }
      }
    });

    const payload: SplitJobPayload = {
      taskId: task.id,
      fileKey: file.objectKey,
      pageRanges: dto.pageRanges,
      outputPrefix: dto.outputPrefix
    };

    await this.queueService.enqueue("split", payload);
    return { taskId: task.id };
  }

  async queueSign(dto: SignPdfDto): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId);

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.sign,
        status: "queued",
        inputFileId: file.id,
        payload: {
          fileKey: file.objectKey,
          signatureDataUrl: dto.signatureDataUrl,
          page: dto.page,
          x: dto.x,
          y: dto.y,
          width: dto.width,
          height: dto.height,
          outputName: dto.outputName
        }
      }
    });

    const payload: SignJobPayload = {
      taskId: task.id,
      fileKey: file.objectKey,
      signatureDataUrl: dto.signatureDataUrl,
      page: dto.page,
      x: dto.x,
      y: dto.y,
      width: dto.width,
      height: dto.height,
      outputName: dto.outputName
    };

    await this.queueService.enqueue("sign", payload);
    return { taskId: task.id };
  }

  async queueCompress(dto: CompressPdfDto): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId);

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.compress,
        status: "queued",
        inputFileId: file.id,
        payload: {
          fileKey: file.objectKey,
          outputName: dto.outputName
        }
      }
    });

    const payload: CompressJobPayload = {
      taskId: task.id,
      fileKey: file.objectKey,
      outputName: dto.outputName
    };

    await this.queueService.enqueue("compress", payload);
    return { taskId: task.id };
  }

  async queueProtect(dto: ProtectPdfDto): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId);

    const password = dto.password.trim();
    if (!password) {
      throw new BadRequestException("Password is required.");
    }

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.protect,
        status: "queued",
        inputFileId: file.id,
        payload: {
          fileKey: file.objectKey,
          outputName: dto.outputName,
          passwordProvided: true
        }
      }
    });

    const payload: ProtectJobPayload = {
      taskId: task.id,
      fileKey: file.objectKey,
      password,
      outputName: dto.outputName
    };

    await this.queueService.enqueue("protect", payload);
    return { taskId: task.id };
  }

  async queueUnlock(dto: UnlockPdfDto): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId);

    const password = dto.password.trim();
    if (!password) {
      throw new BadRequestException("Password is required.");
    }

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.unlock,
        status: "queued",
        inputFileId: file.id,
        payload: {
          fileKey: file.objectKey,
          outputName: dto.outputName,
          passwordProvided: true
        }
      }
    });

    const payload: UnlockJobPayload = {
      taskId: task.id,
      fileKey: file.objectKey,
      password,
      outputName: dto.outputName
    };

    await this.queueService.enqueue("unlock", payload);
    return { taskId: task.id };
  }

  async queuePdfToWord(dto: ConvertPdfDto): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId);

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.pdf_to_word,
        status: "queued",
        inputFileId: file.id,
        payload: {
          fileKey: file.objectKey,
          outputName: dto.outputName
        }
      }
    });

    const payload: ConvertJobPayload = {
      taskId: task.id,
      fileKey: file.objectKey,
      outputName: dto.outputName
    };

    await this.queueService.enqueue("pdf-to-word", payload);
    return { taskId: task.id };
  }

  async queuePdfToPowerpoint(dto: ConvertPdfDto): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId);

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.pdf_to_powerpoint,
        status: "queued",
        inputFileId: file.id,
        payload: {
          fileKey: file.objectKey,
          outputName: dto.outputName
        }
      }
    });

    const payload: ConvertJobPayload = {
      taskId: task.id,
      fileKey: file.objectKey,
      outputName: dto.outputName
    };

    await this.queueService.enqueue("pdf-to-powerpoint", payload);
    return { taskId: task.id };
  }

  async queuePdfToExcel(dto: ConvertPdfDto): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId);

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.pdf_to_excel,
        status: "queued",
        inputFileId: file.id,
        payload: {
          fileKey: file.objectKey,
          outputName: dto.outputName
        }
      }
    });

    const payload: ConvertJobPayload = {
      taskId: task.id,
      fileKey: file.objectKey,
      outputName: dto.outputName
    };

    await this.queueService.enqueue("pdf-to-excel", payload);
    return { taskId: task.id };
  }

  async queueEdit(dto: EditPdfDto): Promise<{ taskId: string }> {
    const file = await this.requireInputFile(dto.fileId);

    const textEdits = dto.textEdits ?? [];
    const rectangleEdits = dto.rectangleEdits ?? [];
    const imageEdits = dto.imageEdits ?? [];

    if (textEdits.length + rectangleEdits.length + imageEdits.length === 0) {
      throw new BadRequestException("At least one edit operation is required.");
    }

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.edit,
        status: "queued",
        inputFileId: file.id,
        payload: {
          fileKey: file.objectKey,
          outputName: dto.outputName,
          editCounts: {
            text: textEdits.length,
            rectangles: rectangleEdits.length,
            images: imageEdits.length
          }
        }
      }
    });

    const payload: EditJobPayload = {
      taskId: task.id,
      fileKey: file.objectKey,
      textEdits,
      rectangleEdits,
      imageEdits,
      outputName: dto.outputName
    };

    await this.queueService.enqueue("edit", payload);
    return { taskId: task.id };
  }

  async getTask(taskId: string): Promise<{
    id: string;
    status: string;
    type: string;
    errorMessage: string | null;
    outputDownloadUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { outputFile: true }
    });

    if (!task) {
      throw new NotFoundException("Task not found.");
    }

    const outputDownloadUrl = task.outputFile
      ? this.storageService.createDownloadUrl(task.outputFile.id)
      : null;

    return {
      id: task.id,
      status: task.status,
      type: task.type,
      errorMessage: task.errorMessage,
      outputDownloadUrl,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };
  }
}
