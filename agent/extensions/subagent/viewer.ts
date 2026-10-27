import {
  AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent, getSelectListTheme,
  type KeybindingsManager, type Theme, type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { ScrollView, SelectList, Text, Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Snapshot } from "./index.ts";
import { Transcript, type LiveTranscript, type TranscriptEvent, type TranscriptItem } from "./transcript.ts";

export type ViewerChild = { snapshot: Snapshot; stopping?: boolean; live?: LiveTranscript };
export const cleanLine = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
export const working = (child: ViewerChild) => !!child.stopping || child.snapshot.state === "starting" || child.snapshot.state === "running";
export const childStatus = (child: ViewerChild) => child.stopping ? "stopping" : working(child) ? child.snapshot.state : child.snapshot.state === "failed" ? "failed" : child.snapshot.latest?.outcome ?? child.snapshot.state;
export const modelLabel = (snapshot: Snapshot) => cleanLine(snapshot.model.slice(snapshot.model.indexOf("/") + 1));
export const costLabel = (snapshot: Snapshot) => snapshot.sessionCost == null ? "~$?" : snapshot.sessionCost > 0 && snapshot.sessionCost < 0.001 ? "~$<0.001" : `~$${snapshot.sessionCost.toFixed(3)}`;
export const contextLabel = (snapshot: Snapshot) => snapshot.contextUsage?.percent == null ? "ctx ?" : `ctx ${Math.round(snapshot.contextUsage.percent)}%`;
export function sortedChildren<T extends ViewerChild>(children: T[]): T[] {
  const recent = (child: ViewerChild) => (child.snapshot.latest?.startedAt ?? 0) + (child.snapshot.latest?.durationMs ?? 0);
  return [...children].sort((a, b) => Number(working(b)) - Number(working(a)) || recent(b) - recent(a));
}

export type ViewerSource = {
  children(): ViewerChild[];
  load(id: string, signal: AbortSignal): Promise<SessionEntry[]>;
};
type OpenTranscript = {
  id: string; transcript: Transcript; abort: AbortController; loaded: boolean;
  error?: string; dirty: boolean; refreshing?: Promise<void>;
};
type Rendered = {
  component: Component; message?: unknown; args?: unknown; result?: unknown;
  tool?: ToolExecutionComponent; heading?: Text; lines?: string[]; width?: number; state?: string;
};

// One disposable UI instance. Closing it never sends a command to a child.
export class SubagentViewer implements Component {
  private ids: string[];
  private selectedId?: string;
  private list?: SelectList;
  private open?: OpenTranscript;
  private expanded = false;
  private disposed = false;
  private newActivity = false;
  private rendered = new Map<string, Rendered>();
  private bodyLines: string[] = [];
  private bodyWidth?: number;
  private dirty = true;
  private scroll = new ScrollView({ render: () => this.bodyLines, invalidate() {} }, { follow: "end" });

  constructor(private tui: TUI, private theme: Theme, private keys: KeybindingsManager, private done: () => void, private source: ViewerSource) {
    this.ids = sortedChildren(source.children()).map(child => child.snapshot.id);
    this.selectedId = this.ids[0];
  }

  private child(id: string) { return this.source.children().find(child => child.snapshot.id === id); }

  changed() {
    if (this.disposed) return;
    for (const child of this.source.children()) if (!this.ids.includes(child.snapshot.id)) this.ids.push(child.snapshot.id);
    if (!this.selectedId) this.selectedId = this.ids[0];
    if (this.open && !this.open.loaded && !this.open.refreshing) this.refresh(this.open);
    this.dirty = true;
    this.tui.requestRender();
  }

  event(id: string, event: TranscriptEvent) {
    if (this.disposed || this.open?.id !== id) return;
    if (event.type === "message_end") {
      this.open.transcript.complete(event.message);
      this.refresh(this.open);
    }
    if (!this.scroll.isFollowingEnd) this.newActivity = true;
    this.dirty = true;
    this.tui.requestRender();
  }

  refreshHistory(id: string) {
    if (!this.disposed && this.open?.id === id) {
      if (!this.scroll.isFollowingEnd) this.newActivity = true;
      this.refresh(this.open);
    }
  }

  private refresh(open: OpenTranscript) {
    open.dirty = true;
    if (open.refreshing) return;
    const child = this.child(open.id);
    if (!child?.snapshot.sessionPath) {
      if (child?.snapshot.state !== "starting") { open.error = "Transcript unavailable: no saved session path"; open.loaded = true; }
      return;
    }
    open.refreshing = (async () => {
      while (open.dirty && this.open === open && !this.disposed) {
        open.dirty = false;
        try {
          const history = await this.source.load(open.id, open.abort.signal);
          if (this.open !== open || this.disposed) return;
          open.transcript.replaceHistory(history);
          open.error = undefined;
        } catch (error) {
          if (this.open !== open || this.disposed) return;
          open.error = `Transcript unavailable: ${error instanceof Error ? error.message : String(error)}`;
        }
        open.loaded = true;
        this.dirty = true;
        this.tui.requestRender();
      }
    })().finally(() => { open.refreshing = undefined; });
  }

  private inspect(id: string) {
    this.open = { id, transcript: new Transcript(), abort: new AbortController(), loaded: false, dirty: false };
    const live = this.child(id)?.live;
    if (live?.assistant && !live.streaming) this.open.transcript.complete(live.assistant);
    this.rendered.clear();
    this.bodyWidth = undefined;
    this.dirty = true;
    this.newActivity = false;
    this.scroll.scrollToEnd();
    this.refresh(this.open);
  }

  private back() {
    this.selectedId = this.open?.id;
    this.open?.abort.abort();
    this.open = undefined;
    this.rendered.clear();
    this.bodyLines = [];
    this.ids = sortedChildren(this.source.children()).map(child => child.snapshot.id);
  }

  private renderItem(item: TranscriptItem, child: ViewerChild, width: number): string[] {
    let cached = this.rendered.get(item.key);
    if (item.kind === "message") {
      if (!cached || cached.message !== item.message) {
        if (item.message.role === "assistant") {
          const component = cached?.component instanceof AssistantMessageComponent ? cached.component : new AssistantMessageComponent(undefined, true);
          component.updateContent(item.message, item.streaming);
          cached = { component, message: item.message };
        } else if (item.message.role === "user") {
          const text = typeof item.message.content === "string" ? item.message.content : item.message.content.map(block => block.type === "text" ? block.text : "[Image omitted]").join("\n");
          cached = { component: new UserMessageComponent(text), message: item.message };
        }
      }
    } else if (item.kind === "marker") {
      cached ??= { component: new Text(this.theme.fg("muted", item.text), 0, 1) };
    } else {
      const tool = item.tool;
      const status = tool.result && !tool.partial ? tool.result.isError ? "failed" : "completed" : !working(child) ? "interrupted" : tool.started ? "running" : "preparing";
      if (!cached) {
        const component = new ToolExecutionComponent(tool.name, tool.id, tool.args, { showImages: false }, undefined, this.tui, child.snapshot.cwd);
        component.setExpanded(this.expanded);
        cached = { component, tool: component, heading: new Text("", 0, 0) };
      }
      if (cached.args !== tool.args || cached.result !== tool.result || cached.state !== status) {
        cached.tool!.updateArgs(tool.args);
        cached.tool!.setArgsComplete();
        if (tool.started) cached.tool!.markExecutionStarted();
        if (tool.result) cached.tool!.updateResult({ ...tool.result, content: tool.result.content.map(block => block.type === "image" ? { type: "text", text: "[Image omitted]" } : block) }, tool.partial);
        const glyph = status === "completed" ? "✓" : status === "failed" ? "!" : status === "running" ? "⠹" : "○";
        cached.heading!.setText(this.theme.fg(status === "failed" ? "error" : "muted", `${glyph} ${cleanLine(tool.name)} · ${status}`));
        cached.args = tool.args; cached.result = tool.result; cached.state = status; cached.lines = undefined;
      }
    }
    if (!cached) return [];
    this.rendered.set(item.key, cached);
    if (!cached.lines || cached.width !== width) {
      // Native generic tool fallback always prints full args/output. Collapse
      // it at the viewer boundary; expansion still uses the native renderer.
      cached.lines = [...(cached.heading?.render(width) ?? []), ...(cached.tool && !this.expanded ? [] : cached.component.render(width))].map(line => truncateToWidth(line, width));
      cached.width = width;
    }
    return cached.lines;
  }

  render(width: number): string[] {
    const height = Math.max(1, Math.min(Math.floor(this.tui.terminal.rows * 0.85), this.tui.terminal.rows - 2));
    const inner = Math.max(0, width - 2);
    const bodyHeight = Math.max(0, height - 6);
    let title = "Inspect subagents";
    let metadata = "Running agents first · read-only";
    let footer = "Enter Inspect · Esc Close · ↑↓ Select";
    let body: string[];
    if (this.open) {
      const child = this.child(this.open.id)!;
      title = cleanLine(child.snapshot.name);
      if (this.dirty || this.bodyWidth !== inner) {
        const items = this.open.transcript.items(child.live);
        const present = new Set(items.map(item => item.key));
        for (const key of this.rendered.keys()) if (!present.has(key)) this.rendered.delete(key);
        this.bodyLines = items.flatMap(item => this.renderItem(item, child, inner));
        this.bodyWidth = inner;
        this.dirty = false;
      }
      const notices = this.open.error ? [this.theme.fg("warning", this.open.error)] : !this.bodyLines.length ? [this.open.loaded ? "No messages yet." : "Waiting for transcript…"] : [];
      const lines = [...notices, ...this.bodyLines];
      this.scroll.updateLayout(lines.length, bodyHeight, () => this.tui.requestRender());
      if (this.scroll.isFollowingEnd) this.newActivity = false;
      body = lines.slice(this.scroll.scrollTop, this.scroll.scrollTop + bodyHeight);
      const follow = this.scroll.isFollowingEnd ? working(child) ? "LIVE" : "END" : this.newActivity ? "SCROLLED UP · New activity below" : "SCROLLED UP";
      metadata = `${childStatus(child)} · ${modelLabel(child.snapshot)} · ${contextLabel(child.snapshot)} · ${costLabel(child.snapshot)} · ${follow}${this.open.error ? " · History unavailable" : ""}`;
      footer = `B Agents · Esc Close · E ${this.expanded ? "Collapse" : "Expand"} tools · ↑↓ Scroll · PgUp/PgDn Page · Home Start · End Follow`;
    } else {
      const selected = this.selectedId;
      const items = this.ids.flatMap(id => {
        const child = this.child(id);
        return child ? [{ value: id, label: cleanLine(child.snapshot.name), description: `${childStatus(child)} · ${modelLabel(child.snapshot)} · ${contextLabel(child.snapshot)} · ${costLabel(child.snapshot)}` }] : [];
      });
      this.list = new SelectList(items, Math.max(1, bodyHeight - 1), getSelectListTheme());
      this.list.setSelectedIndex(Math.max(0, items.findIndex(item => item.value === selected)));
      this.list.onSelectionChange = item => { this.selectedId = item.value; };
      this.list.onSelect = item => this.inspect(item.value);
      this.list.onCancel = () => this.close();
      body = items.length ? this.list.render(inner).slice(0, bodyHeight) : ["No subagents in this session."];
    }
    const row = (line: string) => {
      const clipped = truncateToWidth(line, inner);
      return truncateToWidth(`│${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))}│`, width);
    };
    const border = (left: string, right: string) => truncateToWidth(`${left}${"─".repeat(inner)}${right}`, width);
    return [border("╭", "╮"), row(this.theme.fg("accent", title)), row(metadata), row("─".repeat(inner)),
      ...Array.from({ length: bodyHeight }, (_, index) => row(body[index] ?? "")), row(this.theme.fg("muted", footer)), border("╰", "╯")].slice(0, height);
  }

  handleInput(data: string) {
    if (this.keys.matches(data, "tui.select.cancel")) { this.close(); return; }
    if (!this.open) this.list?.handleInput(data);
    else if (matchesKey(data, "b")) this.back();
    else if (matchesKey(data, "e")) {
      this.expanded = !this.expanded;
      for (const cached of this.rendered.values()) { cached.tool?.setExpanded(this.expanded); cached.lines = undefined; }
      this.dirty = true;
    } else if (this.keys.matches(data, "tui.select.up")) this.scroll.scrollBy(-1);
    else if (this.keys.matches(data, "tui.select.down")) this.scroll.scrollBy(1);
    else if (matchesKey(data, Key.pageUp)) this.scroll.scrollBy(-Math.max(1, this.scroll.viewportHeight - 1));
    else if (matchesKey(data, Key.pageDown)) this.scroll.scrollBy(Math.max(1, this.scroll.viewportHeight - 1));
    else if (matchesKey(data, Key.home)) this.scroll.scrollToStart();
    else if (matchesKey(data, Key.end)) { this.scroll.scrollToEnd(); this.newActivity = false; }
    if (this.scroll.isFollowingEnd) this.newActivity = false;
    this.tui.requestRender();
  }

  invalidate() {
    // Rebuild themed headings/markers as well as native component layouts.
    this.rendered.clear();
    this.dirty = true;
  }

  close() { this.dispose(); this.done(); }
  dispose() {
    this.disposed = true;
    this.open?.abort.abort();
    this.open = undefined;
    this.rendered.clear();
    this.bodyLines = [];
  }
}
