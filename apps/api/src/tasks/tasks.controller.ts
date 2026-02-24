import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  CompressPdfDto,
  ConvertPdfDto,
  EditPdfDto,
  MergePdfDto,
  ProtectPdfDto,
  SignPdfDto,
  SplitPdfDto,
  UnlockPdfDto
} from "./dto.js";
import { TasksService } from "./tasks.service.js";

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

  @Post("pdf-to-word")
  queuePdfToWord(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToWord(dto);
  }

  @Post("pdf-to-powerpoint")
  queuePdfToPowerpoint(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToPowerpoint(dto);
  }

  @Post("pdf-to-excel")
  queuePdfToExcel(@Body() dto: ConvertPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queuePdfToExcel(dto);
  }

  @Post("edit")
  queueEditPdf(@Body() dto: EditPdfDto): Promise<{ taskId: string }> {
    return this.tasksService.queueEdit(dto);
  }

  @Get(":id")
  getTask(@Param("id") id: string): Promise<{
    id: string;
    status: string;
    type: string;
    errorMessage: string | null;
    outputDownloadUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    return this.tasksService.getTask(id);
  }
}
