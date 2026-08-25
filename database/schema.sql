-- ============================================================================
-- Braco Group HR & Employee Portal — Production Database Schema
-- Target: PostgreSQL 15+ (Supabase)
-- ============================================================================
-- Conventions:
--   - UUID primary keys (gen_random_uuid()), standard for Supabase apps.
--   - created_at / updated_at on every mutable table, auto-maintained by trigger.
--   - Enums for finite, well-known value sets (roles, statuses).
--   - Money as NUMERIC(12,2), never FLOAT.
--   - Soft-delete via `active`/`status` flags where records must be retained
--     for audit/history (employees, freelancers, agreements) rather than
--     hard DELETE.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid(), pgp_sym_encrypt/decrypt

-- ----------------------------------------------------------------------------
-- Reusable trigger: auto-maintain updated_at
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- 1. ORGANIZATION
-- ============================================================================

create table companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  legal_name    text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_companies_updated_at before update on companies
  for each row execute function set_updated_at();

create table departments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  name          text not null,
  created_at    timestamptz not null default now(),
  unique (company_id, name)
);

-- ============================================================================
-- 2. IDENTITY, ROLES & PERMISSIONS
-- ============================================================================
-- `users` = anyone who can authenticate (staff via Entra ID, freelancers via
-- magic-link). `employees` = the HR record for staff. `freelancers` = the
-- record for external contractors. Both link back to `users` for auth/notifications.

create type auth_provider as enum ('entra_id', 'email_magic_link');

create table users (
  id                 uuid primary key default gen_random_uuid(),
  auth_provider      auth_provider not null,
  entra_object_id    text unique,          -- Entra ID `oid` claim (staff only)
  entra_tenant_id    text,                 -- Entra ID `tid` claim (staff only)
  email              text not null unique,
  display_name       text not null,
  is_active          boolean not null default true,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chk_entra_fields check (
    (auth_provider = 'entra_id' and entra_object_id is not null)
    or (auth_provider = 'email_magic_link')
  )
);
create trigger trg_users_updated_at before update on users
  for each row execute function set_updated_at();
create index idx_users_entra_object_id on users(entra_object_id);

create table roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,   -- 'employee' | 'supervisor' | 'hr' | 'finance' | 'admin'
  label       text not null,
  description text
);

create table permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,   -- e.g. 'leave.approve', 'employees.write'
  module      text not null,          -- e.g. 'leave', 'employees', 'reports'
  description text
);

create table role_permissions (
  role_id       uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- A person can hold more than one role (e.g. a supervisor who is also HR).
create table user_roles (
  user_id    uuid not null references users(id) on delete cascade,
  role_id    uuid not null references roles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id),
  primary key (user_id, role_id)
);

-- ============================================================================
-- 3. EMPLOYEES
-- ============================================================================

create type contract_type as enum ('permanent', 'temporary');

create table employees (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid unique references users(id) on delete restrict,
  company_id             uuid not null references companies(id),
  department_id          uuid references departments(id),
  manager_id             uuid references employees(id),   -- self-referential org chart
  job_title              text not null,
  employee_number        text unique,
  phone                  text,
  contract_type          contract_type,
  contract_start_date    date,
  contract_end_date      date,
  vacation_allotment_days numeric(5,1) not null default 15,
  responsibilities       text,           -- feeds {{responsibilities}} in generated contracts
  remuneration            text,          -- feeds {{remuneration}} in generated contracts
  email_verified          boolean not null default false,
  active                 boolean not null default true,   -- HR-controlled enable/disable
  onboarding_notified_at timestamptz,    -- last time we notified them onboarding was complete
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_employees_updated_at before update on employees
  for each row execute function set_updated_at();
create index idx_employees_company on employees(company_id);
create index idx_employees_manager on employees(manager_id);
create index idx_employees_active on employees(active);

create table emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null unique references employees(id) on delete cascade,
  name         text,
  relationship text,
  phone        text,
  updated_at   timestamptz not null default now()
);
create trigger trg_emergency_contacts_updated_at before update on emergency_contacts
  for each row execute function set_updated_at();

