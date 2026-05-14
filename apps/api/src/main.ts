import "reflect-metadata";
import "dotenv/config";
import multipart from "@fastify/multipart";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { env } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  const multipartPlugin = multipart as unknown as Parameters<NestFastifyApplication["register"]>[0];

  await app.register(multipartPlugin, {
    limits: {
      files: 1,
      fileSize: env.MAX_UPLOAD_MB * 1024 * 1024
    }
  });

  app.setGlobalPrefix("api");
  app.enableCors({ origin: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true
      }
    })
  );

  await app.listen({ host: "0.0.0.0", port: env.API_PORT });
}

void bootstrap();
