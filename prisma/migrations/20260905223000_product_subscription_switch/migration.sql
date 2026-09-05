-- Subscription becomes a switch on the product (mockup screen 17, Odoo-style boolean)
-- instead of a third product kind. Existing SUBSCRIPTION products become services that
-- are ticked as recurring, billed monthly.
ALTER TABLE "product" ADD COLUMN "is_subscription" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product" ADD COLUMN "recurring_interval" "BillingInterval";

UPDATE "product" SET "is_subscription" = true, "recurring_interval" = 'MONTH' WHERE "kind" = 'SUBSCRIPTION';
UPDATE "product" SET "kind" = 'SERVICE' WHERE "kind" = 'SUBSCRIPTION';

ALTER TYPE "ProductKind" RENAME TO "ProductKind_old";
CREATE TYPE "ProductKind" AS ENUM ('GOOD', 'SERVICE');
ALTER TABLE "product" ALTER COLUMN "kind" TYPE "ProductKind" USING ("kind"::text::"ProductKind");
DROP TYPE "ProductKind_old";

-- A recurring product must say how often it bills.
ALTER TABLE "product" ADD CONSTRAINT "product_subscription_interval_check"
  CHECK (NOT "is_subscription" OR "recurring_interval" IS NOT NULL);
