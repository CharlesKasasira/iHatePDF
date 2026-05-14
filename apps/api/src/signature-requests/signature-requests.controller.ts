import { Body, Controller, Get, Param, Post } from "@nestjs/common";
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
  constructor(private readonly service: SignatureRequestsService) {}

  @Post()
  create(@Body() dto: CreateSignatureRequestDto) {
    return this.service.createRequest(dto);
  }

  @Get("envelopes/:id")
  getEnvelope(@Param("id") id: string) {
    return this.service.getEnvelope(id);
  }

  @Post("envelopes/:id/revoke")
  revoke(@Param("id") id: string) {
    return this.service.revokeEnvelope(id);
  }

  @Post("envelopes/:id/retry-finalization")
  retryFinalization(@Param("id") id: string) {
    return this.service.retryFinalization(id);
  }

  @Post("envelopes/:id/recipients/:recipientId/remind")
  remind(@Param("id") id: string, @Param("recipientId") recipientId: string) {
    return this.service.remindRecipient(id, recipientId);
  }

  @Post("envelopes/:id/recipients/:recipientId/reassign")
  reassign(
    @Param("id") id: string,
    @Param("recipientId") recipientId: string,
    @Body() dto: ReassignRecipientDto
  ) {
    return this.service.reassignRecipient(id, recipientId, dto);
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
