# Custom Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user make named custom groups in the normal tab list, put any tabs in them from the tab menu, and keep them (with their tabs) until deleted, taking precedence over site sections.

**Architecture:** Groups are a list in their own pref, `zen.sitegroups.custom-groups`. A tab's membership is the group id, stored on the tab with `SessionStore.setCustomTabValue`, so it survives restarts and unloading. `layoutSection` gets one combined list: the space's custom groups first, then the site sections. A tab is assigned to its custom group if it has one, else matched by site. Headers and folded state are keyed by a stable key, the label for site sections and `custom:<id>` for groups, instead of by label.

**Tech Stack:** Firefox chrome JavaScript in a single user script (`tab-groups.uc.js`) run by Sine/fx-autoconfig in Zen. XUL menus. No build step, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-26-custom-groups-design.md`

## Global Constraints

- All code goes in `tab-groups.uc.js`, inside the existing IIFE. Match its style: plain functions, `const` arrows for one-liners, short comments that say why, 2-space indent, double quotes.
- New pref: `zen.sitegroups.custom-groups`, a JSON array of `{ id, name, color, space }`. `id` never changes; `space` is a Zen workspace uuid (`{…}`, `SPACE_ID` format) or `null`.
- Tab value key: `"zsg-custom-group"`. Its value is a group `id`.
- Never write custom groups into `zen.sitegroups.sections`. The settings page's `parseSections` would destroy them.
- Group colors, in this order: blue `#4da3ff`, purple `#a77bf3`, cyan `#3fc1d0`, green `#5bc06a`, yellow `#e6b929`, orange `#f08a3c`, red `#ec5b5b`, pink `#ea6fb4`, grey `#9a9aa2`.
- Never close a tab except where the user clicked Clear / Close all on that group.
- **No automated tests exist.** Every task is verified with `node --check tab-groups.uc.js` (syntax) and then by hand in Zen.
- **Testing loop in Zen:** copy `tab-groups.uc.js` over `%APPDATA%\zen\Profiles\zo9xw7eb.Srisar\chrome\sine-mods\zen-tab-groups\tab-groups.uc.js`, then restart Zen. Errors show in the Browser Console (Ctrl+Shift+J) prefixed `[Zen Tab Groups]`. Back up the installed file first and restore it when done.

## Review Focus

