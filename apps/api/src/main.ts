import "reflect-metadata";
import "dotenv/config";
import multipart from "@fastify/multipart";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { env } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bodyParser: false });
  const multipartPlugin = multipart as unknown as Parameters<NestFastifyApplication["register"]>[0];
  const fastify = app.getHttpAdapter().getInstance();

  fastify.removeContentTypeParser("application/json");
  fastify.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const source = typeof body === "string" ? body : body.toString();
    if (source.length === 0) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(source) as unknown);
    } catch (error) {
      done(error as Error);
    }
  });

  await app.register(multipartPlugin, {
    limits: {
      files: 1,
      fileSize: env.MAX_UPLOAD_MB * 1024 * 1024
    }
  });

  app.setGlobalPrefix("api");
  app.enableCors({ origin: true, credentials: true });
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
