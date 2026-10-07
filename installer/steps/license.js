import { StepError } from "../core/errors.js";
import { shortenLicenseKey } from "../core/redact.js";
import { normalizeLicenseKey, looksLikeLicenseKey, validateLicense } from "../vault-setup.js";

export function licenseStep() {
  return {
    id: "license", title: "Checking your license", severity: "stop",
    async action(ctx) {
      const raw = ctx.licenseKey || (await ctx.prompt("Blueprint OS license key:"));
      const key = normalizeLicenseKey(raw);
      if (!looksLikeLicenseKey(key)) throw new StepError("That does not look like a Blueprint OS key. The format is SHOP-XXXX-XXXX-XXXX.");
      const r = await validateLicense(key, { fetchImpl: ctx.fetchImpl, server: ctx.licenseServer });
      if (!r.ok) throw new StepError(`License check failed: ${shortenLicenseKey(r.error)}`);
      ctx.licenseKey = key;
      ctx.license = { ...r.license, key };
    },
  };
}
