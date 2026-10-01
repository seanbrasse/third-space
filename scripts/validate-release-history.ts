import { readFileSync } from "node:fs";
import { validateReleaseHistory, publishedReleases } from "../apps/web/lib/release-history";
const history: unknown = JSON.parse(readFileSync(new URL("../releases/history.json", import.meta.url), "utf8"));
validateReleaseHistory(history);
console.log(`Release history valid: ${publishedReleases(history).length} published, ${history.entries.filter(entry => entry.status === 'draft').length} draft.`);
