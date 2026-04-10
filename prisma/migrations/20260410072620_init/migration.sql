-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RESEARCHER', 'ANNOTATOR', 'VENDOR_ANNOTATOR', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('T2V', 'I2V');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ScoreValidity" AS ENUM ('VALID', 'SUSPICIOUS', 'INVALID');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('NORMAL', 'LOW_RISK', 'MEDIUM_RISK', 'HIGH_RISK');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ANNOTATOR',
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'NORMAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompts" (
    "id" TEXT NOT NULL,
    "text_zh" TEXT NOT NULL,
    "text_en" TEXT NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "category" TEXT,
    "source_image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimensions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_zh" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "anchor" TEXT,
    "test_points" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failure_tags" (
    "id" TEXT NOT NULL,
    "label_zh" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failure_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_assets" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "duration_sec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "model_id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_items" (
    "id" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "assigned_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "dwell_time_ms" INTEGER,
    "video_asset_id" TEXT NOT NULL,
    "assigned_to_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "evaluation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "failure_tags" TEXT[],
    "comment" TEXT,
    "validity" "ScoreValidity" NOT NULL DEFAULT 'VALID',
    "evaluation_item_id" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anti_cheat_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "payload" JSONB NOT NULL,
    "watch_ratio" DOUBLE PRECISION,
    "dwell_time_ms" INTEGER,
    "evaluation_item_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anti_cheat_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "models_name_key" ON "models"("name");

-- CreateIndex
CREATE UNIQUE INDEX "dimensions_code_key" ON "dimensions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "video_assets_model_id_prompt_id_key" ON "video_assets"("model_id", "prompt_id");

-- CreateIndex
CREATE UNIQUE INDEX "scores_evaluation_item_id_dimension_id_user_id_key" ON "scores"("evaluation_item_id", "dimension_id", "user_id");

-- AddForeignKey
ALTER TABLE "dimensions" ADD CONSTRAINT "dimensions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "dimensions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_tags" ADD CONSTRAINT "failure_tags_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "dimensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "video_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_evaluation_item_id_fkey" FOREIGN KEY ("evaluation_item_id") REFERENCES "evaluation_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "dimensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anti_cheat_events" ADD CONSTRAINT "anti_cheat_events_evaluation_item_id_fkey" FOREIGN KEY ("evaluation_item_id") REFERENCES "evaluation_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anti_cheat_events" ADD CONSTRAINT "anti_cheat_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