create type bank_type as enum ('local', 'international');

-- Banking tables store the account number ENCRYPTED (pgp_sym_encrypt) using an
-- application-managed key (see docs/SECURITY.md). Never store plaintext.
create table employee_banking_details (
  employee_id           uuid primary key references employees(id) on delete cascade,
  bank_type             bank_type,
  bank_name             text,
  account_holder_name   text,
  account_number_enc    bytea,     -- pgp_sym_encrypt(account_number, key)
  routing_swift_iban    text,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references users(id)
);
create trigger trg_employee_banking_updated_at before update on employee_banking_details
  for each row execute function set_updated_at();

-- ============================================================================
-- 4. FREELANCERS
-- ============================================================================

create type freelancer_status as enum ('pending', 'active', 'inactive');

create table freelancers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references users(id) on delete restrict,
  company_id     uuid not null references companies(id),
  project        text,
  rate           text,
  supervisor_id  uuid references employees(id),
  start_date     date,
  end_date       date,
  notes          text,
  status         freelancer_status not null default 'pending',  -- Finance approves -> active
  approved_by    uuid references users(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_freelancers_updated_at before update on freelancers
  for each row execute function set_updated_at();
create index idx_freelancers_company on freelancers(company_id);
create index idx_freelancers_supervisor on freelancers(supervisor_id);
create index idx_freelancers_status on freelancers(status);

create table freelancer_banking_details (
  freelancer_id         uuid primary key references freelancers(id) on delete cascade,
  bank_type             bank_type,
  bank_name             text,
  account_holder_name   text,
  account_number_enc    bytea,
  routing_swift_iban    text,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references users(id)
);
create trigger trg_freelancer_banking_updated_at before update on freelancer_banking_details
  for each row execute function set_updated_at();

-- ============================================================================
-- 5. DOCUMENTS (contracts, IDs, payslips, invoices, agreements)
-- ============================================================================
-- Files live in Supabase Storage; this table holds metadata + storage key only.

create type document_owner_type as enum ('employee', 'freelancer', 'service_agreement');
create type document_type as enum ('contract', 'payslip', 'id_passport', 'headshot', 'invoice', 'agreement', 'other');

create table documents (
  id            uuid primary key default gen_random_uuid(),
  owner_type    document_owner_type not null,
  owner_id      uuid not null,             -- polymorphic FK; validated in application layer
  document_type document_type not null,
  label         text not null,
  storage_key   text not null,             -- Supabase Storage object path
  mime_type     text not null,
  size_bytes    integer,
  uploaded_by   uuid not null references users(id),
  uploaded_at   timestamptz not null default now(),
  amended_at    timestamptz                -- set when a generated contract is edited in place
);
create index idx_documents_owner on documents(owner_type, owner_id);
create index idx_documents_type on documents(document_type);

create table contract_templates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references companies(id),   -- null = global default template
  name         text not null default 'Standard employment contract',
  body_template text not null,
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now()
);
create trigger trg_contract_templates_updated_at before update on contract_templates
  for each row execute function set_updated_at();

create table service_agreement_templates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references companies(id),
  name         text not null default 'Standard service agreement',
  body_template text not null,
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now()
);
create trigger trg_sa_templates_updated_at before update on service_agreement_templates
  for each row execute function set_updated_at();

-- ============================================================================
-- 6. LEAVE (vacation, sick, personal, etc.)
-- ============================================================================

create type leave_type as enum ('annual_vacation','personal_leave','unpaid_leave','bereavement','parental','sick','other');
create type leave_status as enum ('pending_manager','pending_hr','approved','rejected','cancelled');

