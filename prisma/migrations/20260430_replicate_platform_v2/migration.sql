-- CreateEnum
CREATE TYPE "EvaluationMode" AS ENUM ('SCORING', 'ARENA');

-- CreateEnum
CREATE TYPE "ArenaVerdict" AS ENUM ('LEFT_WINS', 'RIGHT_WINS', 'BOTH_GOOD', 'BOTH_BAD');

-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('MANUAL', 'AUTO_SUGGESTED');

-- CreateEnum
CREATE TYPE "CredentialAuditAction" AS ENUM ('CREATE', 'RESET', 'VIEW', 'DELETE');

-- CreateEnum
CREATE TYPE "CapabilityTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3', 'TIER_4');

-- DropForeignKey
ALTER TABLE "anti_cheat_events" DROP CONSTRAINT "anti_cheat_events_evaluation_item_id_fkey";

-- AlterTable
ALTER TABLE "anti_cheat_events" ADD COLUMN     "arena_item_id" TEXT,
ALTER COLUMN "evaluation_item_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "evaluation_items" ADD COLUMN     "package_id" TEXT,
ADD COLUMN     "watch_progress" JSONB;

-- AlterTable
ALTER TABLE "evaluation_packages" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "evaluation_mode" "EvaluationMode" NOT NULL DEFAULT 'SCORING',
ADD COLUMN     "is_calibration_batch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prompt_suite_id" TEXT,
ADD COLUMN     "start_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "models" ALTER COLUMN "provider" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "age_range" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "education" TEXT,
ADD COLUMN     "gender" TEXT;

-- AlterTable
ALTER TABLE "video_assets" ADD COLUMN     "dataset_id" TEXT,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "oss_key" TEXT,
ADD COLUMN     "signed_url" TEXT;

-- CreateTable
CREATE TABLE "credential_vault" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credential_vault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_access_audit" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "action" "CredentialAuditAction" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "credential_access_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewer_assignments" (
    "id" TEXT NOT NULL,
    "viewer_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT NOT NULL,

    CONSTRAINT "viewer_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aggregated_scores" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "avg_score" DOUBLE PRECISION NOT NULL,
    "count" INTEGER NOT NULL,
    "std_dev" DOUBLE PRECISION NOT NULL,
    "model_id" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aggregated_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arena_items" (
    "id" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "assigned_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "dwell_time_ms" INTEGER,
    "watch_progress_a" JSONB,
    "watch_progress_b" JSONB,
    "verdict" "ArenaVerdict",
    "package_id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "video_asset_a_id" TEXT NOT NULL,
    "video_asset_b_id" TEXT NOT NULL,
    "assigned_to_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "arena_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_suites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "task_type" "TaskType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_suites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_suite_entries" (
    "id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "prompt_suite_id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_suite_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotator_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "organization" TEXT,
    "monthly_quota" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotator_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_memberships" (
    "id" TEXT NOT NULL,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotator_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotator_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tags" (
    "user_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "source" "TagSource" NOT NULL DEFAULT 'MANUAL',
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tags_pkey" PRIMARY KEY ("user_id","tag_id")
);

