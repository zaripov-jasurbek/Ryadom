// The same limits as the database (see supabase/migrations/202610040003_limits_ttl_and_cleanup.sql and 202610050001).
export const limits = { participants: 50, items: 100, portions: 1000, checksPerDay: 20, maxUnitPrice: 100_000_000, titleLength: 80, nameLength: 48, itemNameLength: 80, paymentDetailsLength: 100 }

/** A shared check is deleted this many days after it was created (public.check_lifetime()). */
export const checkLifetimeDays = 3
export const expiresAt = (createdAt: string) => new Date(Date.parse(createdAt) + checkLifetimeDays * 86_400_000)
