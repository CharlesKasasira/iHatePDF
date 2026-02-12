import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { MergePdfDto, SignPdfDto, SplitPdfDto } from "./dto.js";
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
