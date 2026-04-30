export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string
          entity_id: string
          qbo_id: string | null
          account_number: string | null
          name: string
          fully_qualified_name: string | null
          classification: string
          account_type: string
          account_sub_type: string | null
          parent_account_id: string | null
          is_active: boolean
          currency: string
          current_balance: number
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          qbo_id?: string | null
          account_number?: string | null
          name: string
          fully_qualified_name?: string | null
          classification: string
          account_type: string
          account_sub_type?: string | null
          parent_account_id?: string | null
          is_active?: boolean
          currency?: string
          current_balance?: number
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          qbo_id?: string | null
          account_number?: string | null
          name?: string
          fully_qualified_name?: string | null
          classification?: string
          account_type?: string
          account_sub_type?: string | null
          parent_account_id?: string | null
          is_active?: boolean
          currency?: string
          current_balance?: number
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      asset_depreciation_rules: {
        Row: {
          id: string
          entity_id: string
          reporting_group: string
          book_useful_life_months: number | null
          book_salvage_pct: number | null
          book_depreciation_method: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          reporting_group: string
          book_useful_life_months?: number | null
          book_salvage_pct?: number | null
          book_depreciation_method?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          reporting_group?: string
          book_useful_life_months?: number | null
          book_salvage_pct?: number | null
          book_depreciation_method?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          organization_id: string
          entity_id: string | null
          user_id: string | null
          action: string
          resource_type: string
          resource_id: string | null
          old_values: Json | null
          new_values: Json | null
          ip_address: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          entity_id?: string | null
          user_id?: string | null
          action: string
          resource_type: string
          resource_id?: string | null
          old_values?: Json | null
          new_values?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          entity_id?: string | null
          user_id?: string | null
          action?: string
          resource_type?: string
          resource_id?: string | null
          old_values?: Json | null
          new_values?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Relationships: []
      }
      close_periods: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          status: string
          due_date: string | null
          notes: string | null
          opened_at: string
          closed_at: string | null
          closed_by: string | null
          soft_closed_at: string | null
          soft_closed_by: string | null
          hard_closed_at: string | null
          hard_closed_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          status?: string
          due_date?: string | null
          notes?: string | null
          opened_at?: string
          closed_at?: string | null
          closed_by?: string | null
          soft_closed_at?: string | null
          soft_closed_by?: string | null
          hard_closed_at?: string | null
          hard_closed_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          status?: string
          due_date?: string | null
          notes?: string | null
          opened_at?: string
          closed_at?: string | null
          closed_by?: string | null
          soft_closed_at?: string | null
          soft_closed_by?: string | null
          hard_closed_at?: string | null
          hard_closed_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      close_task_attachments: {
        Row: {
          id: string
          close_task_id: string
          file_name: string
          file_path: string
          file_size: number | null
          mime_type: string | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          close_task_id: string
          file_name: string
          file_path: string
          file_size?: number | null
          mime_type?: string | null
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          close_task_id?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          mime_type?: string | null
          uploaded_by?: string
          created_at?: string
        }
        Relationships: []
      }
      close_task_comments: {
        Row: {
          id: string
          close_task_id: string
          user_id: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          close_task_id: string
          user_id: string
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          close_task_id?: string
          user_id?: string
          content?: string
          created_at?: string
        }
        Relationships: []
      }
      close_task_templates: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          category: string | null
          default_role: string | null
          account_classification: string | null
          account_type: string | null
          relative_due_day: number | null
          display_order: number
          is_active: boolean
          requires_reconciliation: boolean
          phase: number
          source_module: string | null
          entity_ids: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          category?: string | null
          default_role?: string | null
          account_classification?: string | null
          account_type?: string | null
          relative_due_day?: number | null
          display_order?: number
          is_active?: boolean
          requires_reconciliation?: boolean
          phase?: number
          source_module?: string | null
          entity_ids?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          category?: string | null
          default_role?: string | null
          account_classification?: string | null
          account_type?: string | null
          relative_due_day?: number | null
          display_order?: number
          is_active?: boolean
          requires_reconciliation?: boolean
          phase?: number
          source_module?: string | null
          entity_ids?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      close_tasks: {
        Row: {
          id: string
          close_period_id: string
          template_id: string | null
          account_id: string | null
          name: string
          description: string | null
          category: string | null
          status: string
          preparer_id: string | null
          reviewer_id: string | null
          due_date: string | null
          completed_at: string | null
          reviewed_at: string | null
          preparer_notes: string | null
          reviewer_notes: string | null
          gl_balance: number | null
          reconciled_balance: number | null
          variance: number | null
          display_order: number
          phase: number
          source_module: string | null
          source_record_id: string | null
          is_auto_generated: boolean
          is_immaterial: boolean
          immaterial_reason: string | null
          reconciliation_template_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          close_period_id: string
          template_id?: string | null
          account_id?: string | null
          name: string
          description?: string | null
          category?: string | null
          status?: string
          preparer_id?: string | null
          reviewer_id?: string | null
          due_date?: string | null
          completed_at?: string | null
          reviewed_at?: string | null
          preparer_notes?: string | null
          reviewer_notes?: string | null
          gl_balance?: number | null
          reconciled_balance?: number | null
          variance?: number | null
          display_order?: number
          phase?: number
          source_module?: string | null
          source_record_id?: string | null
          is_auto_generated?: boolean
          is_immaterial?: boolean
          immaterial_reason?: string | null
          reconciliation_template_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          close_period_id?: string
          template_id?: string | null
          account_id?: string | null
          name?: string
          description?: string | null
          category?: string | null
          status?: string
          preparer_id?: string | null
          reviewer_id?: string | null
          due_date?: string | null
          completed_at?: string | null
          reviewed_at?: string | null
          preparer_notes?: string | null
          reviewer_notes?: string | null
          gl_balance?: number | null
          reconciled_balance?: number | null
          variance?: number | null
          display_order?: number
          phase?: number
          source_module?: string | null
          source_record_id?: string | null
          is_auto_generated?: boolean
          is_immaterial?: boolean
          immaterial_reason?: string | null
          reconciliation_template_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      close_gate_checks: {
        Row: {
          id: string
          close_period_id: string
          check_type: string
          status: string
          is_critical: boolean
          result_data: Record<string, unknown>
          checked_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          close_period_id: string
          check_type: string
          status?: string
          is_critical?: boolean
          result_data?: Record<string, unknown>
          checked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          close_period_id?: string
          check_type?: string
          status?: string
          is_critical?: boolean
          result_data?: Record<string, unknown>
          checked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      materiality_thresholds: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          threshold_amount: number | null
          threshold_percentage: number | null
          applies_to_category: string | null
          applies_to_phase: number | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          threshold_amount?: number | null
          threshold_percentage?: number | null
          applies_to_category?: string | null
          applies_to_phase?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          threshold_amount?: number | null
          threshold_percentage?: number | null
          applies_to_category?: string | null
          applies_to_phase?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      materiality_overrides: {
        Row: {
          id: string
          close_task_id: string
          threshold_id: string | null
          variance_amount: number | null
          justification: string
          waived_by: string | null
          waived_at: string
          created_at: string
        }
        Insert: {
          id?: string
          close_task_id: string
          threshold_id?: string | null
          variance_amount?: number | null
          justification: string
          waived_by?: string | null
          waived_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          close_task_id?: string
          threshold_id?: string | null
          variance_amount?: number | null
          justification?: string
          waived_by?: string | null
          waived_at?: string
          created_at?: string
        }
        Relationships: []
      }
      reconciliation_templates: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          category: string
          field_definitions: Record<string, unknown>[]
          variance_tolerance_amount: number | null
          variance_tolerance_percentage: number | null
          is_active: boolean
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          category: string
          field_definitions?: Record<string, unknown>[]
          variance_tolerance_amount?: number | null
          variance_tolerance_percentage?: number | null
          is_active?: boolean
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          category?: string
          field_definitions?: Record<string, unknown>[]
          variance_tolerance_amount?: number | null
          variance_tolerance_percentage?: number | null
          is_active?: boolean
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      reconciliation_workpapers: {
        Row: {
          id: string
          close_task_id: string
          template_id: string | null
          workpaper_data: Record<string, unknown>
          gl_balance: number | null
          subledger_balance: number | null
          variance: number | null
          is_within_tolerance: boolean
          submitted_by: string | null
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          status: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          close_task_id: string
          template_id?: string | null
          workpaper_data?: Record<string, unknown>
          gl_balance?: number | null
          subledger_balance?: number | null
          variance?: number | null
          is_within_tolerance?: boolean
          submitted_by?: string | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          close_task_id?: string
          template_id?: string | null
          workpaper_data?: Record<string, unknown>
          gl_balance?: number | null
          subledger_balance?: number | null
          variance?: number | null
          is_within_tolerance?: boolean
          submitted_by?: string | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      debt_amortization: {
        Row: {
          id: string
          debt_instrument_id: string
          period_year: number
          period_month: number
          beginning_balance: number
          payment: number
          principal: number
          interest: number
          ending_balance: number
          is_manual_override: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          debt_instrument_id: string
          period_year: number
          period_month: number
          beginning_balance?: number
          payment?: number
          principal?: number
          interest?: number
          ending_balance?: number
          is_manual_override?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          debt_instrument_id?: string
          period_year?: number
          period_month?: number
          beginning_balance?: number
          payment?: number
          principal?: number
          interest?: number
          ending_balance?: number
          is_manual_override?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      debt_covenants: {
        Row: {
          id: string
          debt_instrument_id: string
          covenant_name: string
          covenant_type: string
          description: string | null
          threshold_value: number | null
          threshold_operator: string | null
          measurement_frequency: string
          next_measurement_date: string | null
          last_measured_value: number | null
          last_measured_date: string | null
          is_in_compliance: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          debt_instrument_id: string
          covenant_name: string
          covenant_type: string
          description?: string | null
          threshold_value?: number | null
          threshold_operator?: string | null
          measurement_frequency?: string
          next_measurement_date?: string | null
          last_measured_value?: number | null
          last_measured_date?: string | null
          is_in_compliance?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          debt_instrument_id?: string
          covenant_name?: string
          covenant_type?: string
          description?: string | null
          threshold_value?: number | null
          threshold_operator?: string | null
          measurement_frequency?: string
          next_measurement_date?: string | null
          last_measured_value?: number | null
          last_measured_date?: string | null
          is_in_compliance?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      debt_rate_history: {
        Row: {
          id: string
          debt_instrument_id: string
          effective_date: string
          interest_rate: number
          index_rate: number | null
          spread: number | null
          change_reason: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          debt_instrument_id: string
          effective_date: string
          interest_rate: number
          index_rate?: number | null
          spread?: number | null
          change_reason?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          debt_instrument_id?: string
          effective_date?: string
          interest_rate?: number
          index_rate?: number | null
          spread?: number | null
          change_reason?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      debt_transactions: {
        Row: {
          id: string
          debt_instrument_id: string
          transaction_date: string
          effective_date: string
          transaction_type: string
          amount: number
          to_principal: number
          to_interest: number
          to_fees: number
          running_balance: number | null
          reference_number: string | null
          description: string | null
          statement_date: string | null
          is_reconciled: boolean
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          debt_instrument_id: string
          transaction_date: string
          effective_date: string
          transaction_type: string
          amount: number
          to_principal?: number
          to_interest?: number
          to_fees?: number
          running_balance?: number | null
          reference_number?: string | null
          description?: string | null
          statement_date?: string | null
          is_reconciled?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          debt_instrument_id?: string
          transaction_date?: string
          effective_date?: string
          transaction_type?: string
          amount?: number
          to_principal?: number
          to_interest?: number
          to_fees?: number
          running_balance?: number | null
          reference_number?: string | null
          description?: string | null
          statement_date?: string | null
          is_reconciled?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      debt_instruments: {
        Row: {
          id: string
          entity_id: string
          instrument_name: string
          lender_name: string | null
          debt_type: string
          original_amount: number
          interest_rate: number
          term_months: number | null
          start_date: string
          maturity_date: string | null
          payment_amount: number | null
          payment_frequency: string
          credit_limit: number | null
          current_draw: number | null
          liability_account_id: string | null
          interest_expense_account_id: string | null
          fixed_asset_id: string | null
          status: string
          source_file_name: string | null
          uploaded_at: string | null
          is_pik: boolean
          created_by: string | null
          created_at: string
          updated_at: string
          day_count_convention: string | null
          opening_accrued_interest: number | null
        }
        Insert: {
          id?: string
          entity_id: string
          instrument_name: string
          lender_name?: string | null
          debt_type: string
          original_amount?: number
          interest_rate?: number
          term_months?: number | null
          start_date: string
          maturity_date?: string | null
          payment_amount?: number | null
          payment_frequency?: string
          credit_limit?: number | null
          current_draw?: number | null
          liability_account_id?: string | null
          interest_expense_account_id?: string | null
          fixed_asset_id?: string | null
          status?: string
          source_file_name?: string | null
          uploaded_at?: string | null
          is_pik?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          day_count_convention?: string | null
          opening_accrued_interest?: number | null
        }
        Update: {
          id?: string
          entity_id?: string
          instrument_name?: string
          lender_name?: string | null
          debt_type?: string
          original_amount?: number
          interest_rate?: number
          term_months?: number | null
          start_date?: string
          maturity_date?: string | null
          payment_amount?: number | null
          payment_frequency?: string
          credit_limit?: number | null
          current_draw?: number | null
          liability_account_id?: string | null
          interest_expense_account_id?: string | null
          fixed_asset_id?: string | null
          status?: string
          source_file_name?: string | null
          uploaded_at?: string | null
          is_pik?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          day_count_convention?: string | null
          opening_accrued_interest?: number | null
        }
        Relationships: []
      }
      entities: {
        Row: {
          id: string
          organization_id: string
          name: string
          code: string
          currency: string
          fiscal_year_end_month: number
          is_active: boolean
          rental_asset_opening_date: string
          combine_fleet_accum_depr: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          code: string
          currency?: string
          fiscal_year_end_month?: number
          is_active?: boolean
          rental_asset_opening_date?: string
          combine_fleet_accum_depr?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          code?: string
          currency?: string
          fiscal_year_end_month?: number
          is_active?: boolean
          rental_asset_opening_date?: string
          combine_fleet_accum_depr?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      entity_access: {
        Row: {
          id: string
          entity_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          user_id: string
          role: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          user_id?: string
          role?: string
          created_at?: string
        }
        Relationships: []
      }
      generated_reports: {
        Row: {
          id: string
          entity_id: string
          report_definition_id: string | null
          period_year: number
          period_month: number
          report_data: Json
          comparison_data: Json | null
          generated_at: string
          generated_by: string | null
        }
        Insert: {
          id?: string
          entity_id: string
          report_definition_id?: string | null
          period_year: number
          period_month: number
          report_data: Json
          comparison_data?: Json | null
          generated_at?: string
          generated_by?: string | null
        }
        Update: {
          id?: string
          entity_id?: string
          report_definition_id?: string | null
          period_year?: number
          period_month?: number
          report_data?: Json
          comparison_data?: Json | null
          generated_at?: string
          generated_by?: string | null
        }
        Relationships: []
      }
      gl_balances: {
        Row: {
          id: string
          entity_id: string
          account_id: string
          period_year: number
          period_month: number
          beginning_balance: number
          debit_total: number
          credit_total: number
          ending_balance: number
          net_change: number
          synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          account_id: string
          period_year: number
          period_month: number
          beginning_balance?: number
          debit_total?: number
          credit_total?: number
          ending_balance?: number
          net_change?: number
          synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          account_id?: string
          period_year?: number
          period_month?: number
          beginning_balance?: number
          debit_total?: number
          credit_total?: number
          ending_balance?: number
          net_change?: number
          synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      kpi_definitions: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          formula: Json
          format: string
          target_value: number | null
          display_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          formula: Json
          format?: string
          target_value?: number | null
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          formula?: Json
          format?: string
          target_value?: number | null
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      kpi_values: {
        Row: {
          id: string
          kpi_definition_id: string
          entity_id: string
          period_year: number
          period_month: number
          value: number | null
          computed_at: string
        }
        Insert: {
          id?: string
          kpi_definition_id: string
          entity_id: string
          period_year: number
          period_month: number
          value?: number | null
          computed_at?: string
        }
        Update: {
          id?: string
          kpi_definition_id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          value?: number | null
          computed_at?: string
        }
        Relationships: []
      }
      organization_invites: {
        Row: {
          id: string
          organization_id: string
          email: string
          role: string
          invited_by: string
          status: string
          token: string
          expires_at: string
          accepted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          email: string
          role: string
          invited_by: string
          status?: string
          token?: string
          expires_at?: string
          accepted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          email?: string
          role?: string
          invited_by?: string
          status?: string
          token?: string
          expires_at?: string
          accepted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          role: string
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          role?: string
          created_at?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_connections: {
        Row: {
          id: string
          entity_id: string
          realm_id: string
          access_token: string
          refresh_token: string
          access_token_expires_at: string
          refresh_token_expires_at: string
          company_name: string | null
          last_sync_at: string | null
          sync_status: string
          sync_error: string | null
          connected_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          realm_id: string
          access_token: string
          refresh_token: string
          access_token_expires_at: string
          refresh_token_expires_at: string
          company_name?: string | null
          last_sync_at?: string | null
          sync_status?: string
          sync_error?: string | null
          connected_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          realm_id?: string
          access_token?: string
          refresh_token?: string
          access_token_expires_at?: string
          refresh_token_expires_at?: string
          company_name?: string | null
          last_sync_at?: string | null
          sync_status?: string
          sync_error?: string | null
          connected_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_sync_logs: {
        Row: {
          id: string
          qbo_connection_id: string
          sync_type: string
          status: string
          records_synced: number
          error_message: string | null
          started_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          qbo_connection_id: string
          sync_type: string
          status: string
          records_synced?: number
          error_message?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          qbo_connection_id?: string
          sync_type?: string
          status?: string
          records_synced?: number
          error_message?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      report_definitions: {
        Row: {
          id: string
          organization_id: string
          name: string
          report_type: string
          config: Json
          is_system: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          report_type: string
          config: Json
          is_system?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          report_type?: string
          config?: Json
          is_system?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_line_items: {
        Row: {
          id: string
          schedule_id: string
          row_order: number
          is_header: boolean
          is_total: boolean
          cell_data: Json
          amount: number
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          schedule_id: string
          row_order: number
          is_header?: boolean
          is_total?: boolean
          cell_data?: Json
          amount?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          schedule_id?: string
          row_order?: number
          is_header?: boolean
          is_total?: boolean
          cell_data?: Json
          amount?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_templates: {
        Row: {
          id: string
          organization_id: string
          name: string
          schedule_type: string
          column_definitions: Json
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          schedule_type: string
          column_definitions: Json
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          schedule_type?: string
          column_definitions?: Json
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedules: {
        Row: {
          id: string
          entity_id: string
          template_id: string | null
          close_period_id: string | null
          close_task_id: string | null
          account_id: string | null
          name: string
          schedule_type: string
          column_definitions: Json
          status: string
          total_amount: number
          gl_balance: number | null
          variance: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          template_id?: string | null
          close_period_id?: string | null
          close_task_id?: string | null
          account_id?: string | null
          name: string
          schedule_type: string
          column_definitions: Json
          status?: string
          total_amount?: number
          gl_balance?: number | null
          variance?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          template_id?: string | null
          close_period_id?: string | null
          close_task_id?: string | null
          account_id?: string | null
          name?: string
          schedule_type?: string
          column_definitions?: Json
          status?: string
          total_amount?: number
          gl_balance?: number | null
          variance?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      trial_balances: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          synced_at: string
          report_data: Json
          status: string
          created_at: string
          content_hash: string | null
          data_changed_at: string | null
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          synced_at?: string
          report_data: Json
          status?: string
          created_at?: string
          content_hash?: string | null
          data_changed_at?: string | null
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          synced_at?: string
          report_data?: Json
          status?: string
          created_at?: string
          content_hash?: string | null
          data_changed_at?: string | null
        }
        Relationships: []
      }
      uploaded_reports: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          name: string
          description: string | null
          file_name: string
          file_path: string
          file_size: number | null
          mime_type: string | null
          category: string | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          name: string
          description?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          mime_type?: string | null
          category?: string | null
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          name?: string
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          mime_type?: string | null
          category?: string | null
          uploaded_by?: string
          created_at?: string
        }
        Relationships: []
      }
      fixed_assets: {
        Row: {
          id: string
          entity_id: string
          asset_name: string
          asset_tag: string | null
          vehicle_year: number | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_trim: string | null
          vin: string | null
          license_plate: string | null
          license_state: string | null
          mileage_at_acquisition: number | null
          vehicle_class: string | null
          title_number: string | null
          registration_expiry: string | null
          vehicle_notes: string | null
          acquisition_date: string
          acquisition_cost: number
          in_service_date: string
          book_useful_life_months: number
          book_salvage_value: number
          book_depreciation_method: string
          book_accumulated_depreciation: number
          book_net_value: number
          tax_cost_basis: number | null
          tax_depreciation_method: string
          tax_useful_life_months: number | null
          tax_accumulated_depreciation: number
          tax_net_value: number
          section_179_amount: number
          bonus_depreciation_amount: number
          cost_account_id: string | null
          accum_depr_account_id: string | null
          depr_expense_account_id: string | null
          status: string
          disposed_date: string | null
          disposed_sale_price: number | null
          disposed_book_gain_loss: number | null
          disposed_tax_gain_loss: number | null
          disposition_method: string | null
          disposed_buyer: string | null
          master_type_override: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          asset_name: string
          asset_tag?: string | null
          vehicle_year?: number | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vin?: string | null
          license_plate?: string | null
          license_state?: string | null
          mileage_at_acquisition?: number | null
          vehicle_class?: string | null
          title_number?: string | null
          registration_expiry?: string | null
          vehicle_notes?: string | null
          acquisition_date: string
          acquisition_cost: number
          in_service_date: string
          book_useful_life_months?: number
          book_salvage_value?: number
          book_depreciation_method?: string
          book_accumulated_depreciation?: number
          tax_cost_basis?: number | null
          tax_depreciation_method?: string
          tax_useful_life_months?: number | null
          tax_accumulated_depreciation?: number
          section_179_amount?: number
          bonus_depreciation_amount?: number
          cost_account_id?: string | null
          accum_depr_account_id?: string | null
          depr_expense_account_id?: string | null
          status?: string
          disposed_date?: string | null
          disposed_sale_price?: number | null
          disposed_book_gain_loss?: number | null
          disposed_tax_gain_loss?: number | null
          disposition_method?: string | null
          disposed_buyer?: string | null
          master_type_override?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          asset_name?: string
          asset_tag?: string | null
          vehicle_year?: number | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vin?: string | null
          license_plate?: string | null
          license_state?: string | null
          mileage_at_acquisition?: number | null
          vehicle_class?: string | null
          title_number?: string | null
          registration_expiry?: string | null
          vehicle_notes?: string | null
          acquisition_date?: string
          acquisition_cost?: number
          in_service_date?: string
          book_useful_life_months?: number
          book_salvage_value?: number
          book_depreciation_method?: string
          book_accumulated_depreciation?: number
          tax_cost_basis?: number | null
          tax_depreciation_method?: string
          tax_useful_life_months?: number | null
          tax_accumulated_depreciation?: number
          section_179_amount?: number
          bonus_depreciation_amount?: number
          cost_account_id?: string | null
          accum_depr_account_id?: string | null
          depr_expense_account_id?: string | null
          status?: string
          disposed_date?: string | null
          disposed_sale_price?: number | null
          disposed_book_gain_loss?: number | null
          disposed_tax_gain_loss?: number | null
          disposition_method?: string | null
          disposed_buyer?: string | null
          master_type_override?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_cost_account_id_fkey"
            columns: ["cost_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_accum_depr_account_id_fkey"
            columns: ["accum_depr_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_depr_expense_account_id_fkey"
            columns: ["depr_expense_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_asset_depreciation: {
        Row: {
          id: string
          fixed_asset_id: string
          period_year: number
          period_month: number
          book_depreciation: number
          book_accumulated: number
          book_net_value: number
          tax_depreciation: number
          tax_accumulated: number
          tax_net_value: number
          is_manual_override: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fixed_asset_id: string
          period_year: number
          period_month: number
          book_depreciation?: number
          book_accumulated?: number
          book_net_value?: number
          tax_depreciation?: number
          tax_accumulated?: number
          tax_net_value?: number
          is_manual_override?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fixed_asset_id?: string
          period_year?: number
          period_month?: number
          book_depreciation?: number
          book_accumulated?: number
          book_net_value?: number
          tax_depreciation?: number
          tax_accumulated?: number
          tax_net_value?: number
          is_manual_override?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_asset_depreciation_fixed_asset_id_fkey"
            columns: ["fixed_asset_id"]
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      paylocity_connections: {
        Row: {
          id: string
          entity_id: string
          client_id: string
          client_secret_encrypted: string
          access_token: string | null
          token_expires_at: string | null
          environment: string
          company_id: string
          connected_by: string | null
          last_sync_at: string | null
          sync_status: string
          sync_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          client_id: string
          client_secret_encrypted: string
          access_token?: string | null
          token_expires_at?: string | null
          environment?: string
          company_id: string
          connected_by?: string | null
          last_sync_at?: string | null
          sync_status?: string
          sync_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          client_id?: string
          client_secret_encrypted?: string
          access_token?: string | null
          token_expires_at?: string | null
          environment?: string
          company_id?: string
          connected_by?: string | null
          last_sync_at?: string | null
          sync_status?: string
          sync_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      payroll_accruals: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          accrual_type: string
          description: string
          amount: number
          source: string
          payroll_sync_id: string | null
          account_id: string | null
          offset_account_id: string | null
          status: string
          reversal_period_year: number | null
          reversal_period_month: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          accrual_type: string
          description: string
          amount?: number
          source?: string
          payroll_sync_id?: string | null
          account_id?: string | null
          offset_account_id?: string | null
          status?: string
          reversal_period_year?: number | null
          reversal_period_month?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          accrual_type?: string
          description?: string
          amount?: number
          source?: string
          payroll_sync_id?: string | null
          account_id?: string | null
          offset_account_id?: string | null
          status?: string
          reversal_period_year?: number | null
          reversal_period_month?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      payroll_gl_mappings: {
        Row: {
          id: string
          entity_id: string
          accrual_type: string
          debit_account_id: string | null
          credit_account_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          accrual_type: string
          debit_account_id?: string | null
          credit_account_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          accrual_type?: string
          debit_account_id?: string | null
          credit_account_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      payroll_sync_logs: {
        Row: {
          id: string
          entity_id: string
          started_at: string
          completed_at: string | null
          status: string
          employees_synced: number
          accruals_generated: number
          error_message: string | null
          raw_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          started_at?: string
          completed_at?: string | null
          status?: string
          employees_synced?: number
          accruals_generated?: number
          error_message?: string | null
          raw_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          started_at?: string
          completed_at?: string | null
          status?: string
          employees_synced?: number
          accruals_generated?: number
          error_message?: string | null
          raw_data?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      revenue_schedules: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          source_file_name: string | null
          source_file_path: string | null
          uploaded_by: string | null
          uploaded_at: string | null
          total_accrued_revenue: number
          total_deferred_revenue: number
          total_earned_revenue: number
          total_billed_revenue: number
          accrued_account_id: string | null
          deferred_account_id: string | null
          revenue_account_id: string | null
          status: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          source_file_name?: string | null
          source_file_path?: string | null
          uploaded_by?: string | null
          uploaded_at?: string | null
          total_accrued_revenue?: number
          total_deferred_revenue?: number
          total_earned_revenue?: number
          total_billed_revenue?: number
          accrued_account_id?: string | null
          deferred_account_id?: string | null
          revenue_account_id?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          source_file_name?: string | null
          source_file_path?: string | null
          uploaded_by?: string | null
          uploaded_at?: string | null
          total_accrued_revenue?: number
          total_deferred_revenue?: number
          total_earned_revenue?: number
          total_billed_revenue?: number
          accrued_account_id?: string | null
          deferred_account_id?: string | null
          revenue_account_id?: string | null
          status?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      revenue_line_items: {
        Row: {
          id: string
          schedule_id: string
          contract_id: string | null
          customer_name: string | null
          description: string | null
          rental_start: string | null
          rental_end: string | null
          total_contract_value: number
          daily_rate: number
          days_in_period: number
          earned_revenue: number
          billed_amount: number
          accrual_amount: number
          deferral_amount: number
          row_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          schedule_id: string
          contract_id?: string | null
          customer_name?: string | null
          description?: string | null
          rental_start?: string | null
          rental_end?: string | null
          total_contract_value?: number
          daily_rate?: number
          days_in_period?: number
          earned_revenue?: number
          billed_amount?: number
          accrual_amount?: number
          deferral_amount?: number
          row_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          schedule_id?: string
          contract_id?: string | null
          customer_name?: string | null
          description?: string | null
          rental_start?: string | null
          rental_end?: string | null
          total_contract_value?: number
          daily_rate?: number
          days_in_period?: number
          earned_revenue?: number
          billed_amount?: number
          accrual_amount?: number
          deferral_amount?: number
          row_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      master_accounts: {
        Row: {
          id: string
          organization_id: string
          chart_id: string
          account_number: string
          name: string
          description: string | null
          classification: string
          account_type: string
          account_sub_type: string | null
          parent_account_id: string | null
          is_active: boolean
          display_order: number
          normal_balance: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          chart_id: string
          account_number: string
          name: string
          description?: string | null
          classification: string
          account_type: string
          account_sub_type?: string | null
          parent_account_id?: string | null
          is_active?: boolean
          display_order?: number
          normal_balance?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          chart_id?: string
          account_number?: string
          name?: string
          description?: string | null
          classification?: string
          account_type?: string
          account_sub_type?: string | null
          parent_account_id?: string | null
          is_active?: boolean
          display_order?: number
          normal_balance?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_accounts_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_accounts_chart_id_fkey"
            columns: ["chart_id"]
            referencedRelation: "master_charts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            referencedRelation: "master_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      master_account_mappings: {
        Row: {
          id: string
          master_account_id: string
          chart_id: string
          entity_id: string
          account_id: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          master_account_id: string
          chart_id?: string
          entity_id: string
          account_id: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          master_account_id?: string
          chart_id?: string
          entity_id?: string
          account_id?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_account_mappings_master_account_id_fkey"
            columns: ["master_account_id"]
            referencedRelation: "master_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_account_mappings_chart_id_fkey"
            columns: ["chart_id"]
            referencedRelation: "master_charts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_account_mappings_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_account_mappings_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      master_charts: {
        Row: {
          id: string
          organization_id: string
          name: string
          kind: string
          is_default: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          kind: string
          is_default?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          kind?: string
          is_default?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_charts_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tb_unmatched_rows: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          qbo_account_name: string
          qbo_account_id: string | null
          debit: number
          credit: number
          resolved_account_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          qbo_account_name: string
          qbo_account_id?: string | null
          debit?: number
          credit?: number
          resolved_account_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          qbo_account_name?: string
          qbo_account_id?: string | null
          debit?: number
          credit?: number
          resolved_account_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tb_unmatched_rows_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tb_unmatched_rows_resolved_account_id_fkey"
            columns: ["resolved_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_profiles: {
        Row: {
          id: string
          entity_id: string
          name: string
          commission_rate: number
          is_active: boolean
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          name: string
          commission_rate: number
          is_active?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          name?: string
          commission_rate?: number
          is_active?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_profiles_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_account_assignments: {
        Row: {
          id: string
          commission_profile_id: string
          account_id: string
          role: string
          class_filter_mode: string
          qbo_class_ids: string[]
          created_at: string
        }
        Insert: {
          id?: string
          commission_profile_id: string
          account_id: string
          role: string
          class_filter_mode?: string
          qbo_class_ids?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          commission_profile_id?: string
          account_id?: string
          role?: string
          class_filter_mode?: string
          qbo_class_ids?: string[]
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_account_assignments_commission_profile_id_fkey"
            columns: ["commission_profile_id"]
            referencedRelation: "commission_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_account_assignments_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_results: {
        Row: {
          id: string
          commission_profile_id: string
          entity_id: string
          period_year: number
          period_month: number
          total_revenue: number
          total_expenses: number
          commission_base: number
          commission_rate: number
          commission_earned: number
          is_payable: boolean
          marked_payable_at: string | null
          marked_payable_by: string | null
          is_paid: boolean
          paid_amount: number | null
          marked_paid_at: string | null
          marked_paid_by: string | null
          calculated_at: string
        }
        Insert: {
          id?: string
          commission_profile_id: string
          entity_id: string
          period_year: number
          period_month: number
          total_revenue?: number
          total_expenses?: number
          commission_base?: number
          commission_rate: number
          commission_earned?: number
          is_payable?: boolean
          marked_payable_at?: string | null
          marked_payable_by?: string | null
          is_paid?: boolean
          paid_amount?: number | null
          marked_paid_at?: string | null
          marked_paid_by?: string | null
          calculated_at?: string
        }
        Update: {
          id?: string
          commission_profile_id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          total_revenue?: number
          total_expenses?: number
          commission_base?: number
          commission_rate?: number
          commission_earned?: number
          is_payable?: boolean
          marked_payable_at?: string | null
          marked_payable_by?: string | null
          is_paid?: boolean
          paid_amount?: number | null
          marked_paid_at?: string | null
          marked_paid_by?: string | null
          calculated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_results_commission_profile_id_fkey"
            columns: ["commission_profile_id"]
            referencedRelation: "commission_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_results_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_classes: {
        Row: {
          id: string
          entity_id: string
          qbo_id: string
          name: string
          fully_qualified_name: string | null
          is_active: boolean
          parent_class_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          qbo_id: string
          name: string
          fully_qualified_name?: string | null
          is_active?: boolean
          parent_class_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          qbo_id?: string
          name?: string
          fully_qualified_name?: string | null
          is_active?: boolean
          parent_class_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_classes_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_classes_parent_class_id_fkey"
            columns: ["parent_class_id"]
            referencedRelation: "qbo_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_versions: {
        Row: {
          id: string
          entity_id: string
          name: string
          fiscal_year: number
          status: string
          is_active: boolean
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          name: string
          fiscal_year: number
          status?: string
          is_active?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          name?: string
          fiscal_year?: number
          status?: string
          is_active?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_versions_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_amounts: {
        Row: {
          id: string
          entity_id: string
          master_account_id: string
          budget_version_id: string
          period_year: number
          period_month: number
          amount: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          master_account_id: string
          budget_version_id: string
          period_year: number
          period_month: number
          amount?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          master_account_id?: string
          budget_version_id?: string
          period_year?: number
          period_month?: number
          amount?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_amounts_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_amounts_master_account_id_fkey"
            columns: ["master_account_id"]
            referencedRelation: "master_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_amounts_budget_version_id_fkey"
            columns: ["budget_version_id"]
            referencedRelation: "budget_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_class_balances: {
        Row: {
          id: string
          entity_id: string
          account_id: string
          qbo_class_id: string
          period_year: number
          period_month: number
          net_change: number
          synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          account_id: string
          qbo_class_id: string
          period_year: number
          period_month: number
          net_change?: number
          synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          account_id?: string
          qbo_class_id?: string
          period_year?: number
          period_month?: number
          net_change?: number
          synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gl_class_balances_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_class_balances_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_class_balances_qbo_class_id_fkey"
            columns: ["qbo_class_id"]
            referencedRelation: "qbo_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          id: string
          entity_id: string
          property_name: string
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          zip_code: string | null
          country: string | null
          property_type: string
          total_square_footage: number | null
          rentable_square_footage: number | null
          usable_square_footage: number | null
          lot_square_footage: number | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          property_name: string
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip_code?: string | null
          country?: string | null
          property_type?: string
          total_square_footage?: number | null
          rentable_square_footage?: number | null
          usable_square_footage?: number | null
          lot_square_footage?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          property_name?: string
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip_code?: string | null
          country?: string | null
          property_type?: string
          total_square_footage?: number | null
          rentable_square_footage?: number | null
          usable_square_footage?: number | null
          lot_square_footage?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      leases: {
        Row: {
          id: string
          entity_id: string
          property_id: string
          lease_name: string
          lessor_name: string | null
          lessor_contact_info: string | null
          lease_type: string
          status: string
          commencement_date: string
          rent_commencement_date: string | null
          expiration_date: string
          lease_term_months: number
          base_rent_monthly: number
          base_rent_annual: number
          rent_per_sf: number | null
          security_deposit: number
          tenant_improvement_allowance: number
          rent_abatement_months: number
          rent_abatement_amount: number
          discount_rate: number
          initial_direct_costs: number
          lease_incentives_received: number
          prepaid_rent: number
          fair_value_of_asset: number | null
          remaining_economic_life_months: number | null
          cam_monthly: number
          insurance_monthly: number
          property_tax_annual: number
          property_tax_frequency: string
          utilities_monthly: number
          other_monthly_costs: number
          other_monthly_costs_description: string | null
          maintenance_type: string
          permitted_use: string | null
          notes: string | null
          rou_asset_account_id: string | null
          lease_liability_account_id: string | null
          lease_expense_account_id: string | null
          interest_expense_account_id: string | null
          cam_expense_account_id: string | null
          asc842_adjustment_account_id: string | null
          cash_ap_account_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          property_id: string
          lease_name: string
          lessor_name?: string | null
          lessor_contact_info?: string | null
          lease_type?: string
          status?: string
          commencement_date: string
          rent_commencement_date?: string | null
          expiration_date: string
          lease_term_months: number
          base_rent_monthly?: number
          rent_per_sf?: number | null
          security_deposit?: number
          tenant_improvement_allowance?: number
          rent_abatement_months?: number
          rent_abatement_amount?: number
          discount_rate?: number
          initial_direct_costs?: number
          lease_incentives_received?: number
          prepaid_rent?: number
          fair_value_of_asset?: number | null
          remaining_economic_life_months?: number | null
          cam_monthly?: number
          insurance_monthly?: number
          property_tax_annual?: number
          property_tax_frequency?: string
          utilities_monthly?: number
          other_monthly_costs?: number
          other_monthly_costs_description?: string | null
          maintenance_type?: string
          permitted_use?: string | null
          notes?: string | null
          rou_asset_account_id?: string | null
          lease_liability_account_id?: string | null
          lease_expense_account_id?: string | null
          interest_expense_account_id?: string | null
          cam_expense_account_id?: string | null
          asc842_adjustment_account_id?: string | null
          cash_ap_account_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          property_id?: string
          lease_name?: string
          lessor_name?: string | null
          lessor_contact_info?: string | null
          lease_type?: string
          status?: string
          commencement_date?: string
          rent_commencement_date?: string | null
          expiration_date?: string
          lease_term_months?: number
          base_rent_monthly?: number
          rent_per_sf?: number | null
          security_deposit?: number
          tenant_improvement_allowance?: number
          rent_abatement_months?: number
          rent_abatement_amount?: number
          discount_rate?: number
          initial_direct_costs?: number
          lease_incentives_received?: number
          prepaid_rent?: number
          fair_value_of_asset?: number | null
          remaining_economic_life_months?: number | null
          cam_monthly?: number
          insurance_monthly?: number
          property_tax_annual?: number
          property_tax_frequency?: string
          utilities_monthly?: number
          other_monthly_costs?: number
          other_monthly_costs_description?: string | null
          maintenance_type?: string
          permitted_use?: string | null
          notes?: string | null
          rou_asset_account_id?: string | null
          lease_liability_account_id?: string | null
          lease_expense_account_id?: string | null
          interest_expense_account_id?: string | null
          cam_expense_account_id?: string | null
          asc842_adjustment_account_id?: string | null
          cash_ap_account_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lease_payments: {
        Row: {
          id: string
          lease_id: string
          period_year: number
          period_month: number
          payment_type: string
          scheduled_amount: number
          actual_amount: number | null
          is_paid: boolean
          payment_date: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          period_year: number
          period_month: number
          payment_type: string
          scheduled_amount?: number
          actual_amount?: number | null
          is_paid?: boolean
          payment_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          period_year?: number
          period_month?: number
          payment_type?: string
          scheduled_amount?: number
          actual_amount?: number | null
          is_paid?: boolean
          payment_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lease_escalations: {
        Row: {
          id: string
          lease_id: string
          escalation_type: string
          effective_date: string
          percentage_increase: number | null
          amount_increase: number | null
          cpi_index_name: string | null
          cpi_cap: number | null
          cpi_floor: number | null
          frequency: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          escalation_type: string
          effective_date: string
          percentage_increase?: number | null
          amount_increase?: number | null
          cpi_index_name?: string | null
          cpi_cap?: number | null
          cpi_floor?: number | null
          frequency?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          escalation_type?: string
          effective_date?: string
          percentage_increase?: number | null
          amount_increase?: number | null
          cpi_index_name?: string | null
          cpi_cap?: number | null
          cpi_floor?: number | null
          frequency?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lease_cost_splits: {
        Row: {
          id: string
          lease_id: string
          source_entity_id: string
          destination_entity_id: string
          split_type: string
          split_percentage: number | null
          split_fixed_amount: number | null
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          source_entity_id: string
          destination_entity_id: string
          split_type?: string
          split_percentage?: number | null
          split_fixed_amount?: number | null
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          source_entity_id?: string
          destination_entity_id?: string
          split_type?: string
          split_percentage?: number | null
          split_fixed_amount?: number | null
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lease_options: {
        Row: {
          id: string
          lease_id: string
          option_type: string
          exercise_deadline: string | null
          notice_required_days: number | null
          option_term_months: number | null
          option_rent_terms: string | null
          option_price: number | null
          penalty_amount: number | null
          is_reasonably_certain: boolean
          is_exercised: boolean
          exercised_date: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          option_type: string
          exercise_deadline?: string | null
          notice_required_days?: number | null
          option_term_months?: number | null
          option_rent_terms?: string | null
          option_price?: number | null
          penalty_amount?: number | null
          is_reasonably_certain?: boolean
          is_exercised?: boolean
          exercised_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          option_type?: string
          exercise_deadline?: string | null
          notice_required_days?: number | null
          option_term_months?: number | null
          option_rent_terms?: string | null
          option_price?: number | null
          penalty_amount?: number | null
          is_reasonably_certain?: boolean
          is_exercised?: boolean
          exercised_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lease_amendments: {
        Row: {
          id: string
          lease_id: string
          amendment_number: number
          effective_date: string
          description: string | null
          changed_fields: Record<string, unknown> | null
          previous_values: Record<string, unknown> | null
          new_values: Record<string, unknown> | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          amendment_number: number
          effective_date: string
          description?: string | null
          changed_fields?: Record<string, unknown> | null
          previous_values?: Record<string, unknown> | null
          new_values?: Record<string, unknown> | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          amendment_number?: number
          effective_date?: string
          description?: string | null
          changed_fields?: Record<string, unknown> | null
          previous_values?: Record<string, unknown> | null
          new_values?: Record<string, unknown> | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lease_critical_dates: {
        Row: {
          id: string
          lease_id: string
          date_type: string
          critical_date: string
          alert_days_before: number
          description: string | null
          is_resolved: boolean
          resolved_date: string | null
          resolved_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          date_type: string
          critical_date: string
          alert_days_before?: number
          description?: string | null
          is_resolved?: boolean
          resolved_date?: string | null
          resolved_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          date_type?: string
          critical_date?: string
          alert_days_before?: number
          description?: string | null
          is_resolved?: boolean
          resolved_date?: string | null
          resolved_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lease_documents: {
        Row: {
          id: string
          lease_id: string
          document_type: string
          file_name: string
          file_path: string
          file_size_bytes: number | null
          uploaded_by: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          document_type?: string
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          uploaded_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          document_type?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          uploaded_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      subleases: {
        Row: {
          id: string
          lease_id: string
          entity_id: string
          sublease_name: string
          subtenant_name: string
          subtenant_contact_info: string | null
          status: string
          commencement_date: string
          rent_commencement_date: string | null
          expiration_date: string
          sublease_term_months: number
          subleased_square_footage: number | null
          floor_suite: string | null
          base_rent_monthly: number
          base_rent_annual: number
          rent_per_sf: number | null
          security_deposit_held: number
          rent_abatement_months: number
          rent_abatement_amount: number
          cam_recovery_monthly: number
          insurance_recovery_monthly: number
          property_tax_recovery_monthly: number
          utilities_recovery_monthly: number
          other_recovery_monthly: number
          other_recovery_description: string | null
          maintenance_type: string
          permitted_use: string | null
          notes: string | null
          sublease_income_account_id: string | null
          cam_recovery_account_id: string | null
          other_income_account_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          entity_id: string
          sublease_name: string
          subtenant_name: string
          subtenant_contact_info?: string | null
          status?: string
          commencement_date: string
          rent_commencement_date?: string | null
          expiration_date: string
          sublease_term_months: number
          subleased_square_footage?: number | null
          floor_suite?: string | null
          base_rent_monthly?: number
          rent_per_sf?: number | null
          security_deposit_held?: number
          rent_abatement_months?: number
          rent_abatement_amount?: number
          cam_recovery_monthly?: number
          insurance_recovery_monthly?: number
          property_tax_recovery_monthly?: number
          utilities_recovery_monthly?: number
          other_recovery_monthly?: number
          other_recovery_description?: string | null
          maintenance_type?: string
          permitted_use?: string | null
          notes?: string | null
          sublease_income_account_id?: string | null
          cam_recovery_account_id?: string | null
          other_income_account_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lease_id?: string
          entity_id?: string
          sublease_name?: string
          subtenant_name?: string
          subtenant_contact_info?: string | null
          status?: string
          commencement_date?: string
          rent_commencement_date?: string | null
          expiration_date?: string
          sublease_term_months?: number
          subleased_square_footage?: number | null
          floor_suite?: string | null
          base_rent_monthly?: number
          rent_per_sf?: number | null
          security_deposit_held?: number
          rent_abatement_months?: number
          rent_abatement_amount?: number
          cam_recovery_monthly?: number
          insurance_recovery_monthly?: number
          property_tax_recovery_monthly?: number
          utilities_recovery_monthly?: number
          other_recovery_monthly?: number
          other_recovery_description?: string | null
          maintenance_type?: string
          permitted_use?: string | null
          notes?: string | null
          sublease_income_account_id?: string | null
          cam_recovery_account_id?: string | null
          other_income_account_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sublease_payments: {
        Row: {
          id: string
          sublease_id: string
          period_year: number
          period_month: number
          payment_type: string
          scheduled_amount: number
          actual_amount: number | null
          is_received: boolean
          received_date: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sublease_id: string
          period_year: number
          period_month: number
          payment_type: string
          scheduled_amount?: number
          actual_amount?: number | null
          is_received?: boolean
          received_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sublease_id?: string
          period_year?: number
          period_month?: number
          payment_type?: string
          scheduled_amount?: number
          actual_amount?: number | null
          is_received?: boolean
          received_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sublease_escalations: {
        Row: {
          id: string
          sublease_id: string
          escalation_type: string
          effective_date: string
          percentage_increase: number | null
          amount_increase: number | null
          cpi_index_name: string | null
          cpi_cap: number | null
          cpi_floor: number | null
          frequency: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sublease_id: string
          escalation_type: string
          effective_date: string
          percentage_increase?: number | null
          amount_increase?: number | null
          cpi_index_name?: string | null
          cpi_cap?: number | null
          cpi_floor?: number | null
          frequency?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sublease_id?: string
          escalation_type?: string
          effective_date?: string
          percentage_increase?: number | null
          amount_increase?: number | null
          cpi_index_name?: string | null
          cpi_cap?: number | null
          cpi_floor?: number | null
          frequency?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sublease_options: {
        Row: {
          id: string
          sublease_id: string
          option_type: string
          exercise_deadline: string | null
          notice_required_days: number | null
          option_term_months: number | null
          option_rent_terms: string | null
          option_price: number | null
          penalty_amount: number | null
          is_exercised: boolean
          exercised_date: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sublease_id: string
          option_type: string
          exercise_deadline?: string | null
          notice_required_days?: number | null
          option_term_months?: number | null
          option_rent_terms?: string | null
          option_price?: number | null
          penalty_amount?: number | null
          is_exercised?: boolean
          exercised_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sublease_id?: string
          option_type?: string
          exercise_deadline?: string | null
          notice_required_days?: number | null
          option_term_months?: number | null
          option_rent_terms?: string | null
          option_price?: number | null
          penalty_amount?: number | null
          is_exercised?: boolean
          exercised_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sublease_critical_dates: {
        Row: {
          id: string
          sublease_id: string
          date_type: string
          critical_date: string
          alert_days_before: number
          description: string | null
          is_resolved: boolean
          resolved_date: string | null
          resolved_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sublease_id: string
          date_type: string
          critical_date: string
          alert_days_before?: number
          description?: string | null
          is_resolved?: boolean
          resolved_date?: string | null
          resolved_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sublease_id?: string
          date_type?: string
          critical_date?: string
          alert_days_before?: number
          description?: string | null
          is_resolved?: boolean
          resolved_date?: string | null
          resolved_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sublease_documents: {
        Row: {
          id: string
          sublease_id: string
          document_type: string
          file_name: string
          file_path: string
          file_size_bytes: number | null
          uploaded_by: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          sublease_id: string
          document_type?: string
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          uploaded_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          sublease_id?: string
          document_type?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          uploaded_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      rebate_customers: {
        Row: {
          id: string
          entity_id: string
          customer_name: string
          rw_customer_id: string | null
          agreement_type: string
          status: string
          tax_rate: number
          max_discount_percent: number | null
          effective_date: string | null
          use_global_exclusions: boolean
          contract_storage_path: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          customer_name: string
          rw_customer_id?: string | null
          agreement_type: string
          status?: string
          tax_rate?: number
          max_discount_percent?: number | null
          effective_date?: string | null
          use_global_exclusions?: boolean
          contract_storage_path?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          customer_name?: string
          rw_customer_id?: string
          agreement_type?: string
          status?: string
          tax_rate?: number
          max_discount_percent?: number | null
          effective_date?: string | null
          use_global_exclusions?: boolean
          contract_storage_path?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rebate_customers_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rebate_customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      rebate_tiers: {
        Row: {
          id: string
          rebate_customer_id: string
          label: string
          threshold_min: number
          threshold_max: number | null
          sort_order: number
          rate_pro_supplies: number
          rate_vehicle: number
          rate_grip_lighting: number
          rate_studio: number
          max_disc_pro_supplies: number
          max_disc_vehicle: number
          max_disc_grip_lighting: number
          max_disc_studio: number
          created_at: string
        }
        Insert: {
          id?: string
          rebate_customer_id: string
          label: string
          threshold_min?: number
          threshold_max?: number | null
          sort_order?: number
          rate_pro_supplies?: number
          rate_vehicle?: number
          rate_grip_lighting?: number
          rate_studio?: number
          max_disc_pro_supplies?: number
          max_disc_vehicle?: number
          max_disc_grip_lighting?: number
          max_disc_studio?: number
          created_at?: string
        }
        Update: {
          id?: string
          rebate_customer_id?: string
          label?: string
          threshold_min?: number
          threshold_max?: number | null
          sort_order?: number
          rate_pro_supplies?: number
          rate_vehicle?: number
          rate_grip_lighting?: number
          rate_studio?: number
          max_disc_pro_supplies?: number
          max_disc_vehicle?: number
          max_disc_grip_lighting?: number
          max_disc_studio?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rebate_tiers_rebate_customer_id_fkey"
            columns: ["rebate_customer_id"]
            isOneToOne: false
            referencedRelation: "rebate_customers"
            referencedColumns: ["id"]
          }
        ]
      }
      rebate_excluded_icodes: {
        Row: {
          id: string
          entity_id: string
          rebate_customer_id: string | null
          i_code: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          rebate_customer_id?: string | null
          i_code: string
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          rebate_customer_id?: string | null
          i_code?: string
          description?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rebate_excluded_icodes_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rebate_excluded_icodes_rebate_customer_id_fkey"
            columns: ["rebate_customer_id"]
            isOneToOne: false
            referencedRelation: "rebate_customers"
            referencedColumns: ["id"]
          }
        ]
      }
      rebate_invoices: {
        Row: {
          id: string
          entity_id: string
          rebate_customer_id: string
          rw_invoice_id: string
          invoice_number: string
          invoice_date: string | null
          billing_start_date: string | null
          billing_end_date: string | null
          status: string | null
          customer_name: string | null
          deal: string | null
          order_number: string | null
          order_description: string | null
          purchase_order_number: string | null
          list_total: number
          gross_total: number
          sub_total: number
          tax_amount: number
          discount_amount: number
          equipment_type: string
          excluded_total: number | null
          taxable_sales: number | null
          before_discount: number | null
          discount_percent: number | null
          final_amount: number | null
          tier_label: string | null
          rebate_rate: number | null
          remaining_rebate_pct: number | null
          net_rebate: number | null
          cumulative_revenue: number | null
          cumulative_rebate: number | null
          quarter: string | null
          is_manually_excluded: boolean
          manual_exclusion_reason: string | null
          synced_at: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          rebate_customer_id: string
          rw_invoice_id: string
          invoice_number: string
          invoice_date?: string | null
          billing_start_date?: string | null
          billing_end_date?: string | null
          status?: string | null
          customer_name?: string | null
          deal?: string | null
          order_number?: string | null
          order_description?: string | null
          purchase_order_number?: string | null
          list_total?: number
          gross_total?: number
          sub_total?: number
          tax_amount?: number
          discount_amount?: number
          equipment_type?: string
          excluded_total?: number | null
          taxable_sales?: number | null
          before_discount?: number | null
          discount_percent?: number | null
          final_amount?: number | null
          tier_label?: string | null
          rebate_rate?: number | null
          remaining_rebate_pct?: number | null
          net_rebate?: number | null
          cumulative_revenue?: number | null
          cumulative_rebate?: number | null
          quarter?: string | null
          is_manually_excluded?: boolean
          manual_exclusion_reason?: string | null
          synced_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          rebate_customer_id?: string
          rw_invoice_id?: string
          invoice_number?: string
          invoice_date?: string | null
          billing_start_date?: string | null
          billing_end_date?: string | null
          status?: string | null
          customer_name?: string | null
          deal?: string | null
          order_number?: string | null
          order_description?: string | null
          purchase_order_number?: string | null
          list_total?: number
          gross_total?: number
          sub_total?: number
          tax_amount?: number
          discount_amount?: number
          equipment_type?: string
          excluded_total?: number | null
          taxable_sales?: number | null
          before_discount?: number | null
          discount_percent?: number | null
          final_amount?: number | null
          tier_label?: string | null
          rebate_rate?: number | null
          remaining_rebate_pct?: number | null
          net_rebate?: number | null
          cumulative_revenue?: number | null
          cumulative_rebate?: number | null
          quarter?: string | null
          is_manually_excluded?: boolean
          manual_exclusion_reason?: string | null
          synced_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rebate_invoices_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rebate_invoices_rebate_customer_id_fkey"
            columns: ["rebate_customer_id"]
            isOneToOne: false
            referencedRelation: "rebate_customers"
            referencedColumns: ["id"]
          }
        ]
      }
      rebate_invoice_items: {
        Row: {
          id: string
          rebate_invoice_id: string
          rw_item_id: string | null
          i_code: string | null
          description: string | null
          quantity: number | null
          extended: number | null
          is_excluded: boolean
          record_type: string | null
          created_at: string
        }
        Insert: {
          id?: string
          rebate_invoice_id: string
          rw_item_id?: string | null
          i_code?: string | null
          description?: string | null
          quantity?: number | null
          extended?: number | null
          is_excluded?: boolean
          record_type?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          rebate_invoice_id?: string
          rw_item_id?: string | null
          i_code?: string | null
          description?: string | null
          quantity?: number | null
          extended?: number | null
          is_excluded?: boolean
          record_type?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rebate_invoice_items_rebate_invoice_id_fkey"
            columns: ["rebate_invoice_id"]
            isOneToOne: false
            referencedRelation: "rebate_invoices"
            referencedColumns: ["id"]
          }
        ]
      }
      rebate_quarterly_summaries: {
        Row: {
          id: string
          entity_id: string
          rebate_customer_id: string
          quarter: string
          year: number
          quarter_num: number
          total_revenue: number | null
          total_list_revenue: number
          total_rebate: number | null
          invoice_count: number | null
          tier_label: string | null
          is_paid: boolean
          paid_at: string | null
          paid_by: string | null
          calculated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          rebate_customer_id: string
          quarter: string
          year: number
          quarter_num: number
          total_revenue?: number | null
          total_list_revenue?: number
          total_rebate?: number | null
          invoice_count?: number | null
          tier_label?: string | null
          is_paid?: boolean
          paid_at?: string | null
          paid_by?: string | null
          calculated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          rebate_customer_id?: string
          quarter?: string
          year?: number
          quarter_num?: number
          total_revenue?: number | null
          total_list_revenue?: number
          total_rebate?: number | null
          invoice_count?: number | null
          tier_label?: string | null
          is_paid?: boolean
          paid_at?: string | null
          paid_by?: string | null
          calculated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rebate_quarterly_summaries_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rebate_quarterly_summaries_rebate_customer_id_fkey"
            columns: ["rebate_customer_id"]
            isOneToOne: false
            referencedRelation: "rebate_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rebate_quarterly_summaries_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      employee_allocations: {
        Row: {
          id: string
          employee_id: string
          paylocity_company_id: string
          department: string | null
          class: string | null
          allocated_entity_id: string | null
          allocated_entity_name: string | null
          effective_date: string
          created_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          employee_id: string
          paylocity_company_id: string
          department?: string | null
          class?: string | null
          allocated_entity_id?: string | null
          allocated_entity_name?: string | null
          effective_date?: string
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          paylocity_company_id?: string
          department?: string | null
          class?: string | null
          allocated_entity_id?: string | null
          allocated_entity_name?: string | null
          effective_date?: string
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      // ── Insurance Module ──────────────────────────────────────────
      insurance_carriers: {
        Row: {
          id: string
          entity_id: string
          name: string
          am_best_rating: string | null
          naic_number: string | null
          contact_name: string | null
          contact_email: string | null
          contact_phone: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          name: string
          am_best_rating?: string | null
          naic_number?: string | null
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          name?: string
          am_best_rating?: string | null
          naic_number?: string | null
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_brokers: {
        Row: {
          id: string
          entity_id: string
          name: string
          license_number: string | null
          contact_name: string | null
          contact_email: string | null
          contact_phone: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          name: string
          license_number?: string | null
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          name?: string
          license_number?: string | null
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_policies: {
        Row: {
          id: string
          entity_id: string
          carrier_id: string | null
          broker_id: string | null
          policy_number: string | null
          policy_type: string
          line_of_business: string | null
          named_insured: string | null
          named_insured_entity: string | null
          status: string
          effective_date: string | null
          expiration_date: string | null
          annual_premium: number
          prior_year_premium: number
          premium_change_pct: number
          payment_terms: string
          installment_description: string | null
          billing_company: string | null
          deposit_held: number
          is_auditable: boolean
          coverage_territory: string | null
          notes: string | null
          renewal_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          carrier_id?: string | null
          broker_id?: string | null
          policy_number?: string | null
          policy_type?: string
          line_of_business?: string | null
          named_insured?: string | null
          named_insured_entity?: string | null
          status?: string
          effective_date?: string | null
          expiration_date?: string | null
          annual_premium?: number
          prior_year_premium?: number
          premium_change_pct?: number
          payment_terms?: string
          installment_description?: string | null
          billing_company?: string | null
          deposit_held?: number
          is_auditable?: boolean
          coverage_territory?: string | null
          notes?: string | null
          renewal_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          carrier_id?: string | null
          broker_id?: string | null
          policy_number?: string | null
          policy_type?: string
          line_of_business?: string | null
          named_insured?: string | null
          named_insured_entity?: string | null
          status?: string
          effective_date?: string | null
          expiration_date?: string | null
          annual_premium?: number
          prior_year_premium?: number
          premium_change_pct?: number
          payment_terms?: string
          installment_description?: string | null
          billing_company?: string | null
          deposit_held?: number
          is_auditable?: boolean
          coverage_territory?: string | null
          notes?: string | null
          renewal_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_coverages: {
        Row: {
          id: string
          policy_id: string
          coverage_name: string
          coverage_form: string
          limit_per_occurrence: number | null
          limit_aggregate: number | null
          limit_description: string | null
          deductible: number | null
          deductible_description: string | null
          self_insured_retention: number | null
          coinsurance_pct: number | null
          sub_limit: number | null
          sub_limit_description: string | null
          is_included: boolean
          prior_year_limit: number | null
          prior_year_deductible: number | null
          notes: string | null
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          policy_id: string
          coverage_name: string
          coverage_form?: string
          limit_per_occurrence?: number | null
          limit_aggregate?: number | null
          limit_description?: string | null
          deductible?: number | null
          deductible_description?: string | null
          self_insured_retention?: number | null
          coinsurance_pct?: number | null
          sub_limit?: number | null
          sub_limit_description?: string | null
          is_included?: boolean
          prior_year_limit?: number | null
          prior_year_deductible?: number | null
          notes?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          policy_id?: string
          coverage_name?: string
          coverage_form?: string
          limit_per_occurrence?: number | null
          limit_aggregate?: number | null
          limit_description?: string | null
          deductible?: number | null
          deductible_description?: string | null
          self_insured_retention?: number | null
          coinsurance_pct?: number | null
          sub_limit?: number | null
          sub_limit_description?: string | null
          is_included?: boolean
          prior_year_limit?: number | null
          prior_year_deductible?: number | null
          notes?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_payment_schedules: {
        Row: {
          id: string
          policy_id: string
          period_month: number
          period_year: number
          due_date: string | null
          amount_due: number
          amount_paid: number
          payment_date: string | null
          payment_status: string
          payment_method: string | null
          reference_number: string | null
          is_estimate: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          policy_id: string
          period_month: number
          period_year: number
          due_date?: string | null
          amount_due?: number
          amount_paid?: number
          payment_date?: string | null
          payment_status?: string
          payment_method?: string | null
          reference_number?: string | null
          is_estimate?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          policy_id?: string
          period_month?: number
          period_year?: number
          due_date?: string | null
          amount_due?: number
          amount_paid?: number
          payment_date?: string | null
          payment_status?: string
          payment_method?: string | null
          reference_number?: string | null
          is_estimate?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_locations: {
        Row: {
          id: string
          policy_id: string
          location_code: string | null
          address: string
          city: string | null
          state: string | null
          zip_code: string | null
          occupancy_description: string | null
          building_value: number
          bpp_value: number
          business_income_value: number
          rental_income_value: number
          total_insured_value: number
          is_active: boolean
          location_type: string
          class_code: string | null
          class_description: string | null
          notes: string | null
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          policy_id: string
          location_code?: string | null
          address: string
          city?: string | null
          state?: string | null
          zip_code?: string | null
          occupancy_description?: string | null
          building_value?: number
          bpp_value?: number
          business_income_value?: number
          rental_income_value?: number
          is_active?: boolean
          location_type?: string
          class_code?: string | null
          class_description?: string | null
          notes?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          policy_id?: string
          location_code?: string | null
          address?: string
          city?: string | null
          state?: string | null
          zip_code?: string | null
          occupancy_description?: string | null
          building_value?: number
          bpp_value?: number
          business_income_value?: number
          rental_income_value?: number
          is_active?: boolean
          location_type?: string
          class_code?: string | null
          class_description?: string | null
          notes?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_exposures: {
        Row: {
          id: string
          policy_id: string
          period_month: number | null
          period_year: number | null
          exposure_type: string
          exposure_value: number | null
          rate: number | null
          calculated_premium: number | null
          is_reported: boolean
          reported_date: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          policy_id: string
          period_month?: number | null
          period_year?: number | null
          exposure_type?: string
          exposure_value?: number | null
          rate?: number | null
          calculated_premium?: number | null
          is_reported?: boolean
          reported_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          policy_id?: string
          period_month?: number | null
          period_year?: number | null
          exposure_type?: string
          exposure_value?: number | null
          rate?: number | null
          calculated_premium?: number | null
          is_reported?: boolean
          reported_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_allocations: {
        Row: {
          id: string
          policy_id: string
          target_entity_id: string
          allocation_method: string
          allocation_pct: number
          allocated_amount: number
          period_month: number | null
          period_year: number | null
          gl_account_id: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          policy_id: string
          target_entity_id: string
          allocation_method?: string
          allocation_pct?: number
          allocated_amount?: number
          period_month?: number | null
          period_year?: number | null
          gl_account_id?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          policy_id?: string
          target_entity_id?: string
          allocation_method?: string
          allocation_pct?: number
          allocated_amount?: number
          period_month?: number | null
          period_year?: number | null
          gl_account_id?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_claims: {
        Row: {
          id: string
          policy_id: string
          entity_id: string
          claim_number: string | null
          date_of_loss: string | null
          date_reported: string | null
          claimant_name: string | null
          description: string | null
          status: string
          amount_reserved: number
          amount_paid: number
          amount_recovered: number
          adjuster_name: string | null
          adjuster_contact: string | null
          location_id: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          policy_id: string
          entity_id: string
          claim_number?: string | null
          date_of_loss?: string | null
          date_reported?: string | null
          claimant_name?: string | null
          description?: string | null
          status?: string
          amount_reserved?: number
          amount_paid?: number
          amount_recovered?: number
          adjuster_name?: string | null
          adjuster_contact?: string | null
          location_id?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          policy_id?: string
          entity_id?: string
          claim_number?: string | null
          date_of_loss?: string | null
          date_reported?: string | null
          claimant_name?: string | null
          description?: string | null
          status?: string
          amount_reserved?: number
          amount_paid?: number
          amount_recovered?: number
          adjuster_name?: string | null
          adjuster_contact?: string | null
          location_id?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_documents: {
        Row: {
          id: string
          policy_id: string | null
          entity_id: string
          document_type: string
          file_name: string
          file_path: string | null
          storage_key: string | null
          file_size_bytes: number | null
          uploaded_by: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          policy_id?: string | null
          entity_id: string
          document_type?: string
          file_name: string
          file_path?: string | null
          storage_key?: string | null
          file_size_bytes?: number | null
          uploaded_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          policy_id?: string | null
          entity_id?: string
          document_type?: string
          file_name?: string
          file_path?: string | null
          storage_key?: string | null
          file_size_bytes?: number | null
          uploaded_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      insurance_exclusions: {
        Row: {
          id: string
          policy_id: string
          exclusion_name: string
          is_excluded: boolean
          exception_description: string | null
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          policy_id: string
          exclusion_name: string
          is_excluded?: boolean
          exception_description?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          policy_id?: string
          exclusion_name?: string
          is_excluded?: boolean
          exception_description?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_subjectivities: {
        Row: {
          id: string
          policy_id: string
          description: string
          due_date: string | null
          status: string
          completed_date: string | null
          completed_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          policy_id: string
          description: string
          due_date?: string | null
          status?: string
          completed_date?: string | null
          completed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          policy_id?: string
          description?: string
          due_date?: string | null
          status?: string
          completed_date?: string | null
          completed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      debt_reconciliation_accounts: {
        Row: {
          id: string
          entity_id: string
          gl_account_group: string
          account_id: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          gl_account_group: string
          account_id: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          gl_account_group?: string
          account_id?: string
          created_at?: string
        }
        Relationships: []
      }
      debt_reconciliations: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          gl_account_group: string
          gl_balance: number | null
          subledger_balance: number | null
          variance: number | null
          is_reconciled: boolean
          reconciled_by: string | null
          reconciled_at: string | null
          notes: string | null
          prior_period_adjustment: number
          prior_period_adjustment_note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          gl_account_group: string
          gl_balance?: number | null
          subledger_balance?: number | null
          variance?: number | null
          is_reconciled?: boolean
          reconciled_by?: string | null
          reconciled_at?: string | null
          notes?: string | null
          prior_period_adjustment?: number
          prior_period_adjustment_note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          gl_account_group?: string
          gl_balance?: number | null
          subledger_balance?: number | null
          variance?: number | null
          is_reconciled?: boolean
          reconciled_by?: string | null
          reconciled_at?: string | null
          notes?: string | null
          prior_period_adjustment?: number
          prior_period_adjustment_note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      asset_reconciliations: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          gl_account_group: string
          gl_balance: number | null
          subledger_balance: number | null
          variance: number | null
          is_reconciled: boolean
          reconciled_by: string | null
          reconciled_at: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          gl_account_group: string
          gl_balance?: number | null
          subledger_balance?: number | null
          variance?: number | null
          is_reconciled?: boolean
          reconciled_by?: string | null
          reconciled_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          gl_account_group?: string
          gl_balance?: number | null
          subledger_balance?: number | null
          variance?: number | null
          is_reconciled?: boolean
          reconciled_by?: string | null
          reconciled_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      drift_monitored_accounts: {
        Row: {
          id: string
          entity_id: string
          account_id: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          account_id: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          account_id?: string
          created_at?: string
        }
        Relationships: []
      }
      drift_snapshots: {
        Row: {
          id: string
          entity_id: string
          account_id: string
          period_year: number
          period_month: number
          ending_balance: number
          snapshot_date: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          account_id: string
          period_year: number
          period_month: number
          ending_balance: number
          snapshot_date?: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          account_id?: string
          period_year?: number
          period_month?: number
          ending_balance?: number
          snapshot_date?: string
          created_at?: string
        }
        Relationships: []
      }
      drift_alerts: {
        Row: {
          id: string
          entity_id: string
          account_id: string
          period_year: number
          period_month: number
          previous_balance: number
          current_balance: number
          drift_amount: number
          snapshot_date: string
          previous_snapshot_date: string
          is_dismissed: boolean
          dismissed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          account_id: string
          period_year: number
          period_month: number
          previous_balance: number
          current_balance: number
          drift_amount: number
          snapshot_date: string
          previous_snapshot_date: string
          is_dismissed?: boolean
          dismissed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          account_id?: string
          period_year?: number
          period_month?: number
          previous_balance?: number
          current_balance?: number
          drift_amount?: number
          snapshot_date?: string
          previous_snapshot_date?: string
          is_dismissed?: boolean
          dismissed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      custom_vehicle_classes: {
        Row: {
          id: string
          organization_id: string
          entity_id: string | null
          class_code: string
          class_name: string
          reporting_group: string
          master_type: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          entity_id?: string | null
          class_code: string
          class_name: string
          reporting_group: string
          master_type: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          entity_id?: string | null
          class_code?: string
          class_name?: string
          reporting_group?: string
          master_type?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      asset_recon_gl_links: {
        Row: {
          id: string
          entity_id: string
          recon_group: string
          account_id: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          recon_group: string
          account_id: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          recon_group?: string
          account_id?: string
          created_at?: string
        }
        Relationships: []
      }
      rw_invoices_cache: {
        Row: {
          rw_invoice_id: string
          invoice_number: string | null
          invoice_date: string | null
          billing_start_date: string | null
          billing_end_date: string | null
          status: string | null
          customer: string | null
          customer_id: string | null
          warehouse: string | null
          deal: string | null
          order_number: string | null
          order_description: string | null
          invoice_description: string | null
          list_total: number
          gross_total: number
          sub_total: number
          tax_amount: number
          discount_amount: number
          rw_modified_at: string | null
          items_synced_at: string | null
          header_synced_at: string
        }
        Insert: {
          rw_invoice_id: string
          invoice_number?: string | null
          invoice_date?: string | null
          billing_start_date?: string | null
          billing_end_date?: string | null
          status?: string | null
          customer?: string | null
          customer_id?: string | null
          warehouse?: string | null
          deal?: string | null
          order_number?: string | null
          order_description?: string | null
          invoice_description?: string | null
          list_total?: number
          gross_total?: number
          sub_total?: number
          tax_amount?: number
          discount_amount?: number
          rw_modified_at?: string | null
          items_synced_at?: string | null
          header_synced_at?: string
        }
        Update: {
          rw_invoice_id?: string
          invoice_number?: string | null
          invoice_date?: string | null
          billing_start_date?: string | null
          billing_end_date?: string | null
          status?: string | null
          customer?: string | null
          customer_id?: string | null
          warehouse?: string | null
          deal?: string | null
          order_number?: string | null
          order_description?: string | null
          invoice_description?: string | null
          list_total?: number
          gross_total?: number
          sub_total?: number
          tax_amount?: number
          discount_amount?: number
          rw_modified_at?: string | null
          items_synced_at?: string | null
          header_synced_at?: string
        }
        Relationships: []
      }
      rw_invoice_items: {
        Row: {
          id: string
          rw_invoice_id: string
          rw_invoice_item_id: string
          invoice_number: string | null
          invoice_date: string | null
          billing_start_date: string | null
          billing_end_date: string | null
          customer: string | null
          warehouse: string | null
          status: string | null
          i_code: string | null
          description: string | null
          quantity: number
          rate: number
          extended: number
          rec_type: string | null
          item_class: string | null
          inventory_id: string | null
          item_id: string | null
          deal: string | null
          order_number: string | null
          synced_at: string
        }
        Insert: {
          id?: string
          rw_invoice_id: string
          rw_invoice_item_id: string
          invoice_number?: string | null
          invoice_date?: string | null
          billing_start_date?: string | null
          billing_end_date?: string | null
          customer?: string | null
          warehouse?: string | null
          status?: string | null
          i_code?: string | null
          description?: string | null
          quantity?: number
          rate?: number
          extended?: number
          rec_type?: string | null
          item_class?: string | null
          inventory_id?: string | null
          item_id?: string | null
          deal?: string | null
          order_number?: string | null
          synced_at?: string
        }
        Update: {
          id?: string
          rw_invoice_id?: string
          rw_invoice_item_id?: string
          invoice_number?: string | null
          invoice_date?: string | null
          billing_start_date?: string | null
          billing_end_date?: string | null
          customer?: string | null
          warehouse?: string | null
          status?: string | null
          i_code?: string | null
          description?: string | null
          quantity?: number
          rate?: number
          extended?: number
          rec_type?: string | null
          item_class?: string | null
          inventory_id?: string | null
          item_id?: string | null
          deal?: string | null
          order_number?: string | null
          synced_at?: string
        }
        Relationships: []
      }
      rw_revenue_snapshots: {
        Row: {
          id: string
          entity_id: string
          snapshot_date: string
          ytd_revenue: number
          current_month_actual: number
          current_month_projected: number
          pipeline_value: number
          quote_opportunities: number
          pipeline_order_count: number
          pipeline_quote_count: number
          closed_invoice_count: number
          full_payload: Json
          date_mode: string
          data_as_of: string
          created_at: string
        }
        Insert: {
          id?: string
          entity_id: string
          snapshot_date?: string
          ytd_revenue: number
          current_month_actual: number
          current_month_projected: number
          pipeline_value: number
          quote_opportunities: number
          pipeline_order_count?: number
          pipeline_quote_count?: number
          closed_invoice_count?: number
          full_payload: Json
          date_mode?: string
          data_as_of: string
          created_at?: string
        }
        Update: {
          id?: string
          entity_id?: string
          snapshot_date?: string
          ytd_revenue?: number
          current_month_actual?: number
          current_month_projected?: number
          pipeline_value?: number
          quote_opportunities?: number
          pipeline_order_count?: number
          pipeline_quote_count?: number
          closed_invoice_count?: number
          full_payload?: Json
          date_mode?: string
          data_as_of?: string
          created_at?: string
        }
        Relationships: []
      }
      rw_revenue_snapshot_months: {
        Row: {
          id: string
          snapshot_id: string
          entity_id: string
          snapshot_date: string
          month_key: string
          month_label: string
          closed: number
          pending: number
          pipeline: number
          forecast: number | null
          billed: number
          earned: number
          accrued: number
          deferred: number
        }
        Insert: {
          id?: string
          snapshot_id: string
          entity_id: string
          snapshot_date: string
          month_key: string
          month_label: string
          closed?: number
          pending?: number
          pipeline?: number
          forecast?: number | null
          billed?: number
          earned?: number
          accrued?: number
          deferred?: number
        }
        Update: {
          id?: string
          snapshot_id?: string
          entity_id?: string
          snapshot_date?: string
          month_key?: string
          month_label?: string
          closed?: number
          pending?: number
          pipeline?: number
          forecast?: number | null
          billed?: number
          earned?: number
          accrued?: number
          deferred?: number
        }
        Relationships: []
      }
      debt_transaction_documents: {
        Row: {
          id: string
          transaction_id: string
          file_name: string
          file_path: string
          file_size_bytes: number | null
          uploaded_by: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          transaction_id: string
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          uploaded_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          transaction_id?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          uploaded_by?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      entity_accrual_config: {
        Row: {
          id: string
          entity_id: string
          realization_rate: number
          notes: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
          unbilled_receivables_account_id: string | null
          allowance_account_id: string | null
          accrued_revenue_account_id: string | null
          deferred_revenue_account_id: string | null
          unbilled_revenue_account_id: string | null
        }
        Insert: {
          id?: string
          entity_id: string
          realization_rate?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
          unbilled_receivables_account_id?: string | null
          allowance_account_id?: string | null
          accrued_revenue_account_id?: string | null
          deferred_revenue_account_id?: string | null
          unbilled_revenue_account_id?: string | null
        }
        Update: {
          id?: string
          entity_id?: string
          realization_rate?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
          unbilled_receivables_account_id?: string | null
          allowance_account_id?: string | null
          accrued_revenue_account_id?: string | null
          deferred_revenue_account_id?: string | null
          unbilled_revenue_account_id?: string | null
        }
        Relationships: []
      }
      accrual_close_periods: {
        Row: {
          id: string
          entity_id: string
          period_year: number
          period_month: number
          close_as_of_date: string
          realization_rate_used: number
          gross_unbilled_earned: number
          expected_discount: number
          net_unbilled_earned: number
          timing_accrual: number
          timing_deferral: number
          total_net_accrual: number
          total_net_deferral: number
          line_count: number
          notes: string | null
          closed_at: string
          closed_by: string | null
          status: string
        }
        Insert: {
          id?: string
          entity_id: string
          period_year: number
          period_month: number
          close_as_of_date: string
          realization_rate_used: number
          gross_unbilled_earned?: number
          expected_discount?: number
          net_unbilled_earned?: number
          timing_accrual?: number
          timing_deferral?: number
          total_net_accrual?: number
          total_net_deferral?: number
          line_count?: number
          notes?: string | null
          closed_at?: string
          closed_by?: string | null
          status?: string
        }
        Update: {
          id?: string
          entity_id?: string
          period_year?: number
          period_month?: number
          close_as_of_date?: string
          realization_rate_used?: number
          gross_unbilled_earned?: number
          expected_discount?: number
          net_unbilled_earned?: number
          timing_accrual?: number
          timing_deferral?: number
          total_net_accrual?: number
          total_net_deferral?: number
          line_count?: number
          notes?: string | null
          closed_at?: string
          closed_by?: string | null
          status?: string
        }
        Relationships: []
      }
      accrual_close_lines: {
        Row: {
          id: string
          close_period_id: string
          entity_id: string
          line_type: string
          order_number: string | null
          invoice_number: string | null
          customer: string | null
          order_description: string | null
          rental_start_date: string | null
          rental_end_date: string | null
          gross_amount: number
          realization_rate_applied: number
          expected_discount: number
          net_amount: number
          matched_invoice_number: string | null
          matched_invoice_date: string | null
          actual_invoice_subtotal: number | null
          variance_amount: number | null
          line_status: string
          resolved_at: string | null
          resolved_by: string | null
          writeoff_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          close_period_id: string
          entity_id: string
          line_type: string
          order_number?: string | null
          invoice_number?: string | null
          customer?: string | null
          order_description?: string | null
          rental_start_date?: string | null
          rental_end_date?: string | null
          gross_amount: number
          realization_rate_applied: number
          expected_discount?: number
          net_amount: number
          matched_invoice_number?: string | null
          matched_invoice_date?: string | null
          actual_invoice_subtotal?: number | null
          variance_amount?: number | null
          line_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          writeoff_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          close_period_id?: string
          entity_id?: string
          line_type?: string
          order_number?: string | null
          invoice_number?: string | null
          customer?: string | null
          order_description?: string | null
          rental_start_date?: string | null
          rental_end_date?: string | null
          gross_amount?: number
          realization_rate_applied?: number
          expected_discount?: number
          net_amount?: number
          matched_invoice_number?: string | null
          matched_invoice_date?: string | null
          actual_invoice_subtotal?: number | null
          variance_amount?: number | null
          line_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          writeoff_notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_entity_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      user_entity_role: {
        Args: {
          p_entity_id: string
        }
        Returns: string
      }
      user_org_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
