import { useState, useEffect, useRef, useCallback } from 'react'

const CLICK_THRESHOLD = 3
const CLICK_WINDOW_MS = 5000

export function useClickCountClose(onClose: () => void) {
  const [clickCount, setClickCount] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  useEffect(() => {
    return () => clearTimer()
  }, [clearTimer])

  const handleOverlayClick = useCallback(() => {
    const newCount = clickCount + 1
    setClickCount(newCount)

    if (newCount >= CLICK_THRESHOLD) {
      clearTimer()
      setClickCount(0)
      onClose()
      return
    }

    clearTimer()
    timerRef.current = setTimeout(() => {
      setClickCount(0)
    }, CLICK_WINDOW_MS)
  }, [clickCount, onClose, clearTimer])

  const remainingClicks = Math.max(0, CLICK_THRESHOLD - clickCount)

  return { handleOverlayClick, remainingClicks }
}
