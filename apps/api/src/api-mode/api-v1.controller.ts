import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../auth/auth.service.js";
import { QueueService } from "../queue/queue.service.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { CreateSignatureRequestDto } from "../signature-requests/signature-requests.controller.js";
import { SignatureRequestsService } from "../signature-requests/signature-requests.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
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

type ApiRequestContext = {
  ownerId: string;
  apiKeyId: string;
};

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
    private readonly signatureRequestsService: SignatureRequestsService,
    private readonly prisma: PrismaService
  ) {}

  private async context(request: FastifyRequest): Promise<ApiRequestContext> {
    const principal = await this.authService.requireApiKey(request);
    return { ownerId: principal.user.id, apiKeyId: principal.apiKeyId };
  }

  @Get("openapi.json")
  openApi(): Record<string, unknown> {
    return {
      openapi: "3.1.0",
      info: {
        title: "iHatePDF API",
        version: API_SCHEMA_VERSION,
        description: "Stable API-key-authenticated document automation endpoints."
      },
      servers: [{ url: "/api/v1" }],
      components: {
        securitySchemes: {
          apiKeyBearer: { type: "http", scheme: "bearer" },
          apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" }
        },
        schemas: {
          Error: {
            type: "object",
            properties: {
              statusCode: { type: "number" },
              message: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
              error: { type: "string" }
            }
          },
          TaskStatus: {
            type: "object",
            properties: {
              schemaVersion: { type: "string" },
              task: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  type: { type: "string" },
                  status: { enum: ["queued", "processing", "completed", "failed"] },
                  progress: {
                    type: "object",
                    properties: {
                      percent: { type: "number" },
                      message: { type: ["string", "null"] }
                    }
                  },
                  result: {
                    type: "object",
                    properties: {
                      fileId: { type: ["string", "null"] },
                      downloadUrl: { type: ["string", "null"] },
                      expiresAt: { type: ["string", "null"], format: "date-time" }
                    }
                  },
                  error: { type: ["object", "null"], properties: { message: { type: "string" } } }
                }
              }
            }
          }
        }
      },
      security: [{ apiKeyBearer: [] }, { apiKeyHeader: [] }],
      paths: {
        "/files": {
          post: {
            summary: "Upload a source file",
            requestBody: { content: { "multipart/form-data": { schema: { type: "object" } } } },
            responses: { "201": { description: "Uploaded file" }, "400": { description: "Invalid upload" } }
          }
        },
        "/tasks/{operation}": {
          post: {
            summary: "Queue a document task",
            parameters: [{ name: "operation", in: "path", required: true, schema: { type: "string" } }],
            responses: { "201": { description: "Queued task", content: { "application/json": { schema: { $ref: "#/components/schemas/TaskStatus" } } } } }
          }
        },
        "/tasks/{id}/status": {
          get: {
            summary: "Poll task status",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Task status", content: { "application/json": { schema: { $ref: "#/components/schemas/TaskStatus" } } } } }
          }
        },
        "/queue/status": {
          get: {
            summary: "Inspect queue health",
            responses: { "200": { description: "Queue status" } }
          }
        },
        "/signature-requests": {
          post: {
            summary: "Create a signing workflow",
            responses: { "201": { description: "Created signing workflow" } }
          }
        }
      }
    };
  }

  private async recordUsage(
    request: FastifyRequest,
    context: ApiRequestContext,
    input: {
      taskId?: string;
      fileId?: string;
      statusCode?: number;
    } = {}
  ): Promise<void> {
    await this.prisma.apiUsageEvent
      .create({
        data: {
          ownerId: context.ownerId,
          apiKeyId: context.apiKeyId,
          method: request.method,
          route: request.routeOptions.url ?? request.url,
          statusCode: input.statusCode ?? 200,
          taskId: input.taskId,
          fileId: input.fileId
        }
      })
      .catch(() => undefined);
  }

  private async queueResponse(
    request: FastifyRequest,
    queueTask: (context: ApiRequestContext) => Promise<{ taskId: string }>
  ): Promise<ApiTaskStatus> {
    const context = await this.context(request);
    const { taskId } = await queueTask(context);
    await this.recordUsage(request, context, { taskId });
    return apiTaskStatus(await this.tasksService.getTask(taskId, context));
  }

  @Post("files")
  @RateLimit("uploads")
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
    await this.recordUsage(request, context, { fileId: file.fileId });
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
  @RateLimit("taskQueue")
  queueMerge(@Body() dto: MergePdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueMerge(dto, context));
  }

  @Post("tasks/split")
  @RateLimit("taskQueue")
  queueSplit(@Body() dto: SplitPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueSplit(dto, context));
  }

  @Post("tasks/remove-pages")
  @RateLimit("taskQueue")
  queueRemovePages(@Body() dto: RemovePagesDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueRemovePages(dto, context));
  }

  @Post("tasks/extract-pages")
  @RateLimit("taskQueue")
  queueExtractPages(@Body() dto: ExtractPagesDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueExtractPages(dto, context));
  }

  @Post("tasks/organize-pdf")
  @RateLimit("taskQueue")
  queueOrganizePdf(@Body() dto: OrganizePdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueOrganizePdf(dto, context));
  }

  @Post("tasks/sign")
  @RateLimit("taskQueue")
  queueSign(@Body() dto: SignPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueSign(dto, context));
  }

  @Post("tasks/compress")
  @RateLimit("taskQueue")
  queueCompress(@Body() dto: CompressPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueCompress(dto, context));
  }

  @Post("tasks/protect")
  @RateLimit("taskQueue")
  queueProtect(@Body() dto: ProtectPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueProtect(dto, context));
  }

  @Post("tasks/unlock")
  @RateLimit("taskQueue")
  queueUnlock(@Body() dto: UnlockPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueUnlock(dto, context));
  }

  @Post("tasks/jpg-to-pdf")
  @RateLimit("taskQueue")
  queueJpgToPdf(@Body() dto: JpgToPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueJpgToPdf(dto, context));
  }

  @Post("tasks/pdf-to-word")
  @RateLimit("taskQueue")
  queuePdfToWord(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePdfToWord(dto, context));
  }

  @Post("tasks/pdf-to-jpg")
  @RateLimit("taskQueue")
  queuePdfToJpg(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePdfToJpg(dto, context));
  }

  @Post("tasks/pdf-to-powerpoint")
  @RateLimit("taskQueue")
  queuePdfToPowerpoint(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePdfToPowerpoint(dto, context));
  }

  @Post("tasks/pdf-to-excel")
  @RateLimit("taskQueue")
  queuePdfToExcel(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePdfToExcel(dto, context));
  }

  @Post("tasks/word-to-pdf")
  @RateLimit("taskQueue")
  queueWordToPdf(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueWordToPdf(dto, context));
  }

  @Post("tasks/excel-to-pdf")
  @RateLimit("taskQueue")
  queueExcelToPdf(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueExcelToPdf(dto, context));
  }

  @Post("tasks/powerpoint-to-pdf")
  @RateLimit("taskQueue")
  queuePowerpointToPdf(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queuePowerpointToPdf(dto, context));
  }

  @Post("tasks/edit")
  @RateLimit("taskQueue")
  queueEditPdf(@Body() dto: EditPdfDto, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    return this.queueResponse(request, (context) => this.tasksService.queueEdit(dto, context));
  }

  @Get("tasks/:id")
  async getTask(@Param("id") id: string, @Req() request: FastifyRequest): Promise<ApiTaskStatus> {
    const context = await this.context(request);
    await this.recordUsage(request, context, { taskId: id });
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
    const context = await this.context(request);
    await this.recordUsage(request, context);
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
    const envelope = await this.signatureRequestsService.createRequest(dto, context);
    await this.recordUsage(request, context);
    return {
      schemaVersion: API_SCHEMA_VERSION,
      envelope
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
    await this.recordUsage(request, context);
    return {
      schemaVersion: API_SCHEMA_VERSION,
      envelope: await this.signatureRequestsService.getEnvelope(id, context)
    };
  }
}
