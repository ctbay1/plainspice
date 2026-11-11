/** The checkpoint page's entry point (index.html loads it). */
import '../../src/notebook/notebook.css';
import './checkpoint.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Checkpoint } from './app.tsx';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Checkpoint />
    </StrictMode>,
  );
}
