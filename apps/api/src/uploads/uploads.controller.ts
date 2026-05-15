import { Controller, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../auth/auth.service.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { UploadsService } from "./uploads.service.js";

@Controller("uploads")
export class UploadsController {
  constructor(
    private readonly uploadsService: UploadsService,
    private readonly authService: AuthService
  ) {}

  @Post()
  @RateLimit("uploads")
  async uploadFile(
    @Req() request: FastifyRequest
  ): Promise<{ fileId: string; objectKey: string; fileName: string }> {
    const currentUser = await this.authService.currentUser(request);
    return this.uploadsService.uploadFile(request, currentUser?.id);
  }
}
