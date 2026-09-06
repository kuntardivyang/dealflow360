-- Time-based pricing (Odoo): one product, many recurring plans, a price for each.
CREATE TABLE "product_plan_price" (
  "id" SERIAL NOT NULL,
  "product_id" INTEGER NOT NULL,
  "plan_id" INTEGER NOT NULL,
  "price" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_plan_price_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_plan_price_product_id_plan_id_key" ON "product_plan_price"("product_id", "plan_id");
ALTER TABLE "product_plan_price" ADD CONSTRAINT "product_plan_price_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_plan_price" ADD CONSTRAINT "product_plan_price_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "recurring_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_plan_price" ADD CONSTRAINT "product_plan_price_non_negative" CHECK ("price" >= 0);
