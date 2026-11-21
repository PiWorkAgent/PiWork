/**
 * How the UI names a model in `defaultModelId`.
 *
 * With built-in providers enabled, two providers can advertise the same model
 * id (aggregators especially). The SDK's `findModelById()` resolves either a
 * bare id or `provider/id`, so the rule is:
 *
 *  - keep the bare id — the historical format — when it is unambiguous;
 *  - switch to `provider/id` only when another provider exposes the same id.
 *
 * Renderer-safe: no Node imports.
 */

export interface SelectableModel {
  id: string;
  providerId: string;
}

/** Does a saved selection point at this model? Accepts both key formats. */
export function matchesModelSelection(selection: string, model: SelectableModel): boolean {
  return (
    selection !== '' &&
    (selection === model.id || selection === `${model.providerId}/${model.id}`)
  );
}

/** The key to persist for `model`, given every model the picker lists. */
export function preferredModelSelection(
  models: readonly SelectableModel[],
  model: SelectableModel,
): string {
  const ambiguous = models.some((m) => m.providerId !== model.providerId && m.id === model.id);
  return ambiguous ? `${model.providerId}/${model.id}` : model.id;
}
