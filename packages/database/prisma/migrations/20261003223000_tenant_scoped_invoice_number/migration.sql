-- Scope invoice numbers to the school that issues them.
--
-- `FeeInvoice.invoiceNumber` carried a global `@unique`, but
-- `generateInvoiceNumber` (packages/domain/src/finance.ts) counts invoices for
-- (tenantId, schoolId, year) and renders `INV-<year>-<count+1>`. Two schools in
-- one tenant therefore both begin a year at `INV-2026-0001`, and the second
-- school's first insert failed on the global constraint.
--
-- Replacing the single-column unique with the composite the generator actually
-- counts on is safe against existing data: a subset constraint cannot collide
-- with rows that already satisfied the stricter one.
--
-- Hand-authored rather than produced by `prisma migrate dev`, which needs a
-- shadow database and can offer to reset the target. Verify with:
--   bunx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <url>

-- DropIndex
DROP INDEX "FeeInvoice_invoiceNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "FeeInvoice_tenantId_schoolId_invoiceNumber_key" ON "FeeInvoice"("tenantId", "schoolId", "invoiceNumber");
