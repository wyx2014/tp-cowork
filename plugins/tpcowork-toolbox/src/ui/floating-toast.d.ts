import type * as React from 'react'
import type { createPortal } from 'react-dom'

type FloatingToastState = {
  seq: number
  state: 'pending' | 'success' | 'failure' | 'cancelled'
  message: string
}

type FloatingToastEntry = {
  key?: string
  toast: Omit<FloatingToastState, 'seq'> & { seq: number | string }
  closeLabel: string
  onClose?: () => void
  action?: { label: string; onClick(): void }
}

export const floatingToastStyles: string

export function createFloatingToast(
  react: typeof React,
  portal: typeof createPortal,
  renderSpinner?: () => React.ReactNode,
): {
  FloatingToast(props: {
    toast: FloatingToastState | null
    anchor?: React.RefObject<HTMLDivElement | null>
    closeLabel: string
    cancelLabel?: string
    onCancel?: () => void
    onClose(): void
  }): React.ReactElement | null
  FloatingToastStack(props: {
    entries: FloatingToastEntry[]
    anchor?: React.RefObject<HTMLDivElement | null>
  }): React.ReactElement | null
  useFloatingToast(): {
    toast: FloatingToastState | null
    show(state: FloatingToastState['state'], message: string): void
    clear(): void
  }
  successDuration: number
}
