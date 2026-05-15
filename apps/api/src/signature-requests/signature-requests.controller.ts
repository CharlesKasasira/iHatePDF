import { Body, Controller, Delete, Get, Param, Post, Put, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
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

export class CreateSignatureRecipientDto {
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

  @IsOptional()
  @IsString()
  passcode?: string;
}

export class CreateSignatureFieldDto {
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

export class CreateSignatureRequestDto {
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

export class SubmitFieldValueDto {
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

export class CompleteSignatureRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitFieldValueDto)
  fieldValues!: SubmitFieldValueDto[];
}

export class ReassignRecipientDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  role?: string;
}

class OtpDto {
  @IsString()
  @IsNotEmpty()
  otp!: string;
}

class PasscodeDto {
  @IsString()
  @IsNotEmpty()
  passcode!: string;
}

class SaveTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEmail()
  requesterEmail?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsString()
  @IsNotEmpty()
  outputName!: string;

  @IsEnum(SignatureEnvelopeRouting)
  routing!: SignatureEnvelopeRouting;

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

class SaveTemplateFromEnvelopeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
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

  private evidence(request: FastifyRequest): { ipAddress?: string; userAgent?: string } {
    const forwarded = request.headers["x-forwarded-for"];
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ipAddress = forwardedIp?.split(",")[0]?.trim() || request.ip;
    const userAgentHeader = request.headers["user-agent"];
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader.join(" ") : userAgentHeader;
    return {
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined
    };
  }

  @Post()
  async create(@Body() dto: CreateSignatureRequestDto, @Req() request: FastifyRequest) {
    return this.service.createRequest(dto, await this.context(request), this.evidence(request));
  }

  @Get("templates")
  async listTemplates(@Req() request: FastifyRequest) {
    return this.service.listTemplates(await this.context(request));
  }

  @Post("templates")
  async createTemplate(@Body() dto: SaveTemplateDto, @Req() request: FastifyRequest) {
    return this.service.createTemplate(dto, await this.context(request));
  }

  @Put("templates/:id")
  async updateTemplate(@Param("id") id: string, @Body() dto: SaveTemplateDto, @Req() request: FastifyRequest) {
    return this.service.updateTemplate(id, dto, await this.context(request));
  }

  @Delete("templates/:id")
  async deleteTemplate(@Param("id") id: string, @Req() request: FastifyRequest) {
    return this.service.deleteTemplate(id, await this.context(request));
  }

  @Get("envelopes/:id")
  async getEnvelope(@Param("id") id: string, @Req() request: FastifyRequest) {
    return this.service.getEnvelope(id, await this.context(request));
  }

  @Post("envelopes/:id/revoke")
  async revoke(@Param("id") id: string, @Req() request: FastifyRequest) {
    return this.service.revokeEnvelope(id, await this.context(request), this.evidence(request));
  }

  @Post("envelopes/:id/retry-finalization")
  async retryFinalization(@Param("id") id: string, @Req() request: FastifyRequest) {
    return this.service.retryFinalization(id, await this.context(request), this.evidence(request));
  }

  @Post("envelopes/:id/recipients/:recipientId/remind")
  async remind(@Param("id") id: string, @Param("recipientId") recipientId: string, @Req() request: FastifyRequest) {
    return this.service.remindRecipient(id, recipientId, await this.context(request), this.evidence(request));
  }

  @Post("envelopes/:id/recipients/:recipientId/reassign")
  async reassign(
    @Param("id") id: string,
    @Param("recipientId") recipientId: string,
    @Body() dto: ReassignRecipientDto,
    @Req() request: FastifyRequest
  ) {
    return this.service.reassignRecipient(id, recipientId, dto, await this.context(request), this.evidence(request));
  }

  @Post("envelopes/:id/templates")
  async createTemplateFromEnvelope(
    @Param("id") id: string,
    @Body() dto: SaveTemplateFromEnvelopeDto,
    @Req() request: FastifyRequest
  ) {
    return this.service.createTemplateFromEnvelope(id, dto, await this.context(request));
  }

  @Get("envelopes/:id/audit-certificate")
  async envelopeAuditCertificate(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const certificate = await this.service.createAuditCertificateForEnvelope(id, await this.context(request));
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename=\"${certificate.fileName}\"`);
    reply.send(certificate.buffer);
  }

  @Get(":token")
  getByToken(@Param("token") token: string, @Req() request: FastifyRequest) {
    return this.service.getByToken(token, this.evidence(request));
  }

  @Post(":token/otp/request")
  requestOtp(@Param("token") token: string, @Req() request: FastifyRequest) {
    return this.service.requestOtp(token, this.evidence(request));
  }

  @Post(":token/otp/verify")
  verifyOtp(@Param("token") token: string, @Body() dto: OtpDto, @Req() request: FastifyRequest) {
    return this.service.verifyOtp(token, dto, this.evidence(request));
  }

  @Post(":token/passcode/verify")
  verifyPasscode(@Param("token") token: string, @Body() dto: PasscodeDto, @Req() request: FastifyRequest) {
    return this.service.verifyPasscode(token, dto, this.evidence(request));
  }

  @Get(":token/audit-certificate")
  async tokenAuditCertificate(
    @Param("token") token: string,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const certificate = await this.service.createAuditCertificateForToken(token);
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename=\"${certificate.fileName}\"`);
    reply.send(certificate.buffer);
  }

  @Post(":token/complete")
  complete(@Param("token") token: string, @Body() dto: CompleteSignatureRequestDto, @Req() request: FastifyRequest) {
    return this.service.completeByToken(token, dto, this.evidence(request));
  }
}
