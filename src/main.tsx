import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

// import { JobWorker } from './modules/job-orchestrator/JobWorker';

// JobWorker.getInstance().start();

console.log("[Runtime] main.tsx: Module loaded");

// Global error listener for uncaught errors
window.addEventListener('error', (event) => {
  console.error("[Runtime] Global Error Caught:", event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error("[Runtime] Global Unhandled Rejection:", event.reason);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
console.log("[Runtime] main.tsx: render() called");
