import { useState } from 'react'

export default function App() {
  const [swatchColor, setSwatchColor] = useState('rgb(0, 0, 0)')

  const setColor = (r: number, g: number, b: number): void => {
    setSwatchColor(`rgb(${r}, ${g}, ${b})`)
    window.api.setRgbColor(r, g, b)
  }

  return (
    <div className="relative h-full w-full">
      <div
        className="absolute left-4 top-16 h-64 w-64 rounded-md border border-white/20"
        style={{ backgroundColor: swatchColor }}
      />
      <button
        className="left-4 top-4 rounded-md bg-black/60 px-4 py-2 text-sm font-medium text-white hover:bg-black/80"
        onClick={() => setColor(255, 0, 0)}
        onMouseEnter={() => window.api.setIgnoreMouseEvents(false)}
        onMouseLeave={() => window.api.setIgnoreMouseEvents(true)}
      >
        Red
      </button>
      <button
        className="left-4 top-4 rounded-md bg-black/60 px-4 py-2 text-sm font-medium text-white hover:bg-black/80"
        onClick={() => setColor(0, 0, 255)}
        onMouseEnter={() => window.api.setIgnoreMouseEvents(false)}
        onMouseLeave={() => window.api.setIgnoreMouseEvents(true)}
      >
        Blue
      </button>
    </div>
  )
}
