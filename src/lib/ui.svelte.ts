import type { BillItem } from './calculations'
import { markNameHintSeen, nameHintSeen } from './saved'

export type ConfirmRequest = { title: string; body?: string; action: string; danger?: boolean; resolve: (answer: boolean) => void }

/**
 * What is open on screen: sheets, the confirmation, the toast. Nothing here talks to the server;
 * AppStore extends it, so components keep using app.qrOpen, app.notify() and so on.
 */
export class UiState {
  toast = $state('')
  // Overlays live here so Escape can close whichever one is open.
  addItemOpen = $state(false)
  scanOpen = $state(false)
  /** A photo already chosen for the scanner, so it starts at the frame instead of asking for one. */
  scanFile = $state<File | null>(null)
  qrOpen = $state(false)
  editingItem = $state<BillItem | null>(null)
  checkEditOpen = $state(false)
  /** The sheet with everyone at the table, opened from the avatars under the check's name. */
  peopleOpen = $state(false)
  /** The creator's sheet for the card or phone guests transfer to. */
  payDetailsOpen = $state(false)
  /** The sheet where you change the name others see, opened from the button next to the card. */
  nameOpen = $state(false)
  /** The open confirmation sheet; it replaces window.confirm, which looks foreign on phones. */
  confirmRequest = $state<ConfirmRequest | null>(null)
  /** True once this browser has opened the name sheet: until then your name at the bottom pulses to show it can change. */
  nameHintSeen = $state(nameHintSeen())

  private toastTimer: ReturnType<typeof setTimeout> | undefined

  notify(message: string) {
    clearTimeout(this.toastTimer)
    this.toast = message
    this.toastTimer = setTimeout(() => this.toast = '', 2500)
  }

  /** Asks in an in-app sheet; resolves false when it is dismissed or replaced by another question. */
  confirm(request: Omit<ConfirmRequest, 'resolve'>) {
    this.answerConfirm(false)
    return new Promise<boolean>(resolve => { this.confirmRequest = { ...request, resolve } })
  }

  answerConfirm(answer: boolean) {
    const request = this.confirmRequest
    this.confirmRequest = null
    request?.resolve(answer)
  }

  closeOverlays() { this.answerConfirm(false); this.addItemOpen = false; this.scanOpen = false; this.scanFile = null; this.qrOpen = false; this.editingItem = null; this.checkEditOpen = false; this.peopleOpen = false; this.payDetailsOpen = false; this.nameOpen = false }

  openNameSheet() {
    this.nameOpen = true
    if (!this.nameHintSeen) { this.nameHintSeen = true; markNameHintSeen() }
  }

  /** Opens the scanner on a photo; on the create page its rows land in the draft. */
  scanPhoto(file: File) { this.scanFile = file; this.scanOpen = true }
}
