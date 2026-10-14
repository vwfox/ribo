/**
 * Undo and redo by recording model notifications.
 *
 * Ported from board's useHistory.ts: an EContentAdapter on the root records
 * every change; changes of one microtask (or of one begin/end gesture) form
 * one step, and undoing a step applies the inverse of its changes backwards.
 */

import { computed, shallowRef, type ComputedRef } from 'vue'
import { EContentAdapter, NotificationType, type EObject, type Notification } from '@emfts/core'

interface Change {
  notifier: { eSet(feature: unknown, value: unknown): void; eGet(feature: unknown): EListLike }
  feature: unknown
  eventType: number
  oldValue: unknown
  newValue: unknown
  position: number
}

interface EListLike {
  size(): number
  indexOf(value: unknown): number
  removeAt(index: number): unknown
  addAt(index: number, value: unknown): void
  add(value: unknown): boolean
  move(to: number, from: number): unknown
}

interface Step {
  label: string
  changes: Change[]
}

interface Adaptable {
  eAdapterAdd(adapter: EContentAdapter): void
  eAdapterRemove(adapter: EContentAdapter): boolean
}

const DEPTH = 100

class Recorder extends EContentAdapter {
  constructor(private readonly onNotification: (notification: Notification) => void) {
    super()
  }

  override notifyChanged(notification: Notification): void {
    super.notifyChanged(notification)
    this.onNotification(notification)
  }
}

export class History {
  private readonly undoable = shallowRef<Step[]>([])
  private readonly redoable = shallowRef<Step[]>([])
  readonly canUndo: ComputedRef<boolean> = computed(() => this.undoable.value.length > 0)
  readonly canRedo: ComputedRef<boolean> = computed(() => this.redoable.value.length > 0)
  readonly undoLabel = computed(() => this.undoable.value.at(-1)?.label)
  readonly redoLabel = computed(() => this.redoable.value.at(-1)?.label)

  private readonly recorder: EContentAdapter
  private root: Adaptable | undefined
  private recording = true
  private paused = 0
  private open: Step | undefined
  private gesture = 0
  private flushing = false

  constructor() {
    this.recorder = new Recorder((notification) => this.remember(notification))
  }

  /** Follows another root; the old history is dropped */
  attach(root: EObject): void {
    this.root?.eAdapterRemove(this.recorder)
    this.root = root as unknown as Adaptable
    this.root.eAdapterAdd(this.recorder)
    this.clear()
  }

  detach(): void {
    this.root?.eAdapterRemove(this.recorder)
    this.root = undefined
  }

  clear(): void {
    this.undoable.value = []
    this.redoable.value = []
    this.open = undefined
  }

  /** Runs a change that should not become a step of its own (derived values) */
  unrecorded<T>(change: () => T): T {
    this.paused++
    try {
      return change()
    } finally {
      this.paused--
    }
  }

  /** Opens a step spanning a gesture, e.g. a drag. Nested gestures join the outer one. */
  begin(label: string): void {
    if (this.gesture++ > 0) return
    this.commitOpen()
    this.open = { label, changes: [] }
  }

  end(): void {
    if (this.gesture === 0 || --this.gesture > 0) return
    this.commitOpen()
  }

  record<T>(label: string, change: () => T): T {
    this.begin(label)
    try {
      return change()
    } finally {
      this.end()
    }
  }

  undo(): void {
    this.commitOpen()
    const step = this.undoable.value.at(-1)
    if (!step) return
    this.undoable.value = this.undoable.value.slice(0, -1)
    this.redoable.value = [...this.redoable.value, this.apply(step)]
  }

  redo(): void {
    this.commitOpen()
    const step = this.redoable.value.at(-1)
    if (!step) return
    this.redoable.value = this.redoable.value.slice(0, -1)
    this.undoable.value = [...this.undoable.value, this.apply(step)]
  }

  private commitOpen(): void {
    const step = this.open
    this.open = undefined
    if (!step || step.changes.length === 0) return
    const next = [...this.undoable.value, step]
    this.undoable.value = next.length > DEPTH ? next.slice(next.length - DEPTH) : next
    // A new change is a new future: what was undone cannot be redone
    this.redoable.value = []
  }

  private remember(notification: Notification): void {
    if (!this.recording || this.paused > 0 || notification.isTouch()) return
    if (notification.getEventType() === NotificationType.REMOVING_ADAPTER) return
    if (!notification.getFeature()) return

    const change: Change = {
      notifier: notification.getNotifier() as Change['notifier'],
      feature: notification.getFeature(),
      eventType: notification.getEventType(),
      oldValue: notification.getOldValue(),
      newValue: notification.getNewValue(),
      position: notification.getPosition(),
    }

    if (!this.open) {
      this.open = { label: 'Änderung', changes: [] }
      if (this.gesture === 0 && !this.flushing) {
        // Everything one interaction changes synchronously is one step
        this.flushing = true
        queueMicrotask(() => {
          this.flushing = false
          if (this.gesture === 0) this.commitOpen()
        })
      }
    }

    // Repeated writes of one feature collapse into the first old and the last new value
    if (change.eventType === NotificationType.SET) {
      const earlier = this.open.changes.find(
        (held) => held.eventType === NotificationType.SET && held.notifier === change.notifier && held.feature === change.feature,
      )
      if (earlier) {
        earlier.newValue = change.newValue
        return
      }
    }
    this.open.changes.push(change)
  }

  /** Applies the inverse of a step, newest change first, and returns the step that redoes it */
  private apply(step: Step): Step {
    this.recording = false
    const back: Change[] = []
    try {
      for (let i = step.changes.length - 1; i >= 0; i--) {
        const inverse = this.invert(step.changes[i]!)
        if (inverse) back.push(inverse)
      }
    } finally {
      this.recording = true
    }
    return { label: step.label, changes: back }
  }

  private invert(change: Change): Change | undefined {
    const { notifier, feature, eventType, oldValue, newValue, position } = change
    switch (eventType) {
      case NotificationType.SET:
      case NotificationType.UNSET:
        notifier.eSet(feature, oldValue)
        return { ...change, oldValue: newValue, newValue: oldValue }
      case NotificationType.ADD: {
        const list = notifier.eGet(feature)
        const at = position >= 0 && position < list.size() ? position : list.indexOf(newValue)
        if (at >= 0) list.removeAt(at)
        return { ...change, eventType: NotificationType.REMOVE, oldValue: newValue, position: at }
      }
      case NotificationType.REMOVE: {
        const list = notifier.eGet(feature)
        const at = position >= 0 ? Math.min(position, list.size()) : list.size()
        list.addAt(at, oldValue)
        return { ...change, eventType: NotificationType.ADD, newValue: oldValue, position: at }
      }
      case NotificationType.ADD_MANY: {
        const list = notifier.eGet(feature)
        for (const value of (newValue as unknown[]) ?? []) {
          const at = list.indexOf(value)
          if (at >= 0) list.removeAt(at)
        }
        return { ...change, eventType: NotificationType.REMOVE_MANY, oldValue: newValue }
      }
      case NotificationType.REMOVE_MANY: {
        const list = notifier.eGet(feature)
        for (const value of (oldValue as unknown[]) ?? []) list.add(value)
        return { ...change, eventType: NotificationType.ADD_MANY, newValue: oldValue }
      }
      case NotificationType.MOVE: {
        const list = notifier.eGet(feature)
        list.move(oldValue as number, position)
        return { ...change, oldValue: position, position: oldValue as number }
      }
      default:
        return undefined
    }
  }
}
