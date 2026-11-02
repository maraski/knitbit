import type { FieldRef, FixApply, IssueFix } from '../../engine/issues';
import type { Id } from '../../engine/model';
import type { Issue } from '../../engine/panel';

/** What the app does for a fix: show its field, or make its one-click change (all failing sizes, one undo step). */
export interface IssueActions {
  goToField: (f: FieldRef, sizeId?: Id) => void;
  apply: (panelId: Id, issue: Issue) => void;
  /** Whether Apply can set this issue's field (the field exists in this project). */
  canApply: (issue: Issue) => boolean;
  /** A field value as the toast and the Apply button show it (cm in the project's units). */
  format: (value: number, unit: FixApply['unit']) => string;
}

/**
 * The "Fix:" line under an issue: the text, the per-size need when the sizes differ, a Go to link per field and an
 * Apply button when the fix has a one-click change.
 */
export function IssueFixLine({ fix, issue, panelId, sizeId, actions, needs }: { fix: IssueFix; issue: Issue; panelId: Id; sizeId?: Id; actions?: IssueActions; needs?: string }) {
  if (!fix.text) return null;
  const go = actions && fix.fields.filter((f, i, a) => a.findIndex((g) => g.target === f.target && g.key === f.key && g.id === f.id) === i);
  const apply = actions && fix.apply && actions.canApply(issue);
  return (
    <div className="issue-fix">
      <strong>Fix:</strong> {fix.text}
      {needs && <span className="check-needs"> {needs}</span>}
      {(go?.length || apply) && (
        <span className="fix-actions">
          {go?.map((f) => (
            <button key={`${f.target}.${f.id ?? ''}.${f.key}`} className="link fix-go" onClick={() => actions!.goToField(f, sizeId)} title={`Show ${f.label} in its properties`}>
              Go to {f.label}
            </button>
          ))}
          {apply && (
            <button className="fix-apply" onClick={() => actions!.apply(panelId, issue)} title="Set it in every size with this problem (one undo step)">
              Apply: {fix.apply!.label ?? `${fix.apply!.field.label} = ${actions!.format(fix.apply!.value, fix.apply!.unit)}`}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
