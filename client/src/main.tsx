import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyAppHeight } from './lib/appViewport'
import './index.css'
import App from './App.tsx'

applyAppHeight()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
