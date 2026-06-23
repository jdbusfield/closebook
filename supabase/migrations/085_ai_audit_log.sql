-- ============================================================================
-- AI ASSISTANT AUDIT LOG
-- One row per question asked to the CloseBook AI assistant. Captures the
-- prompt, the tool calls Claude made, token usage, and any error so we can
-- monitor cost, debug bad answers, and demonstrate that the assistant only
-- ever performed read-only queries.
-- ============================================================================

CREATE TABLE ai_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  entity_id uuid REFERENCES entities(id) ON DELETE SET NULL,

  question text NOT NULL,
  pathname text,
  model text NOT NULL,

  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_preview text,

  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,

  duration_ms int,
  error text,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_ai_audit_log_user_id ON ai_audit_log (user_id, created_at DESC);
CREATE INDEX idx_ai_audit_log_org_id ON ai_audit_log (organization_id, created_at DESC);

ALTER TABLE ai_audit_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own AI history.
CREATE POLICY "ai_audit_log_select_own"
  ON ai_audit_log
  FOR SELECT
  USING (user_id = auth.uid());

-- Org admins can read all AI history for their org.
CREATE POLICY "ai_audit_log_select_admin"
  ON ai_audit_log
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Server inserts on behalf of the authenticated user.
CREATE POLICY "ai_audit_log_insert_own"
  ON ai_audit_log
  FOR INSERT
  WITH CHECK (user_id = auth.uid());
