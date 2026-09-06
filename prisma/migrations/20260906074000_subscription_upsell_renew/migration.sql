-- Odoo 19 upsell and renewal: both open a quotation against a running subscription.
-- The quotation records which subscription it came from and why; a confirmed renewal
-- creates a successor subscription and marks its parent RENEWED.
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'RENEWED';

CREATE TYPE "SubscriptionIntent" AS ENUM ('UPSELL', 'RENEWAL');

ALTER TABLE "quotation" ADD COLUMN "subscription_id" INTEGER;
ALTER TABLE "quotation" ADD COLUMN "subscription_intent" "SubscriptionIntent";
ALTER TABLE "quotation"
  ADD CONSTRAINT "quotation_subscription_id_fkey" FOREIGN KEY ("subscription_id")
  REFERENCES "subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "quotation_subscription_id_idx" ON "quotation"("subscription_id");

-- A quotation raised from a subscription must say why, and vice versa.
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_subscription_intent_pairing"
  CHECK (("subscription_id" IS NULL) = ("subscription_intent" IS NULL));

ALTER TABLE "subscription" ADD COLUMN "renewed_from_id" INTEGER;
ALTER TABLE "subscription"
  ADD CONSTRAINT "subscription_renewed_from_id_fkey" FOREIGN KEY ("renewed_from_id")
  REFERENCES "subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "subscription_renewed_from_id_key" ON "subscription"("renewed_from_id");

-- A subscription cannot renew itself.
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_renewed_from_not_self"
  CHECK ("renewed_from_id" IS NULL OR "renewed_from_id" <> "id");
