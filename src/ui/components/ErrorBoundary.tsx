import { Component, type ReactNode } from 'react';
import { AUTOSAVE_KEY } from '../../engine/autosave';

interface Props {
  children: ReactNode;
  /** Inside the app: undo the change that broke the view. */
  onUndo?: () => void;
  /** Changing this clears the error (e.g. the project after an undo). */
  resetKey?: unknown;
  /** The whole app failed: offer to save the auto-saved project and start fresh. */
  root?: boolean;
}

interface State {
  error: Error | null;
  key: unknown;
}

/** Shows what went wrong instead of a blank page, with a way back. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { key: props.resetKey, error: null } : null;
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Knitbit view error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(1, 8).join('\n')}`;
    return (
      <div className="error-box" role="alert">
        <h3>Something went wrong drawing this view</h3>
        <p>Your project is safe. {this.props.root ? 'Save a copy, then start fresh or reload.' : 'Undo the last change, or copy the details below for a bug report.'}</p>
        <pre>{details}</pre>
        <div className="error-actions">
          {this.props.onUndo && <button className="primary" onClick={() => this.props.onUndo!()}>Undo the last change</button>}
          <button onClick={() => navigator.clipboard?.writeText(details)}>Copy details</button>
          {this.props.root && (
            <>
              <button onClick={downloadAutosave}>Download the project</button>
              <button
                onClick={() => {
                  if (!window.confirm('Start with a new project? Download the current one first if you want to keep it.')) return;
                  try {
                    localStorage.setItem(`${AUTOSAVE_KEY}.crashed`, localStorage.getItem(AUTOSAVE_KEY) ?? '');
                    localStorage.removeItem(AUTOSAVE_KEY);
                  } catch {
                    /* storage unavailable */
                  }
                  location.reload();
                }}
              >
                Start fresh
              </button>
            </>
          )}
          <button onClick={() => (this.props.root ? location.reload() : this.setState({ error: null }))}>{this.props.root ? 'Reload' : 'Try again'}</button>
        </div>
      </div>
    );
  }
}

function downloadAutosave() {
  let text = '';
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    text = raw ? (JSON.parse(raw) as { project: string }).project : '';
  } catch {
    text = '';
  }
  if (!text) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = 'knitbit-recovered.knitbit.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
