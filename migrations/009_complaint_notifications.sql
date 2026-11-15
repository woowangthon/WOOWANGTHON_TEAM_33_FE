CREATE OR REPLACE FUNCTION notify_complaint_change() RETURNS trigger AS $$
DECLARE change_kind text;
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    change_kind := 'updated';
  ELSIF NEW.auto_state = 'failed' AND OLD.auto_state IS DISTINCT FROM NEW.auto_state THEN
    change_kind := 'failed';
  ELSIF NEW.auto_state = 'completed' AND NEW.analysis IS NOT NULL
    AND (OLD.auto_state IS DISTINCT FROM NEW.auto_state OR OLD.analysis IS DISTINCT FROM NEW.analysis) THEN
    change_kind := 'completed';
  ELSIF (NEW.auto_state = 'completed' AND NEW.analysis IS NOT NULL OR NEW.status = 'resolved')
    AND NEW.revision IS DISTINCT FROM OLD.revision THEN
    change_kind := 'updated';
  ELSE
    RETURN NEW;
  END IF;
  PERFORM pg_notify('complaint_changes', json_build_object(
    'id', NEW.id, 'owner', NEW.owner, 'revision', NEW.revision, 'kind', change_kind
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER complaint_changes_notification
AFTER UPDATE ON complaints FOR EACH ROW EXECUTE FUNCTION notify_complaint_change();
