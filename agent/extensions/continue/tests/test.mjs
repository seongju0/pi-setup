import assert from "node:assert/strict";
import register from "../index.ts";

let shortcut;
const messages = [];
register({
	registerShortcut(key, options) {
		assert.equal(key, "shift+alt+enter");
		shortcut = options.handler;
	},
	sendUserMessage(message) {
		messages.push(message);
	},
});

shortcut({ isIdle: () => false });
assert.deepEqual(messages, []);
shortcut({ isIdle: () => true });
assert.deepEqual(messages, ["continue"]);
console.log("continue shortcut: idle sends; busy ignores");
