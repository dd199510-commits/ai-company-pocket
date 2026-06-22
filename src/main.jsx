import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { PocketApp } from './PocketApp.jsx'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const RootApp = window.location.pathname === '/pocket' || params.get('mode') === 'pocket'
  ? PocketApp
  : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
