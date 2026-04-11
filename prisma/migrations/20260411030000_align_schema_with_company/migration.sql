-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('INTERNAL', 'VENDOR');

-- DropForeignKey
ALTER TABLE "evaluation_items" DROP CONSTRAINT "evaluation_items_dimension_id_fkey";

-- AlterTable
ALTER TABLE "evaluation_items" ALTER COLUMN "dimension_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "evaluation_packages" ADD COLUMN     "recalled_at" TIMESTAMP(3),
ALTER COLUMN "video_count" DROP DEFAULT,
ALTER COLUMN "annotator_count" DROP DEFAULT;

-- AlterTable
ALTER TABLE "prompts" ADD COLUMN     "external_id" TEXT NOT NULL,
ADD COLUMN     "source_image_prompt" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "account_type" "AccountType" NOT NULL DEFAULT 'INTERNAL';

-- AlterTable
ALTER TABLE "video_assets" ALTER COLUMN "fps" SET DATA TYPE INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_packages_name_key" ON "evaluation_packages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "prompts_external_id_key" ON "prompts"("external_id");

-- AddForeignKey
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "dimensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
