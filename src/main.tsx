import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

// import { JobWorker } from './modules/job-orchestrator/JobWorker';

// JobWorker.getInstance().start();

// Global error listener for uncaught errors
window.addEventListener('error', (event) => {
  console.error("[Runtime] Global Error Caught:", event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error("[Runtime] Global Unhandled Rejection:", event.reason);
  // Log the stack trace if available
  if (event.reason && event.reason.stack) {
    console.error("[Runtime] Rejection Stack:", event.reason.stack);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