-- CreateTable
CREATE TABLE "capability_assessments" (
    "id" TEXT NOT NULL,
    "assessment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "consistency" DOUBLE PRECISION NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "detail_oriented" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "composite_score" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "alpha_mean" DOUBLE PRECISION,
    "alpha_std" DOUBLE PRECISION,
    "alpha_ci_low" DOUBLE PRECISION,
    "alpha_ci_high" DOUBLE PRECISION,
    "rank_percentile" DOUBLE PRECISION,
    "tier" "CapabilityTier",
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capability_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calibration_ground_truths" (
    "id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "failure_tag_ids" TEXT[],
    "notes" TEXT,
    "package_id" TEXT NOT NULL,
    "video_asset_id" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calibration_ground_truths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datasets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "video_oss_prefix" TEXT NOT NULL,
    "video_count" INTEGER NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frames" INTEGER,
    "resolution" TEXT,
    "duration" DOUBLE PRECISION,
    "aspect" TEXT,
    "model_id" TEXT NOT NULL,
    "prompt_suite_id" TEXT NOT NULL,
    "image_set_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_sets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_oss_prefix" TEXT NOT NULL,
    "image_count" INTEGER NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prompt_suite_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "oss_key" TEXT NOT NULL,
    "signed_url" TEXT,
    "expires_at" TIMESTAMP(3),
    "image_set_id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PackageDatasets" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PackageDatasets_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "credential_vault_user_id_key" ON "credential_vault"("user_id");

-- CreateIndex
CREATE INDEX "credential_access_audit_target_user_id_timestamp_idx" ON "credential_access_audit"("target_user_id", "timestamp");

-- CreateIndex
CREATE INDEX "credential_access_audit_actor_id_timestamp_idx" ON "credential_access_audit"("actor_id", "timestamp");

-- CreateIndex
CREATE INDEX "viewer_assignments_viewer_id_idx" ON "viewer_assignments"("viewer_id");

-- CreateIndex
CREATE INDEX "viewer_assignments_package_id_idx" ON "viewer_assignments"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "viewer_assignments_viewer_id_package_id_key" ON "viewer_assignments"("viewer_id", "package_id");

-- CreateIndex
CREATE INDEX "aggregated_scores_model_id_idx" ON "aggregated_scores"("model_id");

-- CreateIndex
CREATE INDEX "aggregated_scores_dimension_id_idx" ON "aggregated_scores"("dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "aggregated_scores_date_model_id_dimension_id_key" ON "aggregated_scores"("date", "model_id", "dimension_id");

-- CreateIndex
CREATE INDEX "arena_items_package_id_idx" ON "arena_items"("package_id");

-- CreateIndex
CREATE INDEX "arena_items_assigned_to_id_idx" ON "arena_items"("assigned_to_id");

-- CreateIndex
CREATE INDEX "arena_items_status_idx" ON "arena_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "arena_items_assigned_to_id_package_id_prompt_id_dimension_i_key" ON "arena_items"("assigned_to_id", "package_id", "prompt_id", "dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_suites_name_key" ON "prompt_suites"("name");

-- CreateIndex
CREATE INDEX "prompt_suite_entries_prompt_suite_id_idx" ON "prompt_suite_entries"("prompt_suite_id");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_suite_entries_prompt_suite_id_prompt_id_dimension_id_key" ON "prompt_suite_entries"("prompt_suite_id", "prompt_id", "dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "annotator_groups_name_key" ON "annotator_groups"("name");

-- CreateIndex
CREATE INDEX "group_memberships_group_id_idx" ON "group_memberships"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_user_id_group_id_key" ON "group_memberships"("user_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "annotator_tags_name_key" ON "annotator_tags"("name");

-- CreateIndex
CREATE INDEX "user_tags_tag_id_idx" ON "user_tags"("tag_id");

-- CreateIndex
CREATE INDEX "capability_assessments_user_id_idx" ON "capability_assessments"("user_id");

-- CreateIndex
CREATE INDEX "capability_assessments_assessment_date_idx" ON "capability_assessments"("assessment_date");

-- CreateIndex
CREATE INDEX "calibration_ground_truths_package_id_idx" ON "calibration_ground_truths"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "calibration_ground_truths_package_id_video_asset_id_dimensi_key" ON "calibration_ground_truths"("package_id", "video_asset_id", "dimension_id");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_name_key" ON "datasets"("name");

-- CreateIndex
CREATE INDEX "datasets_task_type_idx" ON "datasets"("task_type");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_model_id_prompt_suite_id_image_set_id_key" ON "datasets"("model_id", "prompt_suite_id", "image_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "image_sets_name_key" ON "image_sets"("name");

-- CreateIndex
CREATE INDEX "images_image_set_id_idx" ON "images"("image_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "images_image_set_id_prompt_id_key" ON "images"("image_set_id", "prompt_id");

-- CreateIndex
CREATE INDEX "_PackageDatasets_B_index" ON "_PackageDatasets"("B");

-- CreateIndex
CREATE INDEX "anti_cheat_events_evaluation_item_id_idx" ON "anti_cheat_events"("evaluation_item_id");

-- CreateIndex
CREATE INDEX "anti_cheat_events_arena_item_id_idx" ON "anti_cheat_events"("arena_item_id");

-- CreateIndex
CREATE INDEX "evaluation_items_package_id_idx" ON "evaluation_items"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_items_assigned_to_id_video_asset_id_dimension_id_key" ON "evaluation_items"("assigned_to_id", "video_asset_id", "dimension_id", "package_id");

-- CreateIndex
CREATE INDEX "video_assets_dataset_id_idx" ON "video_assets"("dataset_id");

-- AddForeignKey
ALTER TABLE "credential_vault" ADD CONSTRAINT "credential_vault_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_access_audit" ADD CONSTRAINT "credential_access_audit_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_access_audit" ADD CONSTRAINT "credential_access_audit_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewer_assignments" ADD CONSTRAINT "viewer_assignments_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewer_assignments" ADD CONSTRAINT "viewer_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewer_assignments" ADD CONSTRAINT "viewer_assignments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "evaluation_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_packages" ADD CONSTRAINT "evaluation_packages_prompt_suite_id_fkey" FOREIGN KEY ("prompt_suite_id") REFERENCES "prompt_suites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "evaluation_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aggregated_scores" ADD CONSTRAINT "aggregated_scores_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aggregated_scores" ADD CONSTRAINT "aggregated_scores_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "dimensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anti_cheat_events" ADD CONSTRAINT "anti_cheat_events_evaluation_item_id_fkey" FOREIGN KEY ("evaluation_item_id") REFERENCES "evaluation_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anti_cheat_events" ADD CONSTRAINT "anti_cheat_events_arena_item_id_fkey" FOREIGN KEY ("arena_item_id") REFERENCES "arena_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_items" ADD CONSTRAINT "arena_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "evaluation_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_items" ADD CONSTRAINT "arena_items_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_items" ADD CONSTRAINT "arena_items_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "dimensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_items" ADD CONSTRAINT "arena_items_video_asset_a_id_fkey" FOREIGN KEY ("video_asset_a_id") REFERENCES "video_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_items" ADD CONSTRAINT "arena_items_video_asset_b_id_fkey" FOREIGN KEY ("video_asset_b_id") REFERENCES "video_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_items" ADD CONSTRAINT "arena_items_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_suite_entries" ADD CONSTRAINT "prompt_suite_entries_prompt_suite_id_fkey" FOREIGN KEY ("prompt_suite_id") REFERENCES "prompt_suites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_suite_entries" ADD CONSTRAINT "prompt_suite_entries_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_suite_entries" ADD CONSTRAINT "prompt_suite_entries_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "dimensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "annotator_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tags" ADD CONSTRAINT "user_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tags" ADD CONSTRAINT "user_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "annotator_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_assessments" ADD CONSTRAINT "capability_assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibration_ground_truths" ADD CONSTRAINT "calibration_ground_truths_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "evaluation_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibration_ground_truths" ADD CONSTRAINT "calibration_ground_truths_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "video_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibration_ground_truths" ADD CONSTRAINT "calibration_ground_truths_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "dimensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_prompt_suite_id_fkey" FOREIGN KEY ("prompt_suite_id") REFERENCES "prompt_suites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_image_set_id_fkey" FOREIGN KEY ("image_set_id") REFERENCES "image_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_sets" ADD CONSTRAINT "image_sets_prompt_suite_id_fkey" FOREIGN KEY ("prompt_suite_id") REFERENCES "prompt_suites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_image_set_id_fkey" FOREIGN KEY ("image_set_id") REFERENCES "image_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PackageDatasets" ADD CONSTRAINT "_PackageDatasets_A_fkey" FOREIGN KEY ("A") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PackageDatasets" ADD CONSTRAINT "_PackageDatasets_B_fkey" FOREIGN KEY ("B") REFERENCES "evaluation_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

