import { Controller, Get, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AccountService } from "./account.service.js";

@Controller("account")
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get("activity")
  activity(@Req() request: FastifyRequest): ReturnType<AccountService["activity"]> {
    return this.accountService.activity(request);
  }
}
