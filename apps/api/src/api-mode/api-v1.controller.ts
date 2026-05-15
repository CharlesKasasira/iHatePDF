import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../auth/auth.service.js";
import { QueueService } from "../queue/queue.service.js";
import { CreateSignatureRequestDto } from "../signature-requests/signature-requests.controller.js";
import { SignatureRequestsService } from "../signature-requests/signature-requests.service.js";
import {
  CompressPdfDto,
  ConvertPdfDto,
  EditPdfDto,
  ExtractPagesDto,
  JpgToPdfDto,
  MergePdfDto,
  OrganizePdfDto,
  ProtectPdfDto,
  RemovePagesDto,
  SignPdfDto,
  SplitPdfDto,
  UnlockPdfDto
} from "../tasks/dto.js";
import { TaskStatusView, TasksService } from "../tasks/tasks.service.js";
import { UploadsService } from "../uploads/uploads.service.js";

const API_SCHEMA_VERSION = "2026-05-14";

type ApiTaskStatus = {
  schemaVersion: string;
  task: {
    id: string;
    type: string;
    status: string;
    progress: {
      percent: number;
      message: string | null;
    };
    result: {
      fileId: string | null;
      downloadUrl: string | null;
      expiresAt: string | null;
    };
    error: {
      message: string;
    } | null;
    timestamps: {
      createdAt: string;
      updatedAt: string;
    };
  };
};

function apiTaskStatus(task: TaskStatusView): ApiTaskStatus {
  return {
    schemaVersion: API_SCHEMA_VERSION,
    task: {
      id: task.id,
      type: task.type,
      status: task.status,
      progress: {
        percent: task.progressPercent,
        message: task.progressMessage
      },
      result: {
        fileId: task.outputFileId,
        downloadUrl: task.outputDownloadUrl,
        expiresAt: task.outputExpiresAt ? task.outputExpiresAt.toISOString() : null
      },
      error: task.errorMessage ? { message: task.errorMessage } : null,
      timestamps: {
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString()
      }
    }
  };
}

@Controller("v1")
export class ApiV1Controller {
  constructor(
    private readonly authService: AuthService,
    private readonly uploadsService: UploadsService,
    private readonly tasksService: TasksService,
    private readonly queueService: QueueService,
    private readonly signatureRequestsService: SignatureRequestsService
  ) {}

  private async context(request: FastifyRequest): Promise<{ ownerId: string }> {
    const principal = await this.authService.requireApiKey(request);
    return { ownerId: principal.user.id };
  }

  private async queueResponse(
    request: FastifyRequest,
    queueTask: (context: { ownerId: string }) => Promise<{ taskId: string }>
  ): Promise<ApiTaskStatus> {
    const context = await this.context(request);
    const { taskId } = await queueTask(context);
    return apiTaskStatus(await this.tasksService.getTask(taskId, context));
  }

  @Post("files")
  async uploadFile(@Req() request: FastifyRequest): Promise<{
    schemaVersion: string;
    file: {
      id: string;
      objectKey: string;
      fileName: string;
    };
  }> {
    const context = await this.context(request);
    const file = await this.uploadsService.uploadFile(request, context.ownerId);
    return {
      schemaVersion: API_SCHEMA_VERSION,
      file: {
        id: file.fileId,
        objectKey: file.objectKey,
        fileName: file.fileName
      }
    };
  }

  @Post("tasks/merge")
  queueMerge(@Body() dto: MergePdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueMerge(dto, context));
  }

  @Post("tasks/split")
  queueSplit(@Body() dto: SplitPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueSplit(dto, context));
  }

  @Post("tasks/remove-pages")
  queueRemovePages(@Body() dto: RemovePagesDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueRemovePages(dto, context));
  }

  @Post("tasks/extract-pages")
  queueExtractPages(@Body() dto: ExtractPagesDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueExtractPages(dto, context));
  }

  @Post("tasks/organize-pdf")
  queueOrganizePdf(@Body() dto: OrganizePdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueOrganizePdf(dto, context));
  }

  @Post("tasks/sign")
  queueSign(@Body() dto: SignPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueSign(dto, context));
  }

  @Post("tasks/compress")
  queueCompress(@Body() dto: CompressPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueCompress(dto, context));
  }

  @Post("tasks/protect")
  queueProtect(@Body() dto: ProtectPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueProtect(dto, context));
  }

  @Post("tasks/unlock")
  queueUnlock(@Body() dto: UnlockPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueUnlock(dto, context));
  }

  @Post("tasks/jpg-to-pdf")
  queueJpgToPdf(@Body() dto: JpgToPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueJpgToPdf(dto, context));
  }

  @Post("tasks/pdf-to-word")
  queuePdfToWord(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePdfToWord(dto, context));
  }

  @Post("tasks/pdf-to-jpg")
  queuePdfToJpg(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePdfToJpg(dto, context));
  }

  @Post("tasks/pdf-to-powerpoint")
  queuePdfToPowerpoint(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePdfToPowerpoint(dto, context));
  }

  @Post("tasks/pdf-to-excel")
  queuePdfToExcel(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePdfToExcel(dto, context));
  }

  @Post("tasks/word-to-pdf")
  queueWordToPdf(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueWordToPdf(dto, context));
  }

  @Post("tasks/excel-to-pdf")
  queueExcelToPdf(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueExcelToPdf(dto, context));
  }

  @Post("tasks/powerpoint-to-pdf")
  queuePowerpointToPdf(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePowerpointToPdf(dto, context));
  }

  @Post("tasks/edit")
  queueEditPdf(@Body() dto: EditPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueEdit(dto, context));
  }

  @Get("tasks/:id")
  async getTask(@Param("id") id: string, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    const context = await this.context(request);
    return apiTaskStatus(await this.tasksService.getTask(id, context));
  }

  @Get("tasks/:id/status")
  getTaskStatus(@Param("id") id: string, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.getTask(id, request);
  }

  @Get("queue/status")
  async queueStatus(@Req() request: FastifyRequest): Promise<{
    schemaVersion: string;
    queue: Awaited<ReturnType<QueueService["getStatus"]>>;
    generatedAt: string;
  }> {
    await this.context(request);
    return {
      schemaVersion: API_SCHEMA_VERSION,
      queue: await this.queueService.getStatus(),
      generatedAt: new Date().toISOString()
    };
  }

  @Post("signature-requests")
  async createSignatureRequest(
    @Body() dto: CreateSignatureRequestDto,
    @Req() request: FastifyRequest
  ): Promise<{
    schemaVersion: string;
    envelope: Awaited<ReturnType<SignatureRequestsService["createRequest"]>>;
  }> {
    const context = await this.context(request);
    return {
      schemaVersion: API_SCHEMA_VERSION,
      envelope: await this.signatureRequestsService.createRequest(dto, context)
    };
  }

  @Get("signature-requests/:id")
  async getSignatureRequest(
    @Param("id") id: string,
    @Req() request: FastifyRequest
  ): Promise<{
    schemaVersion: string;
    envelope: Awaited<ReturnType<SignatureRequestsService["getEnvelope"]>>;
  }> {
    const context = await this.context(request);
    return {
      schemaVersion: API_SCHEMA_VERSION,
      envelope: await this.signatureRequestsService.getEnvelope(id, context)
    };
  }
}
