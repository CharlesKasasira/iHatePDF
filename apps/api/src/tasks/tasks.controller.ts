import { Body, Controller, Get, MessageEvent, Param, Post, Sse } from "@nestjs/common";
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
import { Observable, concat, from, interval, of } from "rxjs";
import { distinctUntilChanged, map, switchMap } from "rxjs/operators";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post("merge")
  queueMerge(@Body() dto: MergePdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueMerge(dto);
  }

  @Post("split")
  queueSplit(@Body() dto: SplitPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueSplit(dto);
  }

  @Post("remove-pages")
  queueRemovePages(@Body() dto: RemovePagesDto): Promise<{ taskId: string }> {
    return this.tasksService.queueRemovePages(dto);
  }

  @Post("extract-pages")
  queueExtractPages(@Body() dto: ExtractPagesDto): Promise<{ taskId: string }> {
    return this.tasksService.queueExtractPages(dto);
  }

  @Post("organize-pdf")
  queueOrganizePdf(@Body() dto: OrganizePdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueOrganizePdf(dto);
  }

  @Post("sign")
  queueSign(@Body() dto: SignPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueSign(dto);
  }

  @Post("compress")
  queueCompress(@Body() dto: CompressPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueCompress(dto);
  }

  @Post("protect")
  queueProtect(@Body() dto: ProtectPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueProtect(dto);
  }

  @Post("unlock")
  queueUnlock(@Body() dto: UnlockPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueUnlock(dto);
  }

  @Post("jpg-to-pdf")
  queueJpgToPdf(@Body() dto: JpgToPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueJpgToPdf(dto);
  }

  @Post("pdf-to-word")
  queuePdfToWord(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToWord(dto);
  }

  @Post("pdf-to-jpg")
  queuePdfToJpg(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToJpg(dto);
  }

  @Post("pdf-to-powerpoint")
  queuePdfToPowerpoint(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToPowerpoint(dto);
  }

  @Post("pdf-to-excel")
  queuePdfToExcel(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToExcel(dto);
  }

  @Post("word-to-pdf")
  queueWordToPdf(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueWordToPdf(dto);
  }

  @Post("excel-to-pdf")
  queueExcelToPdf(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueExcelToPdf(dto);
  }

  @Post("powerpoint-to-pdf")
  queuePowerpointToPdf(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queuePowerpointToPdf(dto);
  }

  @Post("edit")
  queueEditPdf(@Body() dto: EditPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueEdit(dto);
  }

  @Sse(":id/events")
  streamTask(@Param("id") id: string): Observable<MessageEvent> {
    return concat(of(0), interval(1000)).pipe(
      switchMap(() => from(this.tasksService.getTask(id))),
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
  getTask(@Param("id") id: string): Promise<TaskStatusView> {
    return this.tasksService.getTask(id);
  }
}
