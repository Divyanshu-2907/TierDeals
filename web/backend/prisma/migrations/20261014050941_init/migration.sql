-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('COLLECTION_QUANTITY_TIERS', 'CART_SUBTOTAL_TIERS', 'FREE_SHIPPING_THRESHOLD');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SYNCED', 'PENDING', 'OUT_OF_SYNC');

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "RuleType" NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "combinesWithProductDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "combinesWithOrderDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "combinesWithShippingDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "shopifyDiscountId" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountApplication" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "ruleId" TEXT,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "discountTitle" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "orderCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rule_shop_active_idx" ON "Rule"("shop", "active");

-- CreateIndex
CREATE INDEX "Rule_shop_createdAt_idx" ON "Rule"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_shop_shopifyDiscountId_key" ON "Rule"("shop", "shopifyDiscountId");

-- CreateIndex
CREATE INDEX "DiscountApplication_shop_orderCreatedAt_idx" ON "DiscountApplication"("shop", "orderCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountApplication_orderId_ruleId_discountTitle_key" ON "DiscountApplication"("orderId", "ruleId", "discountTitle");

-- CreateIndex
CREATE INDEX "ProcessedWebhook_shop_processedAt_idx" ON "ProcessedWebhook"("shop", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhook_webhookId_topic_key" ON "ProcessedWebhook"("webhookId", "topic");

-- AddForeignKey
ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
