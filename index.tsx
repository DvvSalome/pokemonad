import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/App';
import './src/index.css';
import './src/ui/theme.css';
import './src/ui/game.css';


const root = document.getElementById('root');
if (!root) throw new Error('No #root element found');
createRoot(root).render(<App />);
