# Custom groups

## Why

Tab Groups sorts tabs into sections by site: every YouTube tab goes under
"YouTube", every GitHub tab under "GitHub". That doesn't help when the
user works on several separate things at once, like a project called
**3ex** and another called **olai**. Each piece of work pulls in tabs from
any mix of sites (GitHub, Google, YouTube, Reddit, docs…), and the user
wants each piece's tabs kept together under its own name.

Today there's no way to do that:

- Sections are rebuilt from each tab's site on every layout. A tab can't be
  "in" a section except by matching its site, and dragging a GitHub tab
  elsewhere is undone by the next layout.
- Zen's own folders can hold mixed sites, but they only live among pinned
  tabs. The user wants these groups in the **normal tabs list**, next to
  the site sections.

## What it is

A **custom group** is a named group the user makes and fills by hand. It
holds whatever tabs the user puts in it, from any site, and those tabs
stay in it regardless of their site. It sits in the normal tabs list and
looks like a site section: header, color, collapse arrow, tab count,
Clear/Unload.

### Goals

1. Make a custom group and put tabs in it from the tab's right-click menu.
2. A tab in a custom group stays there even when a site section would
   claim it. **Custom groups take precedence over site sections.**
3. Links opened from a tab in a custom group join that group.
4. Groups and their tabs survive a browser restart and stay until the user
   deletes the group.
5. Deleting a group lets its tabs go back to normal sorting. No tab is
   closed.

### Non-goals (for this version)

- **Drag and drop.** Dropping a tab onto a group's header to add it, or
  dragging it out to remove it, is left for a follow-up. It's the hardest
  part to get right alongside Zen's own tab dragging.
- Listing or editing custom groups on the settings page.
- Custom groups in backup files. A group only makes sense with its tabs,
  which don't travel to another computer.
- Custom groups among pinned tabs or in Essentials.

### Anti-goals (failure even if it "works")

- Closing tabs the user didn't ask to close. Deleting a group, or a group
  disappearing for any reason, must never close its tabs.
- A tab jumping out of its group on its own: when it loads a new page,
  while it's unloaded, after a restart, or while the sidebar re-sorts.
- Breaking site sections or the settings page for users who never make a
  custom group.

## How it behaves

### Making a group and adding tabs

The tab right-click menu (the mod's existing block, next to *Give this
site its own section*) gets **Add to group ▸**:

- The submenu lists the custom groups in the tab's space, then a separator
  and **New group…**.
- **New group…** asks for a name (the same simple prompt *Rename…* uses
  now), makes the group, and puts the tab in it.
- If several tabs are selected (Ctrl-click / Shift-click) and the user
  right-clicks one of them, all selected tabs go in.
- A tab already in a group sees the other groups in the submenu (to move
  it) plus **Remove from "olai"**.

**Add to group ▸** shows for any unpinned tab in the normal list, even one
on a page with no site (about:, file:), unlike the site items, which need
a site.

A name must not match another custom group in the same space. If it does,
reject it and ask again. Names may match site sections or groups in other
spaces: headers are keyed by id, so a match only looks alike and breaks
nothing. *(Our call.)*

**Add to group ▸** always shows, even with the option that hides the mod's
tab menu items turned off. It's the only way to use custom groups. That
option now hides only the site items, and its label on the settings page
and in `preferences.json` should say so. *(Our call.)*

### Precedence

A tab in a custom group is laid out in that group and ignored by site
sections. A GitHub tab in olai is not counted in the GitHub section: it
doesn't add to its tab count or to its "group only once N tabs are open"
minimum.

### Links from a group's tab

A tab opened from a tab in a custom group joins that group: a link click
that opens a new tab, a middle-click, *Open Link in New Tab*, or a page
opening a window that becomes a tab. Firefox records this as the new
tab's opener.

A blank new tab (Ctrl+T, the + button) joins no group, even when a group's
tab is selected.

### Taking tabs out and deleting groups

- Tab right-click → **Remove from "olai"**: the tab goes back to normal
  sorting (into its site section if it has one, otherwise the normal list).
- Header right-click → **Delete group**: the group goes away and all its
  tabs go back to normal sorting. Nothing is closed.
- Closing all of a group's tabs doesn't delete the group (see "Empty
  groups").

### Header menu

A custom group's header right-click menu has what a site section's has:
**Move up / Move down** (among the custom groups), **Rename…**, **Unload
all tabs**, **Close all tabs**, **Tab Groups settings…**. It also gets:

- **Color ▸**: a short list of named colors (see "Look").
- **Delete group**, which replaces *Remove section*. It is a different
  action: it releases tabs and closes none.

*Only in this space / Show in all spaces* doesn't apply. A group always
belongs to one space (below).

### Where groups sit

Custom groups go **above** the site sections, in the order the user sets
with Move up / Move down. New groups go last among the custom groups. The
divider below the sections, and its Clear, treat custom groups like
sections: the divider sits below all of them, and its Clear never closes
a custom group's tabs.

### Zen's Clear button

Zen's own Clear (close unpinned tabs, at the top of the tab list) must
**not** close custom group tabs. The user decided this. It still closes
everything else it closes today, site section tabs included. The rule
holds wherever the button sits: at the top, or hidden in favor of the
divider's Clear (`zsg-clear-moved`), and in every space. Custom groups
replace Zen folders for the user, and folder tabs survive Clear.

Doing this means intercepting or wrapping Zen's handler for that button.
That's the most fragile part of the work, since Zen may change it.
Contain it in one place, and if the hook can't be installed (Zen
changed), fall back to leaving Zen's button as it is and log an error.
Never break the button.

