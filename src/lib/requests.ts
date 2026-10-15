/**
 * Ids for requests the server must not carry out twice (create_check, add_item, add_items take p_request_id).
 * An answer lost on a weak network looks like a failure, and the person taps again: the same action with the same
 * arguments then gets the same id, and the server answers it with the result of the first call. A changed action
 * gets a new id, and a finished one is forgotten, so the next tap is a new request.
 */
export class RepeatIds {
  private pending = new Map<string, { fingerprint: string; id: string }>()
  private readonly makeId: () => string
  constructor(makeId: () => string = () => crypto.randomUUID()) { this.makeId = makeId }

  /** The id for this action: the one from its last unfinished try when the arguments are the same. */
  take(key: string, args: unknown) {
    const fingerprint = JSON.stringify(args), current = this.pending.get(key)
    if (current?.fingerprint === fingerprint) return current.id
    const id = this.makeId()
    this.pending.set(key, { fingerprint, id })
    return id
  }

  /** The action went through; the next one is new. */
  done(key: string) { this.pending.delete(key) }
}
