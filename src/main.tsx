import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Применяем тему ДО первого рендера, чтобы избежать вспышки тёмного фона
// в светлом режиме (FOUC).
(function applyInitialTheme() {
  try {
    const saved = localStorage.getItem('avito-app-theme');
    const theme = saved === 'light' ? 'light' : 'dark';
    document.documentElement.classList.add(theme);
  } catch {
    document.documentElement.classList.add('dark');
  }
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
