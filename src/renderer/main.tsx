import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/app.css';
import { PostHogProvider } from 'posthog-js/react';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PostHogProvider
      apiKey="phc_GvJ6Ja6MY05KTmtD3Wj7QF3rCbczJwUQhLN8jPU8qqe"
      options={{
        api_host: 'https://eu.i.posthog.com',
        capture_exceptions: true,
        debug: import.meta.env.MODE === 'development',
      }}
    >
      <App />
    </PostHogProvider>
  </React.StrictMode>
);