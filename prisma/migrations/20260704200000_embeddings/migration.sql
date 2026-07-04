-- Enable pgvector and add embedding columns for semantic memory + similarity edges.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Event" ADD COLUMN "embedding" vector(1536);
ALTER TABLE "Conversation" ADD COLUMN "embedding" vector(1536);
ALTER TABLE "ChatMessage" ADD COLUMN "embedding" vector(1536);
