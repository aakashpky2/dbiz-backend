const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration() {
  console.log("Starting Billing Module migration...");

  try {
    // 1. Alter workflow_steps table to add is_billable
    const { error: alterWorkflowStepsErr } = await supabase.rpc('run_sql', {
      sql_query: `
        ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT FALSE;
      `
    });

    if (alterWorkflowStepsErr && !alterWorkflowStepsErr.message.includes('run_sql')) {
      console.log("Failed to alter workflow_steps via RPC:", alterWorkflowStepsErr.message);
      console.log("You might need to execute this manually in Supabase SQL editor: ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT FALSE;");
    }

    // 2. Create billing_invoices table
    const { error: createInvoicesErr } = await supabase.rpc('run_sql', {
      sql_query: `
        CREATE TABLE IF NOT EXISTS billing_invoices (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          invoice_no VARCHAR(50) UNIQUE NOT NULL,
          client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,
          work_id UUID REFERENCES works(id) ON DELETE RESTRICT,
          workflow_step_id UUID REFERENCES workflow_steps(id) ON DELETE RESTRICT NULL,
          billing_type VARCHAR(20) NOT NULL CHECK (billing_type IN ('full_work', 'workflow_step')),
          business_profile_id UUID REFERENCES business_profiles(id) ON DELETE RESTRICT,
          invoice_date DATE NOT NULL,
          due_date DATE,
          status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'generated', 'sent', 'partially_paid', 'paid', 'cancelled')) DEFAULT 'draft',
          professional_fee_total DECIMAL(12, 2) DEFAULT 0.00,
          government_fee_total DECIMAL(12, 2) DEFAULT 0.00,
          reimbursement_total DECIMAL(12, 2) DEFAULT 0.00,
          taxable_amount DECIMAL(12, 2) DEFAULT 0.00,
          cgst_amount DECIMAL(12, 2) DEFAULT 0.00,
          sgst_amount DECIMAL(12, 2) DEFAULT 0.00,
          igst_amount DECIMAL(12, 2) DEFAULT 0.00,
          grand_total DECIMAL(12, 2) DEFAULT 0.00,
          paid_amount DECIMAL(12, 2) DEFAULT 0.00,
          balance_amount DECIMAL(12, 2) DEFAULT 0.00,
          notes TEXT,
          cancelled_at TIMESTAMPTZ NULL,
          cancelled_by UUID NULL,
          cancellation_reason TEXT NULL,
          sent_at TIMESTAMPTZ NULL,
          paid_at TIMESTAMPTZ NULL,
          created_by UUID NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- Partial unique index for full work bills
        CREATE UNIQUE INDEX IF NOT EXISTS unique_full_work_bill 
        ON billing_invoices (work_id) 
        WHERE billing_type = 'full_work' AND status != 'cancelled';

        -- Partial unique index for workflow step bills
        CREATE UNIQUE INDEX IF NOT EXISTS unique_workflow_step_bill 
        ON billing_invoices (work_id, workflow_step_id) 
        WHERE billing_type = 'workflow_step' AND status != 'cancelled';
      `
    });

    if (createInvoicesErr) console.log("Create Invoices Err:", createInvoicesErr.message);

    // 3. Create billing_invoice_items table
    const { error: createItemsErr } = await supabase.rpc('run_sql', {
      sql_query: `
        CREATE TABLE IF NOT EXISTS billing_invoice_items (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          invoice_id UUID REFERENCES billing_invoices(id) ON DELETE CASCADE,
          fee_type VARCHAR(50) NOT NULL CHECK (fee_type IN ('Professional Fee', 'Government Fee', 'Reimbursement')),
          particulars VARCHAR(255) NOT NULL,
          amount DECIMAL(12, 2) NOT NULL,
          gst_applicable BOOLEAN DEFAULT FALSE,
          gst_rate DECIMAL(5, 2) DEFAULT 0.00,
          cgst_amount DECIMAL(12, 2) DEFAULT 0.00,
          sgst_amount DECIMAL(12, 2) DEFAULT 0.00,
          igst_amount DECIMAL(12, 2) DEFAULT 0.00,
          total_amount DECIMAL(12, 2) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `
    });

    if (createItemsErr) console.log("Create Items Err:", createItemsErr.message);

    // 4. Create billing_payments table
    const { error: createPaymentsErr } = await supabase.rpc('run_sql', {
      sql_query: `
        CREATE TABLE IF NOT EXISTS billing_payments (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          invoice_id UUID REFERENCES billing_invoices(id) ON DELETE CASCADE,
          payment_date DATE NOT NULL,
          amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
          payment_mode VARCHAR(50),
          reference_no VARCHAR(100),
          notes TEXT,
          created_by UUID,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `
    });

    if (createPaymentsErr) console.log("Create Payments Err:", createPaymentsErr.message);

    console.log("Migration complete!");
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

runMigration();
