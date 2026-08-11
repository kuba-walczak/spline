import { useRef, useState } from 'react'

export default function App() {
  const [swatchColor, setSwatchColor] = useState('rgb(0, 0, 0)')
  const [micActive, setMicActive] = useState(false)

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const lastSendRef = useRef(0)

  const SEND_INTERVAL_MS = 1000 / 60

  const setColor = (r: number, g: number, b: number): void => {
    setSwatchColor(`rgb(${r}, ${g}, ${b})`)
    window.api.setRgbColor(r, g, b)
  }

  const setLedStripColor = (r: number, g: number, b: number): void => {
    setSwatchColor(`rgb(${r}, ${g}, ${b})`)
    window.api.setLedStripColor(r, g, b)
  }

  const startMic = async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    streamRef.current = stream
    audioContextRef.current = audioContext

    const data = new Uint8Array(analyser.fftSize)
    const tick = (): void => {
      analyser.getByteTimeDomainData(data)

      let sumSquares = 0
      for (const sample of data) {
        const normalized = (sample - 128) / 128
        sumSquares += normalized * normalized
      }
      const rms = Math.sqrt(sumSquares / data.length)
      const intensity = Math.min(255, Math.round(rms * 4 * 255))

      const now = performance.now()
      if (now - lastSendRef.current >= SEND_INTERVAL_MS) {
        lastSendRef.current = now
        setLedStripColor(intensity, 0, 0)
      }

      rafIdRef.current = requestAnimationFrame(tick)
    }
    rafIdRef.current = requestAnimationFrame(tick)

    setMicActive(true)
  }

  const stopMic = (): void => {
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = null

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    void audioContextRef.current?.close()
    audioContextRef.current = null

    lastSendRef.current = 0
    setMicActive(false)
    setLedStripColor(0, 0, 0)
  }

  const toggleMic = (): void => {
    if (micActive) stopMic()
    else void startMic()
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
      <button
        className="left-4 top-4 rounded-md bg-black/60 px-4 py-2 text-sm font-medium text-white hover:bg-black/80"
        onClick={toggleMic}
        onMouseEnter={() => window.api.setIgnoreMouseEvents(false)}
        onMouseLeave={() => window.api.setIgnoreMouseEvents(true)}
      >
        {micActive ? 'Stop Mic' : 'Start Mic'}
      </button>
    </div>
  )
}
