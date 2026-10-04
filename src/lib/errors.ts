// Server and network errors arrive in English; the UI speaks Russian.
const messages: [RegExp, string][] = [
  [/Owner access required/, 'Это может сделать только создатель чека'],
  [/Check not found/, 'Чек не найден — возможно, его удалили'],
  [/Invalid owner link/, 'Ссылка создателя недействительна'],
  [/Participant access required|Join the check first/, 'Сначала присоединитесь к чеку'],
  [/custom split/, 'Создатель распределил эту порцию вручную'],
  [/Shares must equal/, 'Доли должны в сумме дать цену порции'],
  [/Invalid (participant )?allocations?/, 'Некорректное распределение долей'],
  [/No submitted proof/, 'Участник ещё не отметил оплату'],
  [/Owner may only confirm/, 'Подтвердить можно только полную оплату'],
  [/Nothing to pay yet/, 'Участник ещё ничего не отметил'],
  [/Invalid payment data/, 'Проверьте сумму'],
  [/Participant limit reached/, 'В чеке уже 50 участников — больше добавить нельзя'],
  [/Comment limit reached/, 'В чеке уже 50 комментариев — больше добавить нельзя'],
  [/cannot be removed/, 'Создателя чека нельзя убрать'],
  [/Participant not found/, 'Участник уже удалён'],
  [/Item not found/, 'Позиция уже удалена'],
  [/Item unit unavailable/, 'Позиция уже удалена'],
  [/Only the author/, 'Удалить комментарий может только автор'],
  [/Invalid item/, 'Проверьте название, количество и цену'],
  [/Invalid check details/, 'Проверьте название, процент и реквизиты'],
  [/Invalid comment/, 'Комментарий пустой или слишком длинный'],
  [/Invalid title or participant name|Invalid participant session/, 'Проверьте название и имя'],
  [/Anonymous sign-ins are disabled/i, 'Анонимный вход отключён в настройках Supabase'],
  [/Failed to fetch|NetworkError|Load failed|fetch failed/i, 'Нет соединения с сервером'],
  [/Supabase is not configured/, 'Supabase не настроен'],
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
