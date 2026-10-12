-- CreateIndex
CREATE INDEX "Message_recipientIds_idx" ON "Message" USING GIN ("recipientIds" array_ops);
