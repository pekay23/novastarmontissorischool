-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "allergies" TEXT,
ADD COLUMN     "dietaryConcerns" TEXT,
ADD COLUMN     "healthDeclaredAt" TIMESTAMP(3),
ADD COLUMN     "healthDeclaredByParent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "medicalConditions" TEXT;

-- CreateTable
CREATE TABLE "StudentHealthDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "supersedesId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentHealthDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentHealthDocument_storageKey_key" ON "StudentHealthDocument"("storageKey");

-- CreateIndex
CREATE INDEX "StudentHealthDocument_tenantId_studentId_idx" ON "StudentHealthDocument"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "StudentHealthDocument_tenantId_studentId_uploadedAt_idx" ON "StudentHealthDocument"("tenantId", "studentId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "StudentHealthDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
