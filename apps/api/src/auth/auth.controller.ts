import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
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
  signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<SafeUser> {
    return this.authService.signup(dto, reply);
  }

  @Post("login")
  @RateLimit("login")
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<SafeUser> {
    return this.authService.login(dto, reply);
  }

  @Post("logout")
  logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ ok: true }> {
    return this.authService.logout(request, reply);
  }

  @Get("me")
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
