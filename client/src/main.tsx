import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setAppHeight } from './utils/viewport'
import './index.css'
import App from './App.tsx'

setAppHeight()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
