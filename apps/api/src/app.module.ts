import { Module } from "@nestjs/common";
import { AccountModule } from "./account/account.module.js";
import { ApiModeModule } from "./api-mode/api-mode.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CleanupModule } from "./cleanup/cleanup.module.js";
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
    AuthModule,
    QueueModule,
    StorageModule,
    CleanupModule,
    ApiModeModule,
    AccountModule,
    UploadsModule,
    TasksModule,
    SignatureRequestsModule,
    FilesModule
  ]
})
export class AppModule {}
