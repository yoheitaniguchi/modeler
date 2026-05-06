import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './views/App.js';
import { clientLogger } from './services/logger.js';
import './styles.css';

clientLogger.info('Application started', { timestamp: new Date().toISOString() });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
