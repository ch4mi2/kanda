import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fonts (Fontsource) — bundled by Vite, no Google Fonts CDN, so
// the app keeps working offline. Latin subset only; the UI copy is English
// and peak names are romanised. Bricolage Grotesque 800 = display headings,
// Outfit 400/600 = everything else. See the design handoff sheet.
import '@fontsource/bricolage-grotesque/latin-800.css';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-600.css';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
