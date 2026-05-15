import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { IsDateString, IsNotEmpty, IsOptional, IsString } from "class-validator";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../auth/auth.service.js";

class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

@Controller("api-keys")
export class ApiKeysController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  list(@Req() request: FastifyRequest): ReturnType<AuthService["listApiKeys"]> {
    return this.authService.listApiKeys(request);
  }

  @Post()
  create(@Body() dto: CreateApiKeyDto, @Req() request: FastifyRequest): ReturnType<AuthService["createApiKey"]> {
    return this.authService.createApiKey(request, dto);
  }

  @Delete(":id")
  revoke(@Param("id") id: string, @Req() request: FastifyRequest): ReturnType<AuthService["revokeApiKey"]> {
    return this.authService.revokeApiKey(request, id);
  }
}