create table leave_requests (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id) on delete cascade,
  leave_type      leave_type not null,
  start_date      date not null,
  end_date        date not null,
  days_requested  numeric(5,1) not null,
  reason          text,
  status          leave_status not null default 'pending_manager',
  cert_required   boolean not null default false,   -- sick leave > 2 days
  cert_document_id uuid references documents(id),
  submitted_at    timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references users(id),
  constraint chk_leave_dates check (end_date >= start_date)
);
create index idx_leave_employee on leave_requests(employee_id);
create index idx_leave_status on leave_requests(status);

create table leave_approvals (
  id               uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references leave_requests(id) on delete cascade,
  step             text not null,      -- 'manager' | 'hr'
  approver_id      uuid not null references users(id),
  decision         text not null,      -- 'approved' | 'rejected'
  comment          text,
  decided_at       timestamptz not null default now()
);
create index idx_leave_approvals_request on leave_approvals(leave_request_id);

-- ============================================================================
-- 7. EMPLOYEE LOANS
-- ============================================================================

create type loan_status as enum ('pending_manager','pending_hr','pending_finance','approved','disbursed','rejected');
create type repayment_status as enum ('pending','deducted','missed','adjusted');

create table loan_requests (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id) on delete cascade,
  amount            numeric(12,2) not null check (amount > 0 and amount <= 1000),
  purpose           text not null,
  months            integer not null check (months in (1,2,3,4,5,6,12)),
  monthly_deduction numeric(12,2) not null,
  status            loan_status not null default 'pending_manager',
  submitted_at      timestamptz not null default now(),
  decided_at        timestamptz,
  disbursed_at      timestamptz,
  disbursed_by      uuid references users(id)
);
create index idx_loans_employee on loan_requests(employee_id);
create index idx_loans_status on loan_requests(status);

create table loan_approvals (
  id               uuid primary key default gen_random_uuid(),
  loan_request_id  uuid not null references loan_requests(id) on delete cascade,
  step             text not null,      -- 'manager' | 'hr' | 'finance'
  approver_id      uuid not null references users(id),
  decision         text not null,
  comment          text,
  decided_at       timestamptz not null default now()
);

create table loan_repayments (
  id              uuid primary key default gen_random_uuid(),
  loan_request_id uuid not null references loan_requests(id) on delete cascade,
  period_index    integer not null,
  due_date        date not null,
  amount          numeric(12,2) not null,
  status          repayment_status not null default 'pending',
  updated_at      timestamptz not null default now(),
  unique (loan_request_id, period_index)
);

-- ============================================================================
-- 8. FREELANCER WORK SUBMISSIONS & INVOICING
-- ============================================================================

create type work_status as enum ('pending_supervisor','approved_pending_submit','submitted_to_finance','paid','rejected');

create table work_submissions (
  id              uuid primary key default gen_random_uuid(),
  freelancer_id   uuid not null references freelancers(id) on delete cascade,
  period          text not null,          -- e.g. '2026-08'
  description     text,
  amount          numeric(12,2) not null check (amount > 0),
  status          work_status not null default 'pending_supervisor',
  document_id     uuid references documents(id),   -- optional deliverable attachment
  invoice_number  text unique,
  submitted_at    timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references users(id),
  invoiced_at     timestamptz,
  paid_at         timestamptz,
  paid_by         uuid references users(id)
);
create index idx_work_freelancer on work_submissions(freelancer_id);
create index idx_work_status on work_submissions(status);

-- ============================================================================
-- 9. SERVICE AGREEMENTS (vendors — distinct from freelancers)
-- ============================================================================

create type agreement_status as enum ('draft','active','expired');

create table service_agreements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  vendor_name         text not null,
  service_description text,
  contact_name        text,
  contact_email       text,
  contact_phone       text,
  fee                 text,
  start_date          date,
  end_date            date,
  status              agreement_status not null default 'draft',
  notes               text,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_service_agreements_updated_at before update on service_agreements
  for each row execute function set_updated_at();
