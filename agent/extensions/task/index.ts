import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSessionTasks } from "./register.ts";

export default function taskExtension(pi: ExtensionAPI) {
  registerSessionTasks(pi);
}
