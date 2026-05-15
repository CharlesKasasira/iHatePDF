import { Body, Controller, Get, MessageEvent, Param, Post, Req, Sse } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
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
} from "./dto.js";
import { TaskStatusView, TasksService } from "./tasks.service.js";
import { AuthService } from "../auth/auth.service.js";
import { Observable, concat, from, interval, of } from "rxjs";
import { distinctUntilChanged, map, switchMap } from "rxjs/operators";
import { RateLimit, SkipRateLimit } from "../rate-limit/rate-limit.decorator.js";

@Controller("tasks")
@RateLimit("taskQueue")
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly authService: AuthService
  ) {}

  private async context(request: FastifyRequest): Promise<{ ownerId?: string }> {
    const user = await this.authService.currentUser(request);
    return user ? { ownerId: user.id } : {};
  }

  @Post("merge")
  async queueMerge(@Body() dto: MergePdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueMerge(dto, await this.context(request));
  }

  @Post("split")
  async queueSplit(@Body() dto: SplitPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueSplit(dto, await this.context(request));
  }

  @Post("remove-pages")
  async queueRemovePages(@Body() dto: RemovePagesDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueRemovePages(dto, await this.context(request));
  }

  @Post("extract-pages")
  async queueExtractPages(@Body() dto: ExtractPagesDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueExtractPages(dto, await this.context(request));
  }

  @Post("organize-pdf")
  async queueOrganizePdf(@Body() dto: OrganizePdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueOrganizePdf(dto, await this.context(request));
  }

  @Post("sign")
  async queueSign(@Body() dto: SignPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueSign(dto, await this.context(request));
  }

  @Post("compress")
  async queueCompress(@Body() dto: CompressPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueCompress(dto, await this.context(request));
  }

  @Post("protect")
  async queueProtect(@Body() dto: ProtectPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueProtect(dto, await this.context(request));
  }

  @Post("unlock")
  async queueUnlock(@Body() dto: UnlockPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueUnlock(dto, await this.context(request));
  }

  @Post("jpg-to-pdf")
  async queueJpgToPdf(@Body() dto: JpgToPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueJpgToPdf(dto, await this.context(request));
  }

  @Post("pdf-to-word")
  async queuePdfToWord(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToWord(dto, await this.context(request));
  }

  @Post("pdf-to-jpg")
  async queuePdfToJpg(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToJpg(dto, await this.context(request));
  }

  @Post("pdf-to-powerpoint")
  async queuePdfToPowerpoint(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToPowerpoint(dto, await this.context(request));
  }

  @Post("pdf-to-excel")
  async queuePdfToExcel(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToExcel(dto, await this.context(request));
  }

  @Post("word-to-pdf")
  async queueWordToPdf(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueWordToPdf(dto, await this.context(request));
  }

  @Post("excel-to-pdf")
  async queueExcelToPdf(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueExcelToPdf(dto, await this.context(request));
  }

  @Post("powerpoint-to-pdf")
  async queuePowerpointToPdf(@Body() dto: ConvertPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queuePowerpointToPdf(dto, await this.context(request));
  }

  @Post("edit")
  async queueEditPdf(@Body() dto: EditPdfDto, @Req() request: FastifyRequest): Promise<{ taskId: string }> {
    return this.tasksService.queueEdit(dto, await this.context(request));
  }

  @Post(":id/retry")
  async retryTask(@Param("id") id: string, @Req() request: FastifyRequest): Promise<TaskStatusView> {
    return this.tasksService.retryTask(id, await this.context(request));
  }

  @Sse(":id/events")
  @SkipRateLimit()
  streamTask(@Param("id") id: string, @Req() request: FastifyRequest): Observable<MessageEvent> {
    return concat(of(0), interval(1000)).pipe(
      switchMap(() => from(this.context(request).then((context) => this.tasksService.getTask(id, context)))),
      distinctUntilChanged((previous, current) => {
        return (
          previous.status === current.status &&
          previous.progressPercent === current.progressPercent &&
          previous.progressMessage === current.progressMessage &&
          previous.errorMessage === current.errorMessage &&
          previous.outputDownloadUrl === current.outputDownloadUrl &&
          previous.updatedAt.getTime() === current.updatedAt.getTime()
        );
      }),
      map((task) => ({ data: task }))
    );
  }

  @Get(":id")
  @SkipRateLimit()
  async getTask(@Param("id") id: string, @Req() request: FastifyRequest): Promise<TaskStatusView> {
    return this.tasksService.getTask(id, await this.context(request));
  }
}