- **Tabs restored after a restart but never clicked** (unloaded): they must show in their group straight away, not after being woken. Check in Task 2.
- **Two Zen windows open:** a group deleted in one window releases its tabs in the other on that window's next layout. Check in Task 3.
- **A group named like a site section** ("GitHub"): two separate headers, and folding one doesn't fold the other. Check in Task 3.
- **Reopening a closed group tab** (Ctrl+Shift+T): it comes back in its group if the group still exists, and in normal sorting if not. Check in Task 4.
- **A multi-selection that includes pinned tabs or the context tab alone:** pinned tabs are skipped. Right-clicking a tab outside the selection acts on that tab only (Firefox's `TabContextMenu` behavior). Check in Task 2.

---

### Task 1: Key headers and folded state by a stable key

A refactor with no visible change, so later tasks can give custom groups their own headers without clashing with site sections of the same name.

**Files:**
- Modify: `tab-groups.uc.js` (`makeHeader`, `updateHeader`, `layoutSection`, `toggleCollapsed`, `groupTabs`, the header menu's `edit`/`triggerHeader` helpers and Rename)

**Interfaces:**
- Produces: `headerKey(section) -> string`. Returns `displayName(section)` for site/collection sections, and `` `custom:${section.id}` `` for `section.kind === "custom"`.
- Produces: headers carry `data-key` (the key) as well as `data-label` (the shown name). `tab[zsg-group]` holds the key. The `zen.sitegroups.collapsed` set holds keys.
- Produces: `toggleCollapsed(key)`. `groupTabs(header)` matches on `data-key`.

- [ ] **Step 1: Add `headerKey` and switch to keys**

`makeHeader(key)` sets `data-key`. The click handler toggles `data-key`. `layoutSection` finds existing headers by `data-key`, sets `tab.zsg-group` to the key, and checks `opts.collapsed` by key. `updateHeader` checks `opts.collapsed.has(headerKey(section))` and still writes the label. The "two sections with the same name: the first one wins" check now runs on the key.

Site keys equal today's labels, so users' saved folded state keeps working unchanged. The header menu's `edit` still finds a site section by `data-label`, and Rename still moves the collapsed entry from the old name to the new one.

- [ ] **Step 2: Syntax check**

Run: `node --check tab-groups.uc.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify in Zen**

Load the script (see the testing loop). Check:
- A section folded before the change is still folded after restart.
- Folding and unfolding YouTube works.
- Rename a folded section: it stays folded.
- Clear and Unload on a header act on that section's tabs only.
- The divider's Clear still closes only the loose tabs.

- [ ] **Step 4: Commit**

```bash
git add tab-groups.uc.js
git commit -m "Key section headers by a stable key, not their label"
```

---

### Task 2: Custom groups in the layout, with the tab menu to fill them

**Files:**
- Modify: `tab-groups.uc.js` (constants, prefs section, new "custom groups" section, `layoutSection`, `run`, `setupMenus` tab menu, `ungroup`)
- Modify: `tab-groups/settings.html:220-221` and `preferences.json:239` (labels for `tab-menu-items`)

**Interfaces:**
- Consumes: `headerKey`, `data-key` (Task 1); `inSpace`, `knownSpaces`, `colorFor`.
- Produces:
  - `const PREF_CUSTOM = "zen.sitegroups.custom-groups"`, `const TAB_GROUP_KEY = "zsg-custom-group"`, `const GROUP_COLORS = [...]` (Global Constraints order).
  - `getCustomGroups() -> Array<{ id: string, name: string, color: string|null, space: string|null }>`: sanitized like `getSections`, dropping entries with no id or empty name.
  - `setCustomGroups(groups)`: `writeJSON(PREF_CUSTOM, groups)`.
  - `asSection(group) -> { kind: "custom", id, name, color, sites: [], spaces: group.space ? [group.space] : [], minTabs: 1 }`, so `inSpace`, `displayName`, `colorFor` and `headerKey` work on it unchanged.
  - `tabGroupId(tab) -> string` (`""` if none): `SessionStore.getCustomTabValue(tab, TAB_GROUP_KEY)`.
  - `setTabGroup(tab, id)` / `clearTabGroup(tab)`: set or delete the value, then `schedule()`.
  - `contextTabs() -> tab[]`: the right-clicked tab, or all selected tabs if it is multiselected, without pinned tabs.
  - `newGroup(space) -> string|null`: prompt for a unique name, append `{ id, name, color, space }`, return the id (null on cancel).
  - `nameTaken(name, space, exceptId?) -> boolean`: case-insensitive, among groups shown in that space.

- [ ] **Step 1: Storage, membership, colors**

Add the constants and functions above next to `getSections`. Make ids with `Services.uuid.generateUUID().toString()`. A new group's color is `GROUP_COLORS[groups.length % GROUP_COLORS.length]`. `newGroup` loops on `promptText("New group", "Name for the new group:", "")` and, after a clash, `` `“${name}” is already a group in this space. Pick another name:` ``. It returns null on cancel or an empty name.

- [ ] **Step 2: Layout with precedence**

In `run()`, read `getCustomGroups()` once and pass it to `layoutSection`. When `!modEnabled`, pass `null` instead: `layoutSection` then ignores tab values entirely and never clears them, so turning the mod off and on again keeps every membership. In `layoutSection`, build `entries = [...groups.map(asSection), ...sections]`. For each tab:
- Get `id = tabGroupId(tab)`. If `id` names a group that `inSpace` for this container, the tab goes to that entry.
- If `id` names a group in a different space that exists (`knownSpaces.has(group.space)`), or a group that no longer exists, call `clearTabGroup(tab)` and match the tab by site.
- Otherwise, match by site with `sectionIndexForHost(host, sections, spaceId)`, offset by the number of groups.

Min-tab filtering only applies to site entries. In the header pass, a custom entry always gets a header when `inSpace`, even with no tabs, whatever `opts.keepEmpty` says. The existing code puts all entries in list order, so groups land above site sections.

Pinned, foldered and split tabs never reach `layoutSection`. `run()`'s `ungroup` pass only strips attributes and must not touch the tab value, so membership stays dormant.

- [ ] **Step 3: Tab menu**

In `setupMenus`, add an **Add to group** `menu` (id `context_zsg-add-to-group`) and a **Remove from “…”** item (id `context_zsg-remove-from-group`) after `removeItem`. Their visibility does not depend on `host` or `PREF_TAB_MENU`, only on `modEnabled` and the context tab being unpinned. Keep `sep` visible when any item is.

On `popupshowing`:
- Rebuild the submenu: one item per group shown in the context tab's space (`zen-workspace-id`), except the tab's current group, then a `menuseparator`, then **New group…**.
- Picking a group calls `setTabGroup` on each of `contextTabs()`. **New group…** calls `newGroup(space)` and then does the same.
- Remove is visible when the context tab has a group. Its label is `` `Remove from “${name}”` ``, and it calls `clearTabGroup` on each of `contextTabs()` that are in that group.

The site items keep their current rules.

- [ ] **Step 4: Option labels**

Change the setting's text so it covers only the site items:
- `settings.html:221`: `Show “Give this site its own section”, “Add to a collection” and “Tab Groups settings…” when you right-click a tab. Switched off, open these settings by right-clicking a header. “Add to group” always shows.`
- `preferences.json:239`: `"label": "Tab Groups site items in the tab right-click menu"`.

- [ ] **Step 5: Syntax check**

Run: `node --check tab-groups.uc.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Verify in Zen**

Check the spec's checks 1, 4, 5, 8 and 9, plus:
- Restart Zen: groups and tabs are back, including tabs not yet clicked (spec check 3).
- A group with no tabs shows a dimmed header.
- Ctrl-select two loose tabs and one pinned tab, then right-click one of the loose tabs → **Add to group** → **New group…**. The two loose tabs join. The pinned tab is untouched.
- Pin a group tab, then unpin it: it rejoins its group. Same with a split view (spec check 10).
- Turn the tab menu option off: **Add to group** still shows, and the site items don't.

- [ ] **Step 7: Commit**

```bash
git add tab-groups.uc.js tab-groups/settings.html preferences.json
git commit -m "Add custom groups, filled from the tab menu"
```

---

### Task 3: Header menu for custom groups

**Files:**
- Modify: `tab-groups.uc.js` (`setupMenus` header popup)

**Interfaces:**
- Consumes: `getCustomGroups`, `setCustomGroups`, `nameTaken`, `clearTabGroup`, `GROUP_COLORS`, header `data-key` (Tasks 1–2).
- Produces: `customIdOf(header) -> string|null` (the id from a `custom:` key). `editGroup(fn)`, which works like `edit` but on the custom list, by id.

- [ ] **Step 1: Branch the header menu on `custom:` keys**

On `popupshowing`, if the header is a custom group:
- Hide *Remove section*, *Only in this space* and *Show in all spaces*.
- Show **Color** (menu, id `zsg-header-color`) and **Delete group** (id `zsg-header-delete`). Hide both on site headers.

For a custom header, the existing items work like this:
- **Move up / Move down** swap the group with the nearest group before or after it in the list that is shown in the same space.
- **Rename…** prompts with the current name and rejects `nameTaken(name, space, id)` with the same clash message as Task 2. The collapsed key doesn't change.
- **Unload all / Close all / settings** work as they do now. They already go through `groupTabs(header)` by key.

**Color** lists the nine colors by name, with the current one checked (`type="radio"`). Picking one sets `group.color`.

**Delete group** removes the group from the list, deletes `custom:<id>` from the collapsed set, and calls `clearTabGroup` on this window's tabs that are in it. Tabs in other windows are released by Task 2's "group no longer exists" rule on their next layout. It never closes a tab.

- [ ] **Step 2: Syntax check**

Run: `node --check tab-groups.uc.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify in Zen**

Check the spec's checks 6 and 7, plus:
- Move two groups up and down past each other. Site sections stay below them.
- Change a group's color: its header and tabs follow, and the color survives a restart.
- With "One color for all" on, groups use that color too.
- Make a group named "YouTube" next to a YouTube section: two headers, folded separately.
- With two windows open, delete a group in one. Its tabs in the other window go back to normal sorting.

- [ ] **Step 4: Commit**

```bash
git add tab-groups.uc.js
git commit -m "Add rename, move, color and delete to custom group headers"
```

---

### Task 4: Links from a group's tab join the group

**Files:**
- Modify: `tab-groups.uc.js` (`init`)

**Interfaces:**
- Consumes: `tabGroupId`, `setTabGroup`, `getCustomGroups` (Task 2).

- [ ] **Step 1: Join on open**

In `init`, add a `TabOpen` listener before the existing `schedule` one. Take `tab = e.target` and `opener = tab.openerTab`. Skip it if there's no opener, if the tab or the opener has `zen-glance-tab`, or if the tab is pinned. Otherwise, if `tabGroupId(opener)` names a group that still exists, `setTabGroup(tab, id)`. Skip tabs that already have a group, such as reopened closed tabs that SessionStore restored.

Firefox sets `openerTab` for link clicks, middle-clicks, *Open Link in New Tab* and `target=_blank`. Ctrl+T and the + button leave it null, so those tabs stay ungrouped. Leave glance tabs alone: Zen's preview is a temporary tab.

- [ ] **Step 2: Syntax check**

Run: `node --check tab-groups.uc.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify in Zen**

Check the spec's check 2, plus:
- Middle-click a link in a folded group: the new tab joins and stays hidden, and the count goes up.
- Close a group tab and press Ctrl+Shift+T: it's back in its group. Delete the group, then reopen another closed tab from it: it lands in normal sorting.
- Open a glance preview from a group tab: the preview isn't put in a group.

- [ ] **Step 4: Commit**

```bash
git add tab-groups.uc.js
git commit -m "Open links from a custom group's tab in the same group"
```

---

### Task 5: Zen's Clear leaves custom group tabs alone

**Files:**
- Modify: `tab-groups.uc.js` (new `hookZenClear()`, called from `init`)

**Interfaces:**
- Consumes: `tabGroupId`, `getCustomGroups`, `modEnabled`.

- [ ] **Step 1: Wrap `gZenWorkspaces.closeAllUnpinnedTabs`**

The button, its shortcut and the space menu all run `cmd_zenCloseUnpinnedTabs`, which calls `gZenWorkspaces.closeAllUnpinnedTabs()` when invoked. That method works out the closable tabs with private helpers, then calls `gBrowser.removeTabs(tabs, opts)` synchronously before returning. So replace the method on the `gZenWorkspaces` instance. For the length of the original call, swap `gBrowser.removeTabs` for a filter that drops tabs whose `tabGroupId` names an existing group, and restore it in `finally`:

```js
const original = gZenWorkspaces.closeAllUnpinnedTabs;
gZenWorkspaces.closeAllUnpinnedTabs = function (...args) {
  const removeTabs = gBrowser.removeTabs;
  gBrowser.removeTabs = (tabs, options) => removeTabs.call(gBrowser, tabs.filter(t => !inCustomGroup(t)), options);
  try {
    return original.apply(this, args);
  } finally {
    gBrowser.removeTabs = removeTabs;
  }
};
```

`inCustomGroup(tab)` is false whenever `!modEnabled`, so with the mod off Zen's Clear behaves exactly as before. If `gZenWorkspaces?.closeAllUnpinnedTabs` isn't a function, log `console.error("[Zen Tab Groups] couldn't hook Zen's Clear button")` and leave everything alone. Install the hook once per window.

The divider's Clear (`closeRest`) already skips tabs with `zsg-group`, and custom group tabs have it.

- [ ] **Step 2: Syntax check**

Run: `node --check tab-groups.uc.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify in Zen**

Check the spec's check 11 (Clear at the top, on the divider, and both), plus:
- If a keyboard shortcut is set for Zen's "close unpinned tabs", it spares group tabs too.
- Switch the mod off in Settings → Zen Mods: Clear closes every unpinned tab, as Zen normally does.
- With a group tab selected, Clear behaves as Zen's does (Zen never closes the selected tab).

- [ ] **Step 4: Commit**

```bash
git add tab-groups.uc.js
git commit -m "Keep custom group tabs when Zen's Clear is clicked"
```

---

### Task 6: Release notes and version

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` → `[1.6.0] - <today>`), `README.md` (Features list and "Using it"), `theme.json` (`version` `1.6.0`, `updatedAt` the current UTC time)

- [ ] **Step 1: Write the entries**

CHANGELOG, under `### Added`: custom groups, their tab menu, the header menu, links joining the group, and Zen's Clear sparing them. Under `### Changed`: the tab menu option no longer hides **Add to group**.

README: a **Custom groups** bullet in Features, and a short "Custom groups" subsection under "Using it" that explains how to make a group, add and remove tabs, delete a group, and what happens to links and Clear. Write it in the README's voice: short, second person, no jargon.

- [ ] **Step 2: Check the version fields**

Run: `grep -n '"version"\|updatedAt' theme.json`
Expected: `"version": "1.6.0"` and an `updatedAt` from today.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md theme.json
git commit -m "Release 1.6.0"
```
