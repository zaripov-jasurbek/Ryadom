import { WebHaptics } from 'web-haptics'

const haptics = new WebHaptics()

export const haptic = {
  light: () => { void haptics.trigger('light') },
  selection: () => { void haptics.trigger('selection') },
  success: () => { void haptics.trigger('success') },
  error: () => { void haptics.trigger('error') },
  warning: () => { void haptics.trigger('warning') },
}
