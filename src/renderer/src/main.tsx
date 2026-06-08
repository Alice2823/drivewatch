import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './components/ThemeProvider'
import App from './App'
import { initScanTaskBridge } from './stores/useScanTaskStore'

// Initialise the IPC bridge before the first render so the store is populated
// before any component subscribes to it.
initScanTaskBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)
