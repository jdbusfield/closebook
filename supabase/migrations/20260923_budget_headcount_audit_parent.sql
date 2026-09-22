-- Audit log: headcount rows now belong to the shared payroll plan, not a
-- budget version. The audit trigger finds a row's organization through its
-- configured parent; with budget_version_id NULL on every plan row it found
-- nothing and skipped the entry. Point it at the plan instead.
-- Safe to run more than once.

UPDATE public.audit_table_config
   SET parent_column = 'payroll_plan_id',
       parent_table  = 'budget_payroll_plans'
 WHERE table_name = 'budget_headcount';

SELECT public.audit_install_triggers();
