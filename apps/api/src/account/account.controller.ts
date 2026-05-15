import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";
import type { FastifyRequest } from "fastify";
import { AccountService } from "./account.service.js";

class UpdateAdminUserDto {
  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  @IsOptional()
  @IsBoolean()
  suspended?: boolean;

  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  @IsOptional()
  @IsString()
  lockReason?: string;
}

class ResetAdminUserPasswordDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

class UpdateAdminApiKeyDto {
  @IsOptional()
  @IsBoolean()
  revoked?: boolean;

  @IsOptional()
  @IsBoolean()
  rateLimited?: boolean;

  @IsOptional()
  @IsString()
  rateLimitReason?: string;
}

@Controller("account")
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get("activity")
  activity(@Req() request: FastifyRequest): ReturnType<AccountService["activity"]> {
    return this.accountService.activity(request);
  }

  @Get("admin-dashboard")
  adminDashboard(@Req() request: FastifyRequest): ReturnType<AccountService["adminDashboard"]> {
    return this.accountService.adminDashboard(request);
  }

  @Get("admin/users")
  adminUsers(@Req() request: FastifyRequest): ReturnType<AccountService["listAdminUsers"]> {
    return this.accountService.listAdminUsers(request);
  }

  @Patch("admin/users/:id")
  updateAdminUser(
    @Param("id") id: string,
    @Body() dto: UpdateAdminUserDto,
    @Req() request: FastifyRequest
  ): ReturnType<AccountService["updateAdminUser"]> {
    return this.accountService.updateAdminUser(request, id, dto);
  }

  @Post("admin/users/:id/reset-password")
  resetAdminUserPassword(
    @Param("id") id: string,
    @Body() dto: ResetAdminUserPasswordDto,
    @Req() request: FastifyRequest
  ): ReturnType<AccountService["resetAdminUserPassword"]> {
    return this.accountService.resetAdminUserPassword(request, id, dto);
  }

  @Post("admin/users/:id/force-logout")
  forceLogoutAdminUser(
    @Param("id") id: string,
    @Req() request: FastifyRequest
  ): ReturnType<AccountService["forceLogoutAdminUser"]> {
    return this.accountService.forceLogoutAdminUser(request, id);
  }

  @Get("admin/api-keys")
  adminApiKeys(@Req() request: FastifyRequest): ReturnType<AccountService["listAdminApiKeys"]> {
    return this.accountService.listAdminApiKeys(request);
  }

  @Patch("admin/api-keys/:id")
  updateAdminApiKey(
    @Param("id") id: string,
    @Body() dto: UpdateAdminApiKeyDto,
    @Req() request: FastifyRequest
  ): ReturnType<AccountService["updateAdminApiKey"]> {
    return this.accountService.updateAdminApiKey(request, id, dto);
  }
}
