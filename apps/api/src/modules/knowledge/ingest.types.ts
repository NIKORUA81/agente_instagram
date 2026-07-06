/** Payload del job de la cola `ingest`. El contenido viaja en el job (no en la
 * BD): NestJS crea la fila knowledge_sources y el ai-service la actualiza a
 * ready/failed tras procesar. */
export interface IngestJobData {
  organizationId: string;
  sourceId: string;
  sourceType: string;
  name: string;
  text?: string;
  contentBase64?: string;
  url?: string;
}
