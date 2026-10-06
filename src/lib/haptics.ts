import { WebHaptics } from 'web-haptics'

const haptics = new WebHaptics()

export const haptic = {
  tap: () => { void haptics.trigger(10) },
  success: () => { void haptics.trigger('success') },
  error: () => { void haptics.trigger('error') },
}
