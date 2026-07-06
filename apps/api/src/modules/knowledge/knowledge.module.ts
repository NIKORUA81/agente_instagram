import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CatalogService } from './catalog.service';
import { IngestProcessor } from './ingest.processor';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [AiModule], // provee AiClientService para la ingesta
  controllers: [KnowledgeController],
  providers: [KnowledgeService, CatalogService, IngestProcessor],
})
export class KnowledgeModule {}
