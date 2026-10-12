-- The recipient index is being retyped, not added: the init migration already
-- creates it as a plain B-tree on recipientIds. Prisma cannot express the GIN
-- operator class in the schema DSL, so the index is declared with raw() there
-- and swapped here. Dropping first is required -- a same-name CREATE on an
-- existing index fails -- and it is index-only, so no table is rewritten.
--
-- DropIndex
DROP INDEX "Message_recipientIds_idx";

-- CreateIndex
CREATE INDEX "Message_recipientIds_idx" ON "Message" USING GIN ("recipientIds" array_ops);
