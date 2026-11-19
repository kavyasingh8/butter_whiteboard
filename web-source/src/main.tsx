import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isBrowser } from './nui';
import './index.css';

if (isBrowser) {
  document.body.classList.add('dev-backdrop');
  import('./mock').then(({ startMock }) => startMock());
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
