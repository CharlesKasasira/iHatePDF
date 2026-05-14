import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
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

export class JpgToPdfDto {
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

export class RemovePagesDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  pageRanges!: string[];

  @IsString()
  @IsNotEmpty()
  outputName!: string;
}

export class ExtractPagesDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  pageRanges!: string[];

  @IsString()
  @IsNotEmpty()
  outputName!: string;
}

export class OrganizePdfDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  pageOrder!: number[];

  @IsString()
  @IsNotEmpty()
  outputName!: string;
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
  @IsIn(["sans", "serif", "mono"])
  fontFamily!: "sans" | "serif" | "mono";

  @IsBoolean()
  bold!: boolean;

  @IsBoolean()
  italic!: boolean;

  @IsBoolean()
  underline!: boolean;

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

export class EditPageRotationDto {
  @IsInt()
  @Min(1)
  page!: number;

  @IsInt()
  @IsIn([90, 180, 270])
  degrees!: 90 | 180 | 270;
}

export class EditPageNumbersDto {
  @IsInt()
  @Min(1)
  @Max(100000)
  startAt!: number;

  @IsNumber()
  @Min(6)
  @Max(72)
  fontSize!: number;

  @IsString()
  @IsHexColor()
  color!: string;

  @IsString()
  @IsIn([
    "top-left",
    "top-center",
    "top-right",
    "bottom-left",
    "bottom-center",
    "bottom-right"
  ])
  position!: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

  @IsNumber()
  @Min(0)
  @Max(144)
  margin!: number;

  @IsOptional()
  @IsString()
  prefix?: string;
}

export class EditWatermarkDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsNumber()
  @Min(18)
  @Max(240)
  fontSize!: number;

  @IsString()
  @IsHexColor()
  color!: string;

  @IsNumber()
  @Min(0.05)
  @Max(0.95)
  opacity!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  rotation!: number;
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditPageRotationDto)
  @ArrayMaxSize(200)
  @IsOptional()
  pageRotations?: EditPageRotationDto[];

  @ValidateNested()
  @Type(() => EditPageNumbersDto)
  @IsOptional()
  pageNumbers?: EditPageNumbersDto;

  @ValidateNested()
  @Type(() => EditWatermarkDto)
  @IsOptional()
  watermark?: EditWatermarkDto;

  @IsString()
  @IsNotEmpty()
  outputName!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  retentionHours?: number;
}
