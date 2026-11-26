-- Lane CR: sequence send windows in the recipient's local time and a daily email limit per sender.
ALTER TABLE crm_sequences ADD COLUMN window_start smallint NOT NULL DEFAULT 9 CHECK (window_start BETWEEN 0 AND 23);
ALTER TABLE crm_sequences ADD COLUMN window_end smallint NOT NULL DEFAULT 17 CHECK (window_end BETWEEN 1 AND 24);
ALTER TABLE crm_sequences ADD COLUMN window_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}';
ALTER TABLE crm_sequences ADD COLUMN daily_limit integer NOT NULL DEFAULT 50 CHECK (daily_limit BETWEEN 1 AND 2000);
-- Why the next step is waiting (outside the send window, daily limit reached); cleared when it runs.
ALTER TABLE crm_sequence_enrolments ADD COLUMN wait_reason text NOT NULL DEFAULT '';
