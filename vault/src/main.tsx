import React from 'react'
import ReactDOM from 'react-dom/client'
import './style.css'
import { App } from './ui/App'

ReactDOM.createRoot(document.querySelector('#app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

