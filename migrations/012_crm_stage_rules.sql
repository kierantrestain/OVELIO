-- Lane CR: fields a deal must have before it may enter a stage ('amount', 'expected_close_date', 'contact', 'company').
ALTER TABLE pipeline_stages ADD COLUMN required_fields text[] NOT NULL DEFAULT '{}';
