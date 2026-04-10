-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RECALLED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "evaluation_items" ADD COLUMN     "dimension_id" TEXT;

-- AlterTable
ALTER TABLE "video_assets" ADD COLUMN     "fps" DOUBLE PRECISION,
ADD COLUMN     "package_id" TEXT;

-- CreateTable
CREATE TABLE "evaluation_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "task_type" "TaskType" NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'DRAFT',
    "deadline" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "model_checkpoint" TEXT,
    "video_count" INTEGER NOT NULL DEFAULT 0,
    "annotator_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "evaluation_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "dimensions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
