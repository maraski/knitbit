import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import './ui/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary root>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
