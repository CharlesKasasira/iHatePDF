import { Body, Controller, Get, Header, Post, Req, Res } from "@nestjs/common";
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { AuthService, type SafeUser } from "./auth.service.js";

class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

class DesktopDeviceKeyDto extends LoginDto {
  @IsString()
  @IsNotEmpty()
  deviceName!: string;
}

class PasswordResetRequestDto {
  @IsEmail()
  email!: string;
}

class PasswordResetConfirmDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("signup")
  @RateLimit("signup")
  @Header("Cache-Control", "no-store")
  signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<SafeUser> {
    return this.authService.signup(dto, reply);
  }

  @Post("login")
  @RateLimit("login")
  @Header("Cache-Control", "no-store")
  login(
    @Body() dto: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<SafeUser> {
    return this.authService.login(dto, request, reply);
  }

  @Post("desktop-device-key")
  @RateLimit("login")
  @Header("Cache-Control", "no-store")
  createDesktopDeviceKey(
    @Body() dto: DesktopDeviceKeyDto,
    @Req() request: FastifyRequest
  ): ReturnType<AuthService["createDesktopDeviceKey"]> {
    return this.authService.createDesktopDeviceKey(dto, request);
  }

  @Post("logout")
  @Header("Cache-Control", "no-store")
  logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ ok: true }> {
    return this.authService.logout(request, reply);
  }

  @Get("me")
  @Header("Cache-Control", "no-store")
  me(@Req() request: FastifyRequest): Promise<SafeUser | null> {
    return this.authService.currentUser(request);
  }

  @Post("password-reset/request")
  @RateLimit("passwordReset")
  requestPasswordReset(@Body() dto: PasswordResetRequestDto): Promise<{ ok: true }> {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post("password-reset/confirm")
  @RateLimit("passwordReset")
  confirmPasswordReset(@Body() dto: PasswordResetConfirmDto): Promise<{ ok: true }> {
    return this.authService.confirmPasswordReset(dto);
  }
}
