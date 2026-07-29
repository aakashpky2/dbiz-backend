-- 1. Alter workflow_steps table to add billing_category (keeping is_billable for backward compatibility)
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT FALSE;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS billing_category VARCHAR(50) DEFAULT 'none' CHECK (billing_category IN ('none', 'professional_fee', 'government_fee', 'both'));

-- 2. Create billing_invoices table
CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  internal_bill_no VARCHAR(50) UNIQUE NOT NULL,
  tax_invoice_no VARCHAR(50) UNIQUE NULL,
  is_tax_invoice BOOLEAN DEFAULT FALSE,
  
  client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,
  work_id UUID REFERENCES works(id) ON DELETE RESTRICT,
  workflow_step_instance_id UUID REFERENCES workflow_step_instances(id) ON DELETE RESTRICT NULL,
  billing_type VARCHAR(20) NOT NULL CHECK (billing_type IN ('full_work', 'workflow_step')),
  business_profile_id UUID REFERENCES business_profiles(id) ON DELETE RESTRICT,
  
  invoice_date DATE NOT NULL,
  due_date DATE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'pending_approval', 'approved', 'invoice_generated', 'sent', 'partially_paid', 'paid', 'cancelled')) DEFAULT 'draft',
  
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
  
  -- Snapshots
  snapshot_client_name VARCHAR(255),
  snapshot_client_gstin VARCHAR(50),
  snapshot_client_address TEXT,
  snapshot_work_name VARCHAR(255),
  snapshot_step_name VARCHAR(255),
  snapshot_profile_name VARCHAR(255),
  snapshot_profile_gstin VARCHAR(50),
  snapshot_profile_address TEXT,
  
  -- Tracking
  prepared_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,
  tax_invoice_generated_at TIMESTAMPTZ,
  
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
ON billing_invoices (work_id, workflow_step_instance_id) 
WHERE billing_type = 'workflow_step' AND status != 'cancelled';

-- 3. Create billing_invoice_items table
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

-- 4. Create billing_payments table
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

-- 5. Create billing_work_status table
CREATE TABLE IF NOT EXISTS billing_work_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_id UUID UNIQUE REFERENCES works(id) ON DELETE CASCADE,
  next_billable_step_id UUID NULL REFERENCES workflow_step_instances(id) ON DELETE SET NULL,
  is_ready_for_billing BOOLEAN DEFAULT FALSE,
  is_fully_billed BOOLEAN DEFAULT FALSE,
  last_invoice_id UUID NULL REFERENCES billing_invoices(id) ON DELETE SET NULL,
  last_billed_at TIMESTAMPTZ NULL,
  last_billed_step_id UUID NULL REFERENCES workflow_step_instances(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Create receivables_ledger table (for future accounting integration)
CREATE TABLE IF NOT EXISTS receivables_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_id UUID REFERENCES billing_invoices(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES billing_payments(id) ON DELETE SET NULL,
  transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('Invoice', 'Payment', 'Adjustment')),
  amount DECIMAL(12, 2) NOT NULL,
  balance DECIMAL(12, 2) NOT NULL,
  transaction_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