create index idx_agreements_company on service_agreements(company_id);
create index idx_agreements_status on service_agreements(status);

-- ============================================================================
-- 10. NOTIFICATIONS
-- ============================================================================

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  type         text not null,     -- 'leave' | 'loan' | 'freelance_work' | 'invoice' | 'onboarding' | ...
  message      text not null,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index idx_notifications_user on notifications(user_id, read);

-- ============================================================================
-- 11. AUDIT LOG
-- ============================================================================

create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  action       text not null,          -- e.g. 'leave.approved', 'employee.created'
  entity_type  text not null,
  entity_id    uuid,
  detail       jsonb,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index idx_audit_actor on audit_log(actor_user_id);
create index idx_audit_entity on audit_log(entity_type, entity_id);
create index idx_audit_created on audit_log(created_at desc);

-- ============================================================================
-- 12. SEED DATA — roles & permissions
-- ============================================================================

insert into roles (key, label, description) values
  ('employee',   'Employee',   'Individual contributor — self-service only'),
  ('supervisor', 'Supervisor', 'Approves leave/loans/freelancer work for direct reports'),
  ('hr',         'HR',         'Manages employee records, onboarding, contracts, second-stage approvals'),
  ('finance',    'Finance',    'Approves loans/freelancers, disburses funds, pays invoices'),
  ('admin',      'Admin',      'System administration — users, roles, companies, integrations');

insert into permissions (key, module, description) values
  ('employees.read.self',   'employees',  'View own employee record'),
  ('employees.read.team',   'employees',  'View direct reports'' records'),
  ('employees.read.all',    'employees',  'View all employee records'),
  ('employees.write',       'employees',  'Create/edit employee records'),
  ('leave.request',         'leave',      'Submit a leave request'),
  ('leave.approve.manager',  'leave',      'Approve leave as supervisor'),
  ('leave.approve.hr',       'leave',      'Approve leave as HR (final stage)'),
  ('loans.request',         'loans',      'Submit a loan request'),
  ('loans.approve.manager',  'loans',      'Approve loan as supervisor'),
  ('loans.approve.hr',       'loans',      'Approve loan as HR'),
  ('loans.approve.finance',  'loans',      'Approve/disburse loan as Finance'),
  ('freelancers.manage',    'freelancers','Create/edit freelancer records, upload documents'),
  ('freelancers.approve',   'freelancers','Approve a freelancer to active status'),
  ('work.review',           'freelancers','Review/approve freelancer monthly work'),
  ('work.pay',              'freelancers','Mark freelancer invoices paid'),
  ('contracts.manage',      'contracts',  'Edit templates, generate/amend contracts'),
  ('agreements.manage',     'agreements', 'Manage service agreements'),
  ('reports.view',          'reports',    'View reporting dashboards and exports'),
  ('audit.view',            'audit',      'View the audit log'),
  ('admin.users',           'admin',      'Manage user accounts and role assignments'),
  ('admin.companies',       'admin',      'Manage companies/departments/system config');

-- Role -> permission mapping
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where
  (r.key='employee'   and p.key in ('employees.read.self','leave.request','loans.request')) or
  (r.key='supervisor' and p.key in ('employees.read.self','employees.read.team','leave.request','leave.approve.manager',
                                     'loans.request','loans.approve.manager','work.review')) or
  (r.key='hr'          and p.key in ('employees.read.all','employees.write','leave.request','leave.approve.hr',
                                     'loans.request','loans.approve.hr','freelancers.manage','contracts.manage',
                                     'agreements.manage','reports.view','audit.view')) or
  (r.key='finance'     and p.key in ('employees.read.self','loans.approve.finance','freelancers.approve',
                                     'work.pay','reports.view')) or
  (r.key='admin'       and p.key in ('admin.users','admin.companies','audit.view','reports.view','employees.read.all'));
