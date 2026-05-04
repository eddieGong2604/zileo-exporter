import { memo, useEffect, useState } from "react";

export type EnrichedJobTitleToolbarProps = {
  applied: string;
  onApply: (draft: string) => void;
  onClear: () => void;
};

/**
 * Draft state lives here so typing does not re-render the large Enriched page.
 * Parent only receives updates on Search / Clear (stable callbacks + memo).
 */
export const EnrichedJobTitleToolbar = memo(function EnrichedJobTitleToolbar({
  applied,
  onApply,
  onClear,
}: EnrichedJobTitleToolbarProps) {
  const [draft, setDraft] = useState(applied);

  useEffect(() => {
    setDraft(applied);
  }, [applied]);

  return (
    <section className="panel job-title-toolbar" aria-label="Job title search">
      <form
        className="job-title-toolbar-form"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(draft);
        }}
      >
        <div className="job-title-toolbar-fields">
          <label className="job-title-toolbar-label" htmlFor="enriched-job-title-input">
            Job titles (<code className="job-title-code">all_jobs</code>)
          </label>
          <p className="job-title-toolbar-hint">
            One per line or comma-separated. Matches <code className="job-title-code">jobtitle</code>{" "}
            / <code className="job-title-code">jobTitle</code> (any term, case-insensitive). Press{" "}
            <kbd className="job-title-kbd">Enter</kbd> or click Search — not while typing.
          </p>
          <textarea
            id="enriched-job-title-input"
            className="filter-text-input filter-textarea job-title-toolbar-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={"engineer\nCFO\nhead of sales"}
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
