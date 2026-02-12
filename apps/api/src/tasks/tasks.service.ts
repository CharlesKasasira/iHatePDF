import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { TaskType } from "@prisma/client";
import { QueueService } from "../queue/queue.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { MergePdfDto, SignPdfDto, SplitPdfDto } from "./dto.js";

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

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storageService: StorageService
  ) {}

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
    const file = await this.prisma.fileObject.findUnique({ where: { id: dto.fileId } });
    if (!file) {
      throw new NotFoundException("Input file was not found.");
    }

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
    const file = await this.prisma.fileObject.findUnique({ where: { id: dto.fileId } });
    if (!file) {
      throw new NotFoundException("Input file was not found.");
    }

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
      ? await this.storageService.createPresignedDownload(task.outputFile.objectKey)
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
