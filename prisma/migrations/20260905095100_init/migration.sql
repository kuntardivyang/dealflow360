-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SALES_REP', 'SALES_MANAGER', 'FINANCE');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('GOOD', 'SERVICE', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('WEEK', 'MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "ProrationMode" AS ENUM ('DAY_BASED', 'NONE');

-- CreateEnum
CREATE TYPE "CancelPolicy" AS ENUM ('END_OF_PERIOD', 'IMMEDIATE_PRORATED_REFUND', 'NO_REFUND');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('CREDIT_NOTE', 'REFUND_PAYMENT');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'UNDER_NEGOTIATION', 'CONFIRMED', 'FULFILLMENT', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "LineSource" AS ENUM ('MANUAL', 'UPSELL', 'PORTAL');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'CONTACT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "StockMoveType" AS ENUM ('RESERVE', 'RELEASE', 'SHIP', 'RECEIPT', 'ADJUST');

-- CreateEnum
CREATE TYPE "FulfillmentPlanStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('RESERVED', 'SHIPPED');

-- CreateEnum
CREATE TYPE "PromptStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('SCHEDULED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionChangeType" AS ENUM ('QUANTITY', 'PLAN', 'CANCEL');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('ONE_TIME', 'RECURRING', 'PRORATION');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('POSTED', 'PARTIAL', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('OPEN', 'APPLIED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PortalRequestType" AS ENUM ('COMMENT', 'CHANGE_REQUEST', 'COUNTER_DISCOUNT');

-- CreateEnum
CREATE TYPE "PortalRequestStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('STALLED', 'DISCOUNT_ANOMALY', 'DELIVERY_SLIPPAGE');

-- CreateTable
CREATE TABLE "app_user" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SALES_REP',
    "manager_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "discount_ceiling_bp" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "tier_id" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_session" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_login_token" (
    "id" SERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "quotation_id" INTEGER,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_login_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "discount_ceiling_bp" INTEGER,
    "min_margin_bp" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ProductKind" NOT NULL,
    "category_id" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Each',
    "list_price" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "tax_bp" INTEGER NOT NULL DEFAULT 1800,
    "is_promoted" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" INTEGER,
    "variant_label" TEXT,
    "extra_price" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricelist_rule" (
    "id" SERIAL NOT NULL,
    "tier_id" INTEGER NOT NULL,
    "category_id" INTEGER,
    "product_id" INTEGER,
    "discount_bp" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricelist_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_pairing" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "paired_product_id" INTEGER NOT NULL,
    "co_count" INTEGER NOT NULL,

    CONSTRAINT "product_pairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_rule" (
    "id" SERIAL NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "min_score" INTEGER NOT NULL,
    "max_worst_overage_bp" INTEGER,
    "max_order_total" INTEGER,
    "chain" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "w_worst" INTEGER NOT NULL DEFAULT 50,
    "w_blended" INTEGER NOT NULL DEFAULT 40,
    "w_margin" INTEGER NOT NULL DEFAULT 10,
    "norm_worst_bp" INTEGER NOT NULL DEFAULT 1000,
    "norm_blended_bp" INTEGER NOT NULL DEFAULT 500,
    "norm_margin_bp" INTEGER NOT NULL DEFAULT 1000,
    "floor_margin_bp" INTEGER NOT NULL DEFAULT 2000,
    "stalled_days" INTEGER NOT NULL DEFAULT 3,
    "anomaly_z" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "anomaly_abs_bp" INTEGER NOT NULL DEFAULT 1000,
    "min_history" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" INTEGER,

    CONSTRAINT "risk_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "quotation" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "rep_user_id" INTEGER NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "order_discount_bp" INTEGER NOT NULL DEFAULT 0,
    "gross_total" INTEGER NOT NULL DEFAULT 0,
    "discount_total" INTEGER NOT NULL DEFAULT 0,
    "net_total" INTEGER NOT NULL DEFAULT 0,
    "tax_total" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "cost_total" INTEGER NOT NULL DEFAULT 0,
    "margin_bp" INTEGER,
    "risk_score" INTEGER,
    "risk_breakdown" JSONB,
    "approval_version" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "negotiation_pending" BOOLEAN NOT NULL DEFAULT false,
    "promised_date" DATE,
    "notes" TEXT,
    "sent_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_contact_id" INTEGER,
    "confirmed_name" TEXT,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_line" (
    "id" SERIAL NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "plan_id" INTEGER,
    "line_type" "LineType" NOT NULL DEFAULT 'ONE_TIME',
    "source" "LineSource" NOT NULL DEFAULT 'MANUAL',
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "unit_cost" INTEGER NOT NULL,
    "tax_bp" INTEGER NOT NULL,
    "discount_bp" INTEGER NOT NULL DEFAULT 0,
    "effective_discount_bp" INTEGER NOT NULL DEFAULT 0,
    "ceiling_bp" INTEGER NOT NULL,
    "pricelist_rule_id" INTEGER,
    "gross" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_request" (
    "id" SERIAL NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "risk_score" INTEGER NOT NULL,
    "risk_breakdown" JSONB NOT NULL,
    "chain" JSONB NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_step" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "step_no" INTEGER NOT NULL,
    "required_role" "Role" NOT NULL,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
    "acted_by_id" INTEGER,
    "acted_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "approval_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "quotation_id" INTEGER,
    "action" TEXT NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" INTEGER,
    "actor_name" TEXT NOT NULL,
    "actor_role" TEXT,
    "reason" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "ship_cost_weight" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_level" (
    "id" SERIAL NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "reorder_point" INTEGER NOT NULL DEFAULT 0,
    "lead_days" INTEGER NOT NULL DEFAULT 7,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_move" (
    "id" SERIAL NOT NULL,
    "stock_level_id" INTEGER NOT NULL,
    "type" "StockMoveType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "quotation_id" INTEGER,
    "shipment_id" INTEGER,
    "note" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_move_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_plan" (
    "id" SERIAL NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "status" "FulfillmentPlanStatus" NOT NULL DEFAULT 'PROPOSED',
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "shipment_count" INTEGER NOT NULL DEFAULT 0,
    "est_cost" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "created_by_id" INTEGER,
    "accepted_by_id" INTEGER,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'RESERVED',
    "ship_cost" INTEGER NOT NULL DEFAULT 0,
    "shipped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_line" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "quotation_line_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER,
    "shipment_id" INTEGER,
    "qty" INTEGER NOT NULL,
    "is_backorder" BOOLEAN NOT NULL DEFAULT false,
    "expected_date" DATE,

    CONSTRAINT "fulfillment_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_prompt" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'CONSOLIDATE_BACKORDER',
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "status" "PromptStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "fulfillment_prompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_plan" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "periods" INTEGER NOT NULL DEFAULT 12,
    "proration_mode" "ProrationMode" NOT NULL DEFAULT 'DAY_BASED',
    "bill_change_day" BOOLEAN NOT NULL DEFAULT true,
    "cancel_policy" "CancelPolicy" NOT NULL DEFAULT 'IMMEDIATE_PRORATED_REFUND',
    "refund_method" "RefundMethod" NOT NULL DEFAULT 'CREDIT_NOTE',
    "product_id" INTEGER,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "quotation_id" INTEGER,
    "quotation_line_id" INTEGER,
    "product_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "discount_bp" INTEGER NOT NULL DEFAULT 0,
    "tax_bp" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "anchor_date" DATE NOT NULL,
    "current_period_start" DATE NOT NULL,
    "current_period_end" DATE NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancel_effective" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_schedule" (
    "id" SERIAL NOT NULL,
    "subscription_id" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "bill_date" DATE NOT NULL,
    "net" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "invoice_id" INTEGER,

    CONSTRAINT "billing_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_change" (
    "id" SERIAL NOT NULL,
    "subscription_id" INTEGER NOT NULL,
    "type" "SubscriptionChangeType" NOT NULL,
    "effective_date" DATE NOT NULL,
    "old_qty" INTEGER,
    "new_qty" INTEGER,
    "days_in_period" INTEGER,
    "remaining_days" INTEGER,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "charge" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL DEFAULT 0,
    "invoice_id" INTEGER,
    "credit_note_id" INTEGER,
    "note" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "quotation_id" INTEGER,
    "subscription_id" INTEGER,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'POSTED',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "tax_total" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "quotation_line_id" INTEGER,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "discount_bp" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL,
    "tax_bp" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "invoice_id" INTEGER,
    "subscription_id" INTEGER,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'OPEN',
    "applied_to_invoice_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "client_ref" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" INTEGER,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_request" (
    "id" SERIAL NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "line_id" INTEGER,
    "contact_id" INTEGER NOT NULL,
    "type" "PortalRequestType" NOT NULL,
    "message" TEXT,
    "proposed_discount_bp" INTEGER,
    "requested_delivery_date" DATE,
    "status" "PortalRequestStatus" NOT NULL DEFAULT 'OPEN',
    "response_note" TEXT,
    "responded_by_id" INTEGER,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_alert" (
    "id" SERIAL NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "last_nudged_at" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),

    CONSTRAINT "deal_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tier_name_key" ON "customer_tier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "customer_public_id_key" ON "customer"("public_id");

-- CreateIndex
CREATE INDEX "customer_tier_id_idx" ON "customer"("tier_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contact_email_key" ON "customer_contact"("email");

-- CreateIndex
CREATE INDEX "customer_contact_customer_id_idx" ON "customer_contact"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_session_token_key" ON "portal_session"("token");

-- CreateIndex
CREATE INDEX "portal_session_contact_id_idx" ON "portal_session"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_login_token_token_hash_key" ON "portal_login_token"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "product_category_name_key" ON "product_category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_sku_key" ON "product"("sku");

-- CreateIndex
CREATE INDEX "product_category_id_idx" ON "product"("category_id");

-- CreateIndex
CREATE INDEX "product_parent_id_idx" ON "product"("parent_id");

-- CreateIndex
CREATE INDEX "pricelist_rule_tier_id_idx" ON "pricelist_rule"("tier_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_pairing_product_id_paired_product_id_key" ON "product_pairing"("product_id", "paired_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_rule_sequence_key" ON "approval_rule"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_public_id_key" ON "quotation"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_number_key" ON "quotation"("number");

-- CreateIndex
CREATE INDEX "quotation_status_idx" ON "quotation"("status");

-- CreateIndex
CREATE INDEX "quotation_rep_user_id_last_activity_at_idx" ON "quotation"("rep_user_id", "last_activity_at");

-- CreateIndex
CREATE INDEX "quotation_customer_id_idx" ON "quotation"("customer_id");

-- CreateIndex
CREATE INDEX "quotation_line_quotation_id_idx" ON "quotation_line"("quotation_id");

-- CreateIndex
CREATE INDEX "quotation_line_product_id_idx" ON "quotation_line"("product_id");

-- CreateIndex
CREATE INDEX "approval_request_status_idx" ON "approval_request"("status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_quotation_id_version_key" ON "approval_request"("quotation_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "approval_step_request_id_step_no_key" ON "approval_step"("request_id", "step_no");

-- CreateIndex
CREATE INDEX "audit_log_quotation_id_at_idx" ON "audit_log"("quotation_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_at_idx" ON "audit_log"("entity_type", "entity_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_name_key" ON "warehouse"("name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_level_warehouse_id_product_id_key" ON "stock_level"("warehouse_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_move_stock_level_id_created_at_idx" ON "stock_move"("stock_level_id", "created_at");

-- CreateIndex
CREATE INDEX "fulfillment_plan_quotation_id_idx" ON "fulfillment_plan"("quotation_id");

-- CreateIndex
CREATE INDEX "shipment_plan_id_idx" ON "shipment"("plan_id");

-- CreateIndex
CREATE INDEX "fulfillment_line_plan_id_idx" ON "fulfillment_line"("plan_id");

-- CreateIndex
CREATE INDEX "fulfillment_prompt_plan_id_status_idx" ON "fulfillment_prompt"("plan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_plan_name_key" ON "recurring_plan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_public_id_key" ON "subscription"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_quotation_line_id_key" ON "subscription"("quotation_line_id");

-- CreateIndex
CREATE INDEX "subscription_customer_id_idx" ON "subscription"("customer_id");

-- CreateIndex
CREATE INDEX "subscription_status_idx" ON "subscription"("status");

-- CreateIndex
CREATE INDEX "billing_schedule_subscription_id_period_start_idx" ON "billing_schedule"("subscription_id", "period_start");

-- CreateIndex
CREATE INDEX "subscription_change_subscription_id_idx" ON "subscription_change"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_public_id_key" ON "invoice"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_key" ON "invoice"("number");

-- CreateIndex
CREATE INDEX "invoice_quotation_id_idx" ON "invoice"("quotation_id");

-- CreateIndex
CREATE INDEX "invoice_customer_id_idx" ON "invoice"("customer_id");

-- CreateIndex
CREATE INDEX "invoice_status_idx" ON "invoice"("status");

-- CreateIndex
CREATE INDEX "invoice_line_invoice_id_idx" ON "invoice_line"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_number_key" ON "credit_note"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_client_ref_key" ON "payment"("client_ref");

-- CreateIndex
CREATE INDEX "payment_invoice_id_idx" ON "payment"("invoice_id");

-- CreateIndex
CREATE INDEX "portal_request_quotation_id_status_idx" ON "portal_request"("quotation_id", "status");

-- CreateIndex
CREATE INDEX "deal_alert_quotation_id_type_idx" ON "deal_alert"("quotation_id", "type");

-- CreateIndex
CREATE INDEX "deal_alert_resolved_at_idx" ON "deal_alert"("resolved_at");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "customer_tier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact" ADD CONSTRAINT "customer_contact_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "customer_contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_login_token" ADD CONSTRAINT "portal_login_token_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "customer_contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricelist_rule" ADD CONSTRAINT "pricelist_rule_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "customer_tier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricelist_rule" ADD CONSTRAINT "pricelist_rule_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricelist_rule" ADD CONSTRAINT "pricelist_rule_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_pairing" ADD CONSTRAINT "product_pairing_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_pairing" ADD CONSTRAINT "product_pairing_paired_product_id_fkey" FOREIGN KEY ("paired_product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_rep_user_id_fkey" FOREIGN KEY ("rep_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "recurring_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_acted_by_id_fkey" FOREIGN KEY ("acted_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_stock_level_id_fkey" FOREIGN KEY ("stock_level_id") REFERENCES "stock_level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_plan" ADD CONSTRAINT "fulfillment_plan_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "fulfillment_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_line" ADD CONSTRAINT "fulfillment_line_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "fulfillment_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_line" ADD CONSTRAINT "fulfillment_line_quotation_line_id_fkey" FOREIGN KEY ("quotation_line_id") REFERENCES "quotation_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_line" ADD CONSTRAINT "fulfillment_line_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_line" ADD CONSTRAINT "fulfillment_line_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_prompt" ADD CONSTRAINT "fulfillment_prompt_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "fulfillment_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_plan" ADD CONSTRAINT "recurring_plan_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_quotation_line_id_fkey" FOREIGN KEY ("quotation_line_id") REFERENCES "quotation_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "recurring_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_schedule" ADD CONSTRAINT "billing_schedule_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_schedule" ADD CONSTRAINT "billing_schedule_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_change" ADD CONSTRAINT "subscription_change_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_quotation_line_id_fkey" FOREIGN KEY ("quotation_line_id") REFERENCES "quotation_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_applied_to_invoice_id_fkey" FOREIGN KEY ("applied_to_invoice_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_request" ADD CONSTRAINT "portal_request_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_request" ADD CONSTRAINT "portal_request_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "quotation_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_request" ADD CONSTRAINT "portal_request_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "customer_contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_alert" ADD CONSTRAINT "deal_alert_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Database level guards (hand written). Application validation runs first;
-- these make the invariants hold even for direct SQL.
-- ---------------------------------------------------------------------------

-- basis points are always within 0..100 percent
ALTER TABLE "customer_tier"    ADD CONSTRAINT "customer_tier_ceiling_bp_range"   CHECK ("discount_ceiling_bp" BETWEEN 0 AND 10000);
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_ceiling_bp_range" CHECK ("discount_ceiling_bp" IS NULL OR "discount_ceiling_bp" BETWEEN 0 AND 10000);
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_min_margin_range" CHECK ("min_margin_bp" BETWEEN 0 AND 10000);
ALTER TABLE "product"          ADD CONSTRAINT "product_tax_bp_range"             CHECK ("tax_bp" BETWEEN 0 AND 10000);
ALTER TABLE "product"          ADD CONSTRAINT "product_prices_non_negative"      CHECK ("list_price" >= 0 AND "cost" >= 0 AND "extra_price" >= 0);
ALTER TABLE "pricelist_rule"   ADD CONSTRAINT "pricelist_rule_discount_bp_range" CHECK ("discount_bp" BETWEEN 0 AND 10000);
ALTER TABLE "quotation"        ADD CONSTRAINT "quotation_order_discount_bp_range" CHECK ("order_discount_bp" BETWEEN 0 AND 10000);
ALTER TABLE "quotation_line"   ADD CONSTRAINT "quotation_line_discount_bp_range" CHECK ("discount_bp" BETWEEN 0 AND 10000 AND "effective_discount_bp" BETWEEN 0 AND 10000);
ALTER TABLE "quotation_line"   ADD CONSTRAINT "quotation_line_ceiling_bp_range"  CHECK ("ceiling_bp" BETWEEN 0 AND 10000);
ALTER TABLE "quotation_line"   ADD CONSTRAINT "quotation_line_tax_bp_range"      CHECK ("tax_bp" BETWEEN 0 AND 10000);
ALTER TABLE "portal_request"   ADD CONSTRAINT "portal_request_proposed_bp_range" CHECK ("proposed_discount_bp" IS NULL OR "proposed_discount_bp" BETWEEN 0 AND 10000);
ALTER TABLE "subscription"     ADD CONSTRAINT "subscription_discount_bp_range"   CHECK ("discount_bp" BETWEEN 0 AND 10000);
ALTER TABLE "approval_rule"    ADD CONSTRAINT "approval_rule_min_score_range"    CHECK ("min_score" BETWEEN 0 AND 100);

-- quantities and prices
ALTER TABLE "quotation_line"   ADD CONSTRAINT "quotation_line_qty_positive"      CHECK ("qty" > 0);
ALTER TABLE "quotation_line"   ADD CONSTRAINT "quotation_line_prices_non_negative" CHECK ("unit_price" >= 0 AND "unit_cost" >= 0);
ALTER TABLE "fulfillment_line" ADD CONSTRAINT "fulfillment_line_qty_positive"    CHECK ("qty" > 0);
ALTER TABLE "subscription"     ADD CONSTRAINT "subscription_qty_positive"        CHECK ("qty" > 0);
ALTER TABLE "invoice_line"     ADD CONSTRAINT "invoice_line_qty_positive"        CHECK ("qty" > 0);

-- stock can never go negative and reservations can never exceed stock
ALTER TABLE "stock_level"      ADD CONSTRAINT "stock_level_non_negative"         CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "reserved" <= "on_hand");
ALTER TABLE "stock_move"       ADD CONSTRAINT "stock_move_qty_positive"          CHECK ("qty" > 0);

-- money
ALTER TABLE "invoice"          ADD CONSTRAINT "invoice_paid_within_total"        CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total");
ALTER TABLE "invoice"          ADD CONSTRAINT "invoice_total_non_negative"       CHECK ("total" >= 0);
ALTER TABLE "payment"          ADD CONSTRAINT "payment_amount_positive"          CHECK ("amount" > 0);
ALTER TABLE "credit_note"      ADD CONSTRAINT "credit_note_amount_positive"      CHECK ("amount" > 0);

-- singletons and periods
ALTER TABLE "risk_config"      ADD CONSTRAINT "risk_config_singleton"            CHECK ("id" = 1);
ALTER TABLE "risk_config"      ADD CONSTRAINT "risk_config_weights_sum_100"      CHECK ("w_worst" + "w_blended" + "w_margin" = 100);
ALTER TABLE "subscription"     ADD CONSTRAINT "subscription_period_order"        CHECK ("current_period_end" >= "current_period_start");
ALTER TABLE "billing_schedule" ADD CONSTRAINT "billing_schedule_period_order"    CHECK ("period_end" >= "period_start");
ALTER TABLE "recurring_plan"   ADD CONSTRAINT "recurring_plan_periods_positive"  CHECK ("periods" > 0);
