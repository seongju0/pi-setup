import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSessionTasks } from "./tasks/register.ts";
import { registerContext } from "./register.ts";

export default function contextExtension(pi: ExtensionAPI) {
  registerSessionTasks(pi);
  registerContext(pi);
}
