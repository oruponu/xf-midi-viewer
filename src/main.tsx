import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(error) => (
        <main className="app">
          <section className="error" role="alert">
            <strong>問題が発生しました:</strong> {error.message}
            <br />
            <button
              type="button"
              className="file-select-button"
              onClick={() => window.location.reload()}
            >
              ページを再読み込み
            </button>
          </section>
        </main>
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
