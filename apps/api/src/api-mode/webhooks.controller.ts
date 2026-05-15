import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl } from "class-validator";
import type { FastifyRequest } from "fastify";
import { WEBHOOK_EVENTS, WebhooksService } from "./webhooks.service.js";

class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  url!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];
}

class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get("events")
  events(): { events: readonly string[] } {
    return { events: WEBHOOK_EVENTS };
  }

  @Get()
  list(@Req() request: FastifyRequest): ReturnType<WebhooksService["list"]> {
    return this.webhooksService.list(request);
  }

  @Post()
  create(@Body() dto: CreateWebhookDto, @Req() request: FastifyRequest): ReturnType<WebhooksService["create"]> {
    return this.webhooksService.create(request, dto);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateWebhookDto,
    @Req() request: FastifyRequest
  ): ReturnType<WebhooksService["update"]> {
    return this.webhooksService.update(request, id, dto);
  }

  @Post(":id/rotate-secret")
  rotateSecret(
    @Param("id") id: string,
    @Req() request: FastifyRequest
  ): ReturnType<WebhooksService["rotateSecret"]> {
    return this.webhooksService.rotateSecret(request, id);
  }

  @Delete(":id")
  delete(@Param("id") id: string, @Req() request: FastifyRequest): ReturnType<WebhooksService["delete"]> {
    return this.webhooksService.delete(request, id);
  }
}
