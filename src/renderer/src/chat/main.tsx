import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ChatWindow from './ChatWindow'
import './chat.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatWindow />
  </StrictMode>
)
