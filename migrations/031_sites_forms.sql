-- Lane 3 · Sites & Forms: OVELIO-native forms and every submission they receive.

CREATE TABLE forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  -- [{ key, label, type, required, placeholder, help, options, validation, mapsTo, width }]
  fields jsonb NOT NULL DEFAULT '[]',
  -- { submitLabel, afterSubmit: 'message'|'redirect'|'page', successMessage, redirectUrl, thankYouPageId, tags,
  --   consent: { enabled, text, required }, confirmationDesignId, notifyUserId }
  settings jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forms_status ON forms (status, updated_at DESC);

CREATE TABLE form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  contact_id bigint,
  field_values jsonb NOT NULL DEFAULT '{}',
  page_id uuid REFERENCES landing_pages(id) ON DELETE SET NULL,
  funnel_id uuid REFERENCES funnels(id) ON DELETE SET NULL,
  variant text,
  visitor_id text,
  utm jsonb NOT NULL DEFAULT '{}',
  page_url text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('accepted', 'spam', 'error')),
  error_detail text NOT NULL DEFAULT '',
  consent_given boolean NOT NULL DEFAULT false,
  campaign_id uuid REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  -- Result of the confirmation email: the mailer status ('sent', 'blocked', 'not_sent', 'failed') and its reason.
  email_status text,
  email_detail text NOT NULL DEFAULT '',
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_submissions_form ON form_submissions (form_id, created_at DESC);
CREATE INDEX form_submissions_contact ON form_submissions (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX form_submissions_page ON form_submissions (page_id, created_at DESC) WHERE page_id IS NOT NULL;
