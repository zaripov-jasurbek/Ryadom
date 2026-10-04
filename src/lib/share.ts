// The system share sheet on phones and tablets (iPhone, iPad, Android); desktops copy or download instead,
// because a share dialog on a Mac or Windows PC is a detour from what the person wanted.
export const prefersShareSheet = () =>
  typeof navigator !== 'undefined' && typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches

/**
 * Opens the share sheet, or runs the fallback where there is none. Closing the sheet is not an error;
 * a sheet that fails to open (some browsers refuse files or need a fresh tap) falls back as well.
 */
export async function shareOr(data: ShareData, fallback: () => void) {
  if (!prefersShareSheet() || (data.files && !navigator.canShare?.(data))) { fallback(); return }
  try { await navigator.share(data) }
  catch (error) { if ((error as Error).name !== 'AbortError') fallback() }
}