### Look

Custom group headers and tabs use the same options as site sections:
colored headers, backgrounds and strength, indent, line along tabs, header
line, arrow position, tab count, Clear/Unload button, readable text, and
"one color for all".

With no site icon to take a color from, each new group gets the next color
from a fixed list (blue, purple, cyan, green, yellow, orange, red, pink,
grey), and the user can change it from **Color ▸** on the header. *(Our
call; the user hasn't seen this.)*

### Empty groups

A custom group with no tabs still shows its header (dimmed, like an empty
section with "keep empty headers" on), whatever the keep-empty option says.
The user made it on purpose and it lasts until they delete it, so it must
stay visible enough to delete or rename. *(Our call.)*

### Spaces

A group belongs to the space it was made in and shows only there. Its
submenu entry only appears for tabs in that space.

If a group's tab is moved to another space, it leaves the group and is
sorted normally there. *(Our call.)*

If a group's space no longer exists (deleted, or spaces turned off), the
group shows in every space, the way site sections whose spaces are gone
already do, so it can still be renamed or deleted. Never delete groups
automatically. Spaces may not be known yet early in startup, so pruning
then could wipe them. *(Our call.)*

### Pinning, folders, split views

If a group's tab is pinned, moved into a Zen folder, or put in a split
view, it drops out of the group's layout while it's there, but it keeps
its membership. When it comes back to the normal list (unpinned, taken out
of the folder, split view closed), it rejoins its group. Splitting two
project tabs side by side mustn't quietly empty the group. *(Our call.)*

### Turning the mod off

With the mod switched off in Settings → Zen Mods, custom groups disappear
from the sidebar like site sections do. The groups and their tab
memberships are kept, so they come back when the mod is switched on.

## Constraints from the current code

- **The site section list can't hold custom groups.** The settings page's
  `parseSections` (`tab-groups/settings.js`) turns any unknown `kind` into
  `"site"` and drops entries with no sites, then saves the result. Custom
  groups stored in `zen.sitegroups.sections` would be destroyed the first
  time the settings page saves. Keep them in their own pref, for example
  `zen.sitegroups.custom-groups`: a list of `{ id, name, color, space }`
  with a stable `id` that never changes on rename.
- **Membership has to live on the tab.** Store the group `id` on the tab
  with `SessionStore.setCustomTabValue` (read with `getCustomTabValue`,
  clear with `deleteCustomTabValue`), so it survives restarts and Zen's
  unloading, and moves with the tab across windows. Check that it can be
  read from a tab that hasn't been woken since the restart.
- **Key headers and folded state by `id`, not by label.** Today headers
  are found and the folded state is saved by section label
  (`data-label`, `zen.sitegroups.collapsed`). A custom group named like a
  site section must not share its header or folded state, and renaming a
  group must keep it folded or open.
- **Layout runs often and must stay cheap.** `run()` lays out on every
  tab open, close, move, select and page start. Reading a tab's group must
  not add noticeable work per tab.
- **Respect the existing guards.** No re-sorting mid-drag (`movingtab`).
  Woken unloaded tabs keep their place (`lastHost`, 1.5.1). Folders and
  split views are left alone.
- **Code style.** Match `tab-groups.uc.js`: plain functions, short
  comments that say why, no new files unless needed, no dependencies.
- **No automated tests exist.** Verify by hand in Zen (below).

## Left to the builder

- How to detect a tab's opener reliably (`tab.openerTab`, the `TabOpen`
  event, or something else), including for tabs opened in the background.
- Exactly where the color list lives and how it maps onto the existing
  `--zsg-color` styling.
- How to rework header lookup and folded state from labels to ids while
  keeping current users' folded site sections folded.
- README and CHANGELOG entries, and the version bump (a new minor
  version, 1.6.0, per the CHANGELOG's notes on `theme.json`).

## How we'll know it works

Checked by hand in Zen with Sine:

1. With a GitHub section and two GitHub tabs open, add one GitHub tab, one
   YouTube tab and one Google tab to a new group "olai". All three show
   under "olai", above the site sections. The GitHub section shows one tab.
2. Click a link in an olai tab that opens a new tab, and middle-click
   another. Both new tabs join olai. Ctrl+T opens a tab that doesn't.
3. Restart Zen. "olai" and its tabs are back as they were, including the
   ones that stay unloaded until clicked. Clicking an unloaded one keeps it
   in its place.
4. Navigate an olai tab to a different site. It stays in olai.
5. Select three tabs and add them to a second group "3ex" in one step.
6. Remove one tab from olai. It returns to its site section or the normal
   list. Then delete olai. Its remaining tabs go back to normal sorting and
   none close.
7. Rename a folded group. It stays folded. Make a group with the same name
   as a site section: it's refused.
8. Open the settings page, change an option and save. Custom groups are
   untouched.
9. In a second space, the first space's groups don't appear and aren't
   offered in the submenu.
10. Put two olai tabs in a split view, then close the split view. Both are
    back in olai.
11. With olai, a GitHub section and a few loose tabs open, click Zen's
    Clear at the top. Only olai's tabs remain (plus pinned tabs). Repeat
    with the Clear button set to "on the divider" and "both".
