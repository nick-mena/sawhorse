// Help > Log Feedback…: note a problem or an idea without leaving the work. A note that could
// not be written stays in the box, and closing without saving keeps it for next time.
import { useEffect, useState } from "react";
import { appendFeedback, downloadBrowserFeedback, feedbackLocation, MAX_FEEDBACK_CHARS, type FeedbackContext, type FeedbackKind } from "../io/feedback";
import { useDialogFocus } from "./useDialogFocus";

export interface FeedbackDialogProps {
  context: FeedbackContext;
  onSaved: () => void;
  onClose: () => void;
}

let draft = "";

export function FeedbackDialog({ context, onSaved, onClose }: FeedbackDialogProps) {
  const dialog = useDialogFocus();
  const [kind, setKind] = useState<FeedbackKind>(context.status && context.status === context.lastError ? "Problem" : "Feedback");
  const [text, setText] = useState(draft);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [where, setWhere] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void feedbackLocation().then((w) => live && setWhere(w), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await appendFeedback(kind, text, context);
    } catch (e) {
      setSaving(false);
      setErr(`That note was not saved, and it is still here. ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    draft = "";
    onSaved();
  };

  return (
    <section
      ref={dialog}
      className="name-dialog feedback-dialog"
      role="dialog"
      aria-label="Log Feedback"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <header>
        <b>Log Feedback</b>
      </header>
      <label>
        <span>Kind</span>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.currentTarget.value as FeedbackKind)}>
          <option>Problem</option>
          <option>Feedback</option>
        </select>
      </label>
      <label>
        <span>What happened, or what would be better?</span>
        <textarea
          aria-label="Note"
          autoFocus
          rows={6}
          maxLength={MAX_FEEDBACK_CHARS}
          value={text}
          onChange={(e) => {
            draft = e.currentTarget.value;
            setText(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          }}
        />
      </label>
      {err ? (
        <p className="note err" role="alert">
          {err}
        </p>
      ) : null}
      <p className="note">The entry also records the app version, file name, tool, selection count, status line and last error. It stays on this device.</p>
      <p className="note" data-testid="feedback-where">
        {where ? (
          <>
            Saved to <code>{where}</code>
          </>
        ) : (
          "Saved in this browser."
        )}
      </p>
      <div className="btnrow">
        <button type="button" className="btn primary" disabled={!text.trim() || saving} onClick={() => void save()}>
          Save to Log
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        {where ? null : (
          <button type="button" className="btn" onClick={downloadBrowserFeedback}>
            Download Log
          </button>
        )}
      </div>
    </section>
  );
}
