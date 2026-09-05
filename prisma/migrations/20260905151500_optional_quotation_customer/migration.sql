-- A quotation starts without a customer (Odoo-style form: the rep picks the customer in the header).
ALTER TABLE "quotation" ALTER COLUMN "customer_id" DROP NOT NULL;
