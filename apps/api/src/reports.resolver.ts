import { Inject, UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { IncomingMessage } from 'node:http';
import { DemoAuth, DemoAccountGuard, requireDemoOrigin } from './demo-auth.js';
import type { CreateReportDto, ReportFilters } from '../../../libs/contracts/src/index.js';
import { REPORT_REPOSITORY, type ReportRepository } from './repository.js';

@Resolver()
export class ReportsResolver {
  constructor(
    @Inject(REPORT_REPOSITORY) private readonly repository: ReportRepository,
    @Inject(DemoAuth) private readonly auth: DemoAuth,
  ) {}

  @Query('demoAccount')
  @UseGuards(DemoAccountGuard)
  demoAccount(@Context() context: { req: IncomingMessage }) {
    return this.auth.session(context.req)!.account;
  }

  @Query('storage')
  storage() {
    return this.repository.storage;
  }

  @Query('reports')
  reports(@Args() filters: ReportFilters) {
    return this.repository.reports(filters);
  }

  @Query('report')
  report(@Args('id') id: number) {
    return this.repository.report(id);
  }

  @Query('cities')
  cities() {
    return this.repository.cities();
  }

  @Query('quarters')
  quarters() {
    return this.repository.quarters();
  }

  @Mutation('createReport')
  createReport(@Args('createReportInput') input: CreateReportDto) {
    return this.repository.createReport(input);
  }

  @Mutation('setReportCleaned')
  @UseGuards(DemoAccountGuard)
  setReportCleaned(
    @Args('id') id: number,
    @Args('cleaned') cleaned: boolean,
    @Context() context: { req: IncomingMessage },
  ) {
    requireDemoOrigin(context.req);
    return this.repository.setReportCleaned(id, cleaned);
  }
}
