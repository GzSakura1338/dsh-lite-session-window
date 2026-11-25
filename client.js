/**
 * Lite session window — opens a Session on its most recent Turns and folds the
 * distant past behind the existing "load earlier" affordance.
 *
 * DSH pages Session history backwards, but every request asks for a very large
 * chunk: the opening request is `{ maxMessages: 500, turnWindow: { minMessages:
 * 50, minTurns: 2 } }` and each later page reuses that budget. A long
 * conversation therefore arrives as one huge window that stays resident in the
 * browser, and opening a past Session feels heavy (hundreds of megabytes of DOM
 * for long transcripts).
 *
 * This bundle replaces those budgets with Turn-based ones:
 *
 *   opening: keep the newest 2 Turns whole (500 messages guard)
 *   page:    each "load earlier" page covers the previous 2 Turns (400 messages guard)
 *
 * Keeping the newest Turn whole is deliberate: the current exchange must stay
 * readable. Everything older than the opening window is simply not loaded until
 * the reader scrolls up, so the folded interval costs no memory.
 *
 * The host paginator (`dsh-api-session-controller/src/history.ts`) always keeps
 * the requested `throughSeq`, so a smaller budget only moves a page's lower cut;
 * turn jumps still reach their target and older content still loads on demand.
 *
 * Tunables live here because a client bundle receives no plugin config. They are
 * also exposed at runtime as `window.__dshLiteWindow.settings` for live tuning:
 * write new numbers and reload the Session (no rebuild needed).
 */

/**
 * Budgets applied to the history stream.
 * `turnWindow.minTurns` counts `turn/start` boundaries scanned backwards, so a
 * value of N keeps the newest N-1 Turns inside the page.
 */
const settings = {
  /** Opening request: newest 2 Turns (`minTurns` counts boundaries), 500 messages max. */
  openingTurns: 3,
  openingMaxMessages: 500,
  /** Backwards page: 2 Turns per page, 400 messages max. */
  pageTurns: 3,
  pageMaxMessages: 400,
}

/** Marks the prototype as patched by this bundle, so HMR reloads stay single-layer. */
const PATCH_MARK = Symbol.for('@local/dsh-lite-session-window')

/**
 * Build one history request budget from the live settings.
 * @param turns - `turnWindow.minTurns` for the request.
 * @param maxMessages - message budget for the request.
 * @returns the budget in the shape this bundle computes.
 */
function budgetOf(turns, maxMessages) {
  return { maxMessages, minMessages: 1, minTurns: Math.max(1, Math.trunc(turns)) }
}

/**
 * Apply a window budget to one history request without changing its cut target.
 * The message budget never exceeds what the caller asked for or the budget, while
 * the Turn span comes from the budget: this bundle's policy is "the newest Turns,
 * whole", so the requested span is not lowered back to the client default.
 * @param request - history request carrying optional `maxMessages` and `turnWindow`.
 * @param budget - window budget to apply.
 * @returns a request with the budget applied.
 */
function clampRequest(request, budget) {
  if (request === null || typeof request !== 'object') return request
  const requestedMax = request.maxMessages
  const maxMessages = typeof requestedMax === 'number' && Number.isSafeInteger(requestedMax) && requestedMax > 0
    ? Math.min(requestedMax, budget.maxMessages)
    : budget.maxMessages
  return {
    ...request,
    maxMessages,
    turnWindow: { minMessages: Math.min(budget.minMessages, maxMessages), minTurns: budget.minTurns },
  }
}

/**
 * Install the window budgets on a history stream prototype.
 * @param proto - `SessionEventStream.prototype`.
 * @returns a disposer that restores the original methods, or a no-op when another
 *  instance of this bundle already patched the prototype.
 */
function installBudgets(proto) {
  if (proto[PATCH_MARK] !== undefined) return () => {}
  const originalFollow = proto.follow
  const originalReadPage = proto.readPage
  if (typeof originalFollow !== 'function' || typeof originalReadPage !== 'function') return () => {}
  proto.follow = function follow(request, signal) {
    return originalFollow.call(this, clampRequest(request, budgetOf(settings.openingTurns, settings.openingMaxMessages)), signal)
  }
  proto.readPage = function readPage(request, throughSeq, signal) {
    return originalReadPage.call(this, clampRequest(request, budgetOf(settings.pageTurns, settings.pageMaxMessages)), throughSeq, signal)
  }
  proto[PATCH_MARK] = true
  return () => {
    proto.follow = originalFollow
    proto.readPage = originalReadPage
    delete proto[PATCH_MARK]
  }
}

window.__ModuleLoader__.load({
  id: '@local/dsh-lite-session-window',
  factory(require) {
    return {
      inject: [],
      apply(ctx) {
        if (typeof window !== 'undefined') window.__dshLiteWindow = { settings }
        let controller
        try {
          controller = require('@deepseek-ai/dsh-api-session-controller')
        } catch (error) {
          return
        }
        const stream = controller === null || controller === undefined ? undefined : controller.SessionEventStream
        const proto = stream === null || stream === undefined ? undefined : stream.prototype
        if (proto === undefined) return
        ctx.effect(() => installBudgets(proto), 'lite-session-window: history window budgets')
      },
    }
  },
})
