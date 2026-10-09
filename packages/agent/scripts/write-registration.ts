// Writes packages/agent/registration.json, the ERC-8004 registration file that AGENT_URI serves, from the code.
// Usage, from packages/agent: pnpm registration:write
import { writeFileSync } from "node:fs";
import { registrationFile } from "../src/registration";

writeFileSync(new URL("../registration.json", import.meta.url), registrationFile());
console.log("Wrote registration.json");
