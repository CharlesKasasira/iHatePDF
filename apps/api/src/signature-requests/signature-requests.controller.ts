import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min
} from "class-validator";
import { SignatureRequestsService } from "./signature-requests.service.js";

class CreateSignatureRequestDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsEmail()
  requesterEmail!: string;

  @IsEmail()
  signerEmail!: string;

  @IsOptional()
  @IsString()
  message?: string;
}

class CompleteSignatureRequestDto {
  @IsString()
  @IsNotEmpty()
  signatureDataUrl!: string;

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

  @IsString()
  @IsNotEmpty()
  outputName!: string;
}

@Controller("signature-requests")
export class SignatureRequestsController {
  constructor(private readonly service: SignatureRequestsService) {}

  @Post()
  create(@Body() dto: CreateSignatureRequestDto): Promise<{ id: string; token: string }> {
    return this.service.createRequest(dto);
  }

  @Get(":token")
  getByToken(@Param("token") token: string): Promise<{
    id: string;
    token: string;
    status: string;
    fileName: string;
    expiresAt: Date;
    message: string | null;
  }> {
    return this.service.getByToken(token);
  }

  @Post(":token/complete")
  complete(
    @Param("token") token: string,
    @Body() dto: CompleteSignatureRequestDto
  ): Promise<{ taskId: string }> {
    return this.service.completeByToken(token, dto);
  }
}
