-- Add 'vehicle_payoff' to the debt_transactions transaction_type check constraint
ALTER TABLE debt_transactions DROP CONSTRAINT IF EXISTS debt_transactions_transaction_type_check;
ALTER TABLE debt_transactions ADD CONSTRAINT debt_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'advance', 'principal_payment', 'interest_payment', 'fee_payment',
    'late_fee', 'misc_fee', 'origination_fee', 'annual_fee',
    'payment_reversal', 'note_renewal', 'vehicle_payoff', 'payoff', 'adjustment'
  ));
