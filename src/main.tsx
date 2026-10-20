import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { startState, type StartState } from './ui/store';
import './ui/app.css';

const render = (start: StartState) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary root>
        <App start={start} />
      </ErrorBoundary>
    </StrictMode>,
  );

// On first run the sample project's code loads before the first render (the auto-save case renders straight away).
const start = startState();
if (start instanceof Promise) {
  start.then(render, (e: Error) => {
    document.getElementById('root')!.textContent = `Knitbit could not start: ${e.message}. Reload to try again.`;
  });
} else render(start);
