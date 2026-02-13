import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  MinLength,
  Max,
  Min
} from "class-validator";

export class MergePdfDto {
  @IsArray()
  @IsString({ each: true })
  fileIds!: string[];

  @IsString()
  @IsNotEmpty()
  outputName!: string;
}

export class SplitPdfDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsArray()
  @IsString({ each: true })
  pageRanges!: string[];

  @IsString()
  @IsNotEmpty()
  outputPrefix!: string;
}

export class SignPdfDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsString()
  @IsNotEmpty()
  signatureDataUrl!: string;

  @IsInt()
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

export class CompressPdfDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsString()
  @IsNotEmpty()
  outputName!: string;
}

export class ProtectPdfDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  password!: string;

  @IsString()
  @IsNotEmpty()
  outputName!: string;
}
