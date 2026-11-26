-- Lane MC · Sites: funnel branching. A step's routes send visitors to another step depending on their form answers:
-- [{ field, operator, value, toPosition }], first match wins; with no match the visitor goes to the next step.
ALTER TABLE funnel_steps ADD COLUMN routes jsonb NOT NULL DEFAULT '[]';
