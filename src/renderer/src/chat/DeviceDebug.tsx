import { useRef, useState } from 'react'
import type { ReactElement } from 'react'

/* Debug controls for the LED strip / RGB devices, moved here from the
   transparent overlay window (App.tsx) so they're reachable without the
   click-through overlay. */

export function DeviceDebug(): ReactElement {
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

  const buttonStyle: React.CSSProperties = {
    borderRadius: 'var(--radius-md)',
    border: 'none',
    background: 'var(--surface-control)',
    color: 'var(--text-primary)',
    font: 'var(--type-meta)',
    padding: '4px 8px',
    cursor: 'pointer'
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 var(--sidebar-inset) 12px' }}>
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          border: '1px solid var(--border-subtle)',
          backgroundColor: swatchColor,
          flex: '0 0 auto'
        }}
      />
      <button style={buttonStyle} onClick={() => setColor(255, 0, 0)}>
        Red
      </button>
      <button style={buttonStyle} onClick={() => setColor(0, 0, 255)}>
        Blue
      </button>
      <button style={buttonStyle} onClick={toggleMic}>
        {micActive ? 'Stop Mic' : 'Start Mic'}
      </button>
    </div>
  )
}
