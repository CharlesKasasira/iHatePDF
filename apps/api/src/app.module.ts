import { Module } from "@nestjs/common";
import { FilesModule } from "./files/files.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { QueueModule } from "./queue/queue.module.js";
import { SignatureRequestsModule } from "./signature-requests/signature-requests.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { UploadsModule } from "./uploads/uploads.module.js";

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    StorageModule,
    UploadsModule,
    TasksModule,
    SignatureRequestsModule,
    FilesModule
  ]
})
export class AppModule {}
