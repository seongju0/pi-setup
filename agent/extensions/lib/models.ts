import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Launch only an available physical model; never silently substitute or route. */
export function requireLaunchModel(ctx: ExtensionContext, reference: string) {
  const slash = reference.indexOf("/");
  const model = slash > 0 ? ctx.modelRegistry.find(reference.slice(0, slash), reference.slice(slash + 1)) : undefined;
  if (!model || !ctx.modelRegistry.getAvailable().some((item) => item.provider === model.provider && item.id === model.id)) {
    throw new Error(`Model ${reference} is unavailable. No model was substituted.`);
  }
  if (model.api === "pi-virtual") throw new Error(`Model ${reference} must be a physical model, not a virtual router`);
  return model;
}
