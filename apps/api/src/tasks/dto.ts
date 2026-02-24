import {
  ArrayMaxSize,
  IsArray,
  IsHexColor,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";

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

export class UnlockPdfDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  outputName!: string;
}

export class ConvertPdfDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsString()
  @IsNotEmpty()
  outputName!: string;
}

export class EditTextDto {
  @IsInt()
  @Min(1)
  page!: number;

  @IsNumber()
  @Min(0)
  x!: number;

  @IsNumber()
  @Min(0)
  y!: number;

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsNumber()
  @Min(4)
  @Max(400)
  fontSize!: number;

  @IsString()
  @IsHexColor()
  color!: string;
}

export class EditRectangleDto {
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
  @IsHexColor()
  color!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  opacity!: number;
}

export class EditImageDto {
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
  @Matches(/^data:image\//)
  dataUrl!: string;
}

export class EditPdfDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditTextDto)
  @ArrayMaxSize(200)
  @IsOptional()
  textEdits?: EditTextDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditRectangleDto)
  @ArrayMaxSize(200)
  @IsOptional()
  rectangleEdits?: EditRectangleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditImageDto)
  @ArrayMaxSize(50)
  @IsOptional()
  imageEdits?: EditImageDto[];

  @IsString()
  @IsNotEmpty()
  outputName!: string;
}
