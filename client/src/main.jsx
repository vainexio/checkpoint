import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from '@/App.jsx';
import '@/index.css';

/**
 * Keep the app itself on the device, so a conductor who reloads with no signal
 * still gets a working screen (see public/sw.js). Production only: in
 * development it would serve yesterday's bundle over the one being edited.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Not fatal: the app works online without it. */
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
