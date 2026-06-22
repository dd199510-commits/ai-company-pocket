import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { PocketApp } from './PocketApp.jsx'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const path = window.location.pathname
const isDesktopMode = params.get('mode') === 'desktop' || path.endsWith('/workspace')
const isPocketMode = params.get('mode') === 'pocket' || path.endsWith('/pocket')
const isGithubPagesPocket = window.location.hostname.endsWith('github.io') && path.includes('/ai-company-pocket')
const RootApp = isDesktopMode ? App : (isPocketMode || isGithubPagesPocket ? PocketApp : App)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
