import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";
import { SignatureEnvelopeRouting, SignatureFieldType } from "@prisma/client";
import { AuthService } from "../auth/auth.service.js";
import { SignatureRequestsService } from "./signature-requests.service.js";

class CreateSignatureRecipientDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsNumber()
  @Min(1)
  routingOrder!: number;
}

class CreateSignatureFieldDto {
  @IsString()
  @IsNotEmpty()
  recipientKey!: string;

  @IsEnum(SignatureFieldType)
  type!: SignatureFieldType;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  placeholder?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsNumber()
  @Min(1)
  page!: number;

  @IsNumber()
  @Min(0)
  x!: number;

  @IsNumber()
  @Min(0)
  y!: number;

  @IsNumber()
  @Min(1)
  @Max(5000)
  width!: number;

  @IsNumber()
  @Min(1)
  @Max(5000)
  height!: number;
}

class CreateSignatureRequestDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsEmail()
  requesterEmail!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsString()
  @IsNotEmpty()
  outputName!: string;

  @IsEnum(SignatureEnvelopeRouting)
  routing!: SignatureEnvelopeRouting;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSignatureRecipientDto)
  recipients!: CreateSignatureRecipientDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSignatureFieldDto)
  fields!: CreateSignatureFieldDto[];
}

class SubmitFieldValueDto {
  @IsString()
  @IsNotEmpty()
  fieldId!: string;

  @IsOptional()
  @IsString()
  textValue?: string;

  @IsOptional()
  @IsBoolean()
  checked?: boolean;

  @IsOptional()
  @IsString()
  signatureDataUrl?: string;
}

class CompleteSignatureRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitFieldValueDto)
  fieldValues!: SubmitFieldValueDto[];
}

class ReassignRecipientDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  role?: string;
}

@Controller("signature-requests")
export class SignatureRequestsController {
  constructor(
    private readonly service: SignatureRequestsService,
    private readonly authService: AuthService
  ) {}

  private async context(request: FastifyRequest): Promise<{ ownerId?: string }> {
    const user = await this.authService.currentUser(request);
    return user ? { ownerId: user.id } : {};
  }

  @Post()
  async create(@Body() dto: CreateSignatureRequestDto, @Req() request: FastifyRequest) {
    return this.service.createRequest(dto, await this.context(request));
  }

  @Get("envelopes/:id")
  async getEnvelope(@Param("id") id: string, @Req() request: FastifyRequest) {
    return this.service.getEnvelope(id, await this.context(request));
  }

  @Post("envelopes/:id/revoke")
  async revoke(@Param("id") id: string, @Req() request: FastifyRequest) {
    return this.service.revokeEnvelope(id, await this.context(request));
  }

  @Post("envelopes/:id/retry-finalization")
  async retryFinalization(@Param("id") id: string, @Req() request: FastifyRequest) {
    return this.service.retryFinalization(id, await this.context(request));
  }

  @Post("envelopes/:id/recipients/:recipientId/remind")
  async remind(@Param("id") id: string, @Param("recipientId") recipientId: string, @Req() request: FastifyRequest) {
    return this.service.remindRecipient(id, recipientId, await this.context(request));
  }

  @Post("envelopes/:id/recipients/:recipientId/reassign")
  async reassign(
    @Param("id") id: string,
    @Param("recipientId") recipientId: string,
    @Body() dto: ReassignRecipientDto,
    @Req() request: FastifyRequest
  ) {
    return this.service.reassignRecipient(id, recipientId, dto, await this.context(request));
  }

  @Get(":token")
  getByToken(@Param("token") token: string) {
    return this.service.getByToken(token);
  }

  @Post(":token/complete")
  complete(@Param("token") token: string, @Body() dto: CompleteSignatureRequestDto) {
    return this.service.completeByToken(token, dto);
  }
}
