// Server and network errors arrive in English; the UI speaks Russian.
const messages: [RegExp, string][] = [
  [/Owner access required/, 'Это может сделать только создатель чека'],
  [/Check not found/, 'Чек не найден — возможно, его удалили'],
  [/Invalid owner link/, 'Эта ссылка больше не работает'],
  [/Participant access required|Join the check first/, 'Сначала присоединитесь к чеку'],
  [/custom split/, 'Создатель распределил эту порцию вручную'],
  [/split among everyone/, 'Создатель разделил эту позицию на всех'],
  [/Shares must equal/, 'Доли должны в сумме дать цену порции'],
  [/Invalid (participant )?allocations?/, 'Доли распределены неверно — проверьте суммы'],
  [/No submitted proof/, 'Участник ещё не отметил оплату'],
  [/Owner may only confirm/, 'Подтвердить можно только полную оплату'],
  [/Nothing to pay yet/, 'Участник ещё ничего не отметил'],
  [/Invalid payment data/, 'Проверьте сумму'],
  [/Participant limit reached/, 'В чеке уже 50 участников — больше добавить нельзя'],
  [/Item limit reached/, 'В чеке уже 100 позиций — больше добавить нельзя'],
  [/Portion limit reached/, 'В чеке больше 1000 порций быть не может'],
  [/Check limit reached/, 'Слишком много новых чеков за сутки — попробуйте позже'],
  [/cannot be removed/, 'Создателя чека нельзя убрать'],
  [/Participant not found/, 'Участник уже удалён'],
  [/Item not found/, 'Позиция уже удалена'],
  [/Item unit unavailable/, 'Позиция уже удалена'],
  [/Invalid item/, 'Проверьте название, количество и цену'],
  [/Invalid check details/, 'Проверьте название, процент и реквизиты'],
  [/Invalid participant name/, 'Имя — от 1 до 48 символов'],
  [/Invalid title or participant name|Invalid participant session/, 'Проверьте название и имя'],
  [/Anonymous sign-ins are disabled/i, 'Сервис временно недоступен — попробуйте позже'],
  // A request past the timeout in supabase.ts; older Safari reports it as a plain abort.
  [/TimeoutError|timed out|AbortError|aborted/i, 'Сервер не ответил — попробуйте ещё раз'],
  [/Failed to fetch|NetworkError|Load failed|fetch failed/i, 'Нет интернета — проверьте подключение и попробуйте ещё раз'],
  [/Supabase is not configured/, 'Сервис временно недоступен — попробуйте позже'],
]

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String((error as { message: unknown }).message)
  return typeof error === 'string' ? error : ''
}

export function errorMessage(error: unknown, fallback: string): string {
  const text = errorText(error)
  return messages.find(([pattern]) => pattern.test(text))?.[1] ?? fallback
}
