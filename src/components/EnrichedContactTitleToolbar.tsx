import { memo, useEffect, useState } from "react";

export type EnrichedContactTitleToolbarProps = {
  applied: string;
  onApply: (draft: string) => void;
  onClear: () => void;
};

/** Contact `title` filter: draft isolated so the main page does not re-render on each keystroke. */
export const EnrichedContactTitleToolbar = memo(function EnrichedContactTitleToolbar({
  applied,
  onApply,
  onClear,
}: EnrichedContactTitleToolbarProps) {
  const [draft, setDraft] = useState(applied);

  useEffect(() => {
    setDraft(applied);
  }, [applied]);

  return (
    <section className="panel job-title-toolbar" aria-label="Contact title search">
      <form
        className="job-title-toolbar-form"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(draft);
        }}
      >
        <div className="job-title-toolbar-fields">
          <label className="job-title-toolbar-label" htmlFor="enriched-contact-title-input">
            Contact titles (<code className="job-title-code">contacts.title</code>)
          </label>
          <p className="job-title-toolbar-hint">
            One per line or comma-separated. Matches <code className="job-title-code">title</code> on
            the contact row (any term, case-insensitive, OR). Press{" "}
            <kbd className="job-title-kbd">Enter</kbd> or click Search — not while typing.
          </p>
          <textarea
            id="enriched-contact-title-input"
            className="filter-text-input filter-textarea job-title-toolbar-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={"VP Sales\nfounder\ndirector"}
            rows={3}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="job-title-toolbar-actions">
          <button type="submit" className="btn-primary">
            Search
          </button>
          <button
            type="button"
            className="column-btn"
            onClick={() => {
              setDraft("");
              onClear();
            }}
          >
            Clear
          </button>
          {draft !== applied ? (
            <span className="job-title-toolbar-dirty">Unapplied edits — press Search</span>
          ) : null}
        </div>
      </form>
    </section>
  );
});
