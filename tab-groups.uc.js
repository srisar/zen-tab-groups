// ==UserScript==
// @name           Zen Tab Groups
// @description    Pulls tabs from chosen sites to the top of the sidebar, in your order, under colored, collapsible "YouTube ───" headers.
// @include        main
// ==/UserScript==

(() => {
  // Matches the entry this mod has in Settings > Zen Mods (its on/off switch).
  const MOD_ID = "37f70d31-5119-4f39-9b5b-0393dbe9fa4f";
  // This mod's id in Sine (from theme.json).
  const SINE_MOD_ID = "zen-tab-groups";
  // The settings page sits in a "tab-groups" folder next to this script,
  // wherever the mod manager (Sine, fx-autoconfig, ...) installed it.
  const SCRIPT_URL = Components.stack.filename.split(" -> ").pop().replace(/[?#].*$/, "");
  const SETTINGS_URL = new URL("tab-groups/settings.html", SCRIPT_URL).href;

  const PREF_BRANCH = "zen.sitegroups.";
  const PREF_SECTIONS = "zen.sitegroups.sections";
  const PREF_COLLAPSED = "zen.sitegroups.collapsed";
  // "-v3": earlier caches could hold "no color" from Zen's placeholder icon
  // on a fresh profile; old caches are dropped.
  const PREF_ICON_COLORS = "zen.sitegroups.icon-colors-v3";
  const OLD_ICON_COLOR_PREFS = ["zen.sitegroups.icon-colors", "zen.sitegroups.icon-colors-v2"];
  const PREF_REST_DIVIDER = "zen.sitegroups.rest-divider";
  const PREF_KEEP_EMPTY = "zen.sitegroups.keep-empty-headers";
  const PREF_COLORED = "zen.sitegroups.colored-headers";
  const PREF_CHEVRON = "zen.sitegroups.chevron-position"; // "right" | "left" | "hidden"
  const PREF_TAB_MENU = "zen.sitegroups.tab-menu-items";
  const PREF_TAB_COUNT = "zen.sitegroups.tab-count"; // "folded" | "always" | "never"
  const PREF_HEADER_LINE = "zen.sitegroups.header-line";
  const PREF_HEADER_BUTTON = "zen.sitegroups.header-button"; // "clear" | "unload" | "none"
  // That button as Zen's icon (like a folder's) or as a word.
  const PREF_BUTTON_STYLE = "zen.sitegroups.header-button-style"; // "icon" | "text"
  const PREF_INDENT = "zen.sitegroups.indent-tabs";
  const PREF_GROUP_LINE = "zen.sitegroups.group-line";
  const PREF_BACKGROUND = "zen.sitegroups.background"; // "none" | "header" | "tabs" | "both" | "group"
  const PREF_BG_STRENGTH = "zen.sitegroups.background-strength"; // "4" to "60": % of color in tab backgrounds
  const PREF_COLOR_MODE = "zen.sitegroups.color-mode"; // "section" | "single"
  const PREF_SINGLE_COLOR = "zen.sitegroups.single-color"; // "#rrggbb", with color-mode "single"
  const PREF_READABLE = "zen.sitegroups.readable-text";
  // Zen's "Clear" (close unpinned tabs): above the tabs as usual, on the
  // divider below the sections (closing only the tabs below it), or both.
  const PREF_CLEAR_BUTTON = "zen.sitegroups.clear-button"; // "top" | "divider" | "both"
  // How much color backgrounds use, as [header %, tabs %]. Headers get a
  // bit more so they stand out from their tabs. Same as the settings page's.
  const strengthPcts = value => {
    const s = Math.min(Math.max(Math.round(Number(value)) || 10, 4), 60);
    return [Math.round(s * 1.25), s];
  };
  // A section only forms once this many of its tabs are open in a space,
  // unless it sets its own number ("1" to "10"; a string, so Sine's options
  // box can offer it as a list).
  const PREF_MIN_TABS = "zen.sitegroups.min-tabs";
  const MAX_MIN_TABS = 10;
  // Groups you make and fill by hand, in the normal tab list above the site
  // sections: [{ id, name, color, space }]. Kept apart from the sections,
  // which the settings page rewrites (and would drop these from).
  const PREF_CUSTOM = "zen.sitegroups.custom-groups";
  // A tab's custom group id, kept with the session so it survives restarts.
  const TAB_GROUP_KEY = "zsg-custom-group";
  // New custom groups take these colors in turn.
  const GROUP_COLORS = [
    ["Blue", "#4da3ff"],
    ["Purple", "#a77bf3"],
    ["Cyan", "#3fc1d0"],
    ["Green", "#5bc06a"],
    ["Yellow", "#e6b929"],
    ["Orange", "#f08a3c"],
    ["Red", "#ec5b5b"],
    ["Pink", "#ea6fb4"],
    ["Grey", "#9a9aa2"],
  ];

  // A section is either one website ("site") or several under a name you
  // pick ("collection"). A website can only belong to one section. `spaces`
  // lists the spaces it's used in (Zen workspace ids); empty means all.
  // `minTabs` is how many of its tabs it takes to form; null means the
  // "Group from" option.
  // Sites that tend to pile up dozens of tabs.
  const DEFAULT_SECTIONS = [
    { kind: "site", name: "YouTube", sites: ["youtube.com"], color: null, spaces: [], minTabs: null },
    { kind: "site", name: "Reddit", sites: ["reddit.com"], color: null, spaces: [], minTabs: null },
    { kind: "site", name: "Wikipedia", sites: ["wikipedia.org"], color: null, spaces: [], minTabs: null },
    { kind: "site", name: "X", sites: ["x.com", "twitter.com"], color: null, spaces: [], minTabs: null },
  ];
  const defaultSections = () => DEFAULT_SECTIONS.map(s => ({ ...s, sites: [...s.sites], spaces: [] }));
  const SPACE_ID = /^\{[0-9a-f-]{36}\}$/i;
  const CONTAINER_TAGS = new Set(["tab-group", "zen-folder", "tab-split-view-wrapper"]);
  const BLANK_PAGES = new Set(["about:blank", "about:newtab", "about:home", "about:privatebrowsing"]);

  const CSS = `
    .zsg-header, .zsg-rest {
      --zsg-line: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1));
      align-items: center;
      min-height: 26px;
      margin-inline: var(--tab-inline-padding, 4px);
      padding-inline: 8px 6px;
      border-radius: var(--border-radius-medium, 6px);
      -moz-window-dragging: no-drag;
    }
    .zsg-header {
      gap: 6px;
      font-size: small;
      font-weight: 600;
      cursor: default;
    }
    .zsg-header:hover { background: var(--tab-hover-background-color, rgba(128, 128, 128, 0.12)); }
    /* Drawn as a mask in the text's color (as an image it came out black). */
    .zsg-chevron {
      display: none;
      width: 16px;
      height: 16px;
      background-color: currentColor;
      mask: url("chrome://browser/skin/zen-icons/arrow-right.svg") center / 14px 14px no-repeat;
      opacity: 0.75;
      transform: rotate(90deg);
      transition: transform 0.1s;
    }
    .zsg-header:not([zsg-empty]):hover .zsg-chevron,
    .zsg-header[zsg-closed]:not([zsg-empty]) .zsg-chevron { display: flex; }
    .zsg-header[zsg-closed] .zsg-chevron { transform: rotate(0deg); }
    /* Arrow right after the name; the line shrinks to make room. */
    .zsg-header[zsg-chevron-right] {
      .zsg-label { order: 1; }
      .zsg-count { order: 2; }
      .zsg-chevron { order: 3; margin-inline-start: -2px; }
      .zsg-line { order: 4; }
      .zsg-clear { order: 5; }
    }
    .zsg-label { margin: 0; opacity: 0.75; white-space: nowrap; }
    .zsg-count { margin: 0; opacity: 0.45; font-weight: 500; }
    .zsg-header:not([zsg-closed]) .zsg-count { display: none; }
    .zsg-line { flex: 1; height: 1px; background: var(--zsg-line); }
    .zsg-header[zsg-colored] {
      .zsg-label, .zsg-chevron { color: var(--zsg-color); opacity: 1; }
      .zsg-line { background: color-mix(in srgb, var(--zsg-color) 55%, transparent); }
    }
    /* Readable text: colors worked out against the header's background. */
    .zsg-header[zsg-fg] { color: var(--zsg-fg); }
    .zsg-header[zsg-label] :is(.zsg-label, .zsg-chevron) { color: var(--zsg-label); opacity: 1; }
    .zsg-header[zsg-empty] { opacity: 0.55; }
    .zsg-clear {
      display: none;
      margin: 0;
      font-weight: 500;
      opacity: 0.6;
    }
    .zsg-clear:hover { opacity: 1; }
    /* As an icon: Zen's own, as on a folder (unload) or a tab (close). */
    .zsg-header[zsg-button-icon] .zsg-clear {
      width: 16px;
      height: 16px;
      background-color: currentColor;
      mask: url("chrome://browser/skin/zen-icons/close.svg") center / 14px 14px no-repeat;
    }
    .zsg-header[zsg-button-icon][zsg-button="unload"] .zsg-clear {
      mask-image: url("chrome://browser/skin/zen-icons/unpin.svg");
    }
    .zsg-header:not([zsg-empty]):hover .zsg-clear { display: flex; }
    .zsg-rest { min-height: 12px; gap: 6px; }
    .zsg-rest[zsg-no-line] .zsg-line { visibility: hidden; }
    /* Zen's Clear, on the divider (closes the tabs below it). */
    .zsg-rest-clear { display: none; margin: 0; font-size: small; font-weight: 500; opacity: 0.5; cursor: default; }
    .zsg-rest-clear:hover { opacity: 1; }
    .zsg-rest[zsg-clear] { min-height: 22px; }
    .zsg-rest[zsg-clear] .zsg-rest-clear { display: flex; }
    zen-workspace[zsg-clear-moved] .zen-workspace-close-unpinned-tabs-button { display: none !important; }

    /* Header options: tab count, arrow, line and button. */
    :root[zsg-tab-count="always"] .zsg-header:not([zsg-empty]) .zsg-count { display: flex; }
    :root[zsg-tab-count="never"] .zsg-count,
    .zsg-header[zsg-chevron-hidden] .zsg-chevron,
    .zsg-header[zsg-button="none"] .zsg-clear,
    .zsg-header[zsg-button="unload"][zsg-none-loaded] .zsg-clear { display: none !important; }
    :root[zsg-no-header-line] .zsg-header .zsg-line { visibility: hidden; }

    /* Grouped tabs: indented like a folder's (Zen's own indent), a line along
       each group, a tinted background. --zsg-color is the section's color. */
    :root[zsg-group-line] tab[zsg-group] { --zen-folder-indent: 10px; }
    :root[zsg-indent] tab[zsg-group] { --zen-folder-indent: 16px; }
    :root[zsg-group-line][zen-sidebar-expanded="true"] tab[zsg-group]:not([zen-glance-tab]) {
      position: relative;
      overflow: visible;
    }
    :root[zsg-group-line][zen-sidebar-expanded="true"] tab[zsg-group]:not([zen-glance-tab])::after {
      content: "";
      position: absolute;
      inset-block: calc(-1 * var(--tab-margin-block, 2px));
      inset-inline-start: calc(-1 * var(--zen-folder-indent) + 3px);
      width: 2px;
      border-radius: 1px;
      background: var(--zsg-color, var(--zsg-neutral));
      opacity: 0.75;
      pointer-events: none;
    }
    :root[zsg-group-line] tab[zsg-group][zsg-first]::after { inset-block-start: 4px; }
    :root[zsg-group-line] tab[zsg-group][zsg-last]::after { inset-block-end: 4px; }
    /* Backgrounds. --zsg-bg is the section's color (or the text color for
       an uncolored section), --zsg-hpct / --zsg-tpct the strength. */
    .zsg-header, tab[zsg-group] { --zsg-bg: var(--zsg-color, currentColor); }
    :root[zsg-background="header"],
    :root[zsg-background="both"] {
      .zsg-header:not([zsg-empty]) { background: color-mix(in srgb, var(--zsg-bg) var(--zsg-hpct), transparent); }
      .zsg-header:not([zsg-empty]):hover { background: color-mix(in srgb, var(--zsg-bg) calc(var(--zsg-hpct) + 8%), transparent); }
    }
    :root[zsg-background="tabs"],
    :root[zsg-background="both"] {
      tab[zsg-group]:not([visuallyselected], [multiselected]) > .tab-stack > .tab-background {
        background-color: color-mix(in srgb, var(--zsg-bg) var(--zsg-tpct), transparent) !important;
      }
      tab[zsg-group]:not([visuallyselected], [multiselected]):hover > .tab-stack > .tab-background {
        background-color: color-mix(in srgb, var(--zsg-bg) calc(var(--zsg-tpct) + 8%), transparent) !important;
      }
    }
    /* Whole group: one block behind the header and all of its tabs. */
    :root[zsg-background="group"][zen-sidebar-expanded="true"] {
      .zsg-header:not([zsg-empty]) {
        margin: 6px 2px 0;
        padding-inline: 10px 8px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--zsg-bg) var(--zsg-tpct), transparent);
      }
      .zsg-header:not([zsg-empty]):hover { background: color-mix(in srgb, var(--zsg-bg) calc(var(--zsg-tpct) + 8%), transparent); }
      .zsg-header:not([zsg-empty], [zsg-closed]) { border-end-start-radius: 0; border-end-end-radius: 0; }
      tab[zsg-group]:not([zen-glance-tab]) { position: relative; }
      tab[zsg-group]:not([zen-glance-tab])::before {
        content: "";
        position: absolute;
        inset-block: 0;
        inset-inline: 2px;
        background: color-mix(in srgb, var(--zsg-bg) var(--zsg-tpct), transparent);
        pointer-events: none;
        z-index: -1;
      }
      tab[zsg-group][zsg-last]::before { border-end-start-radius: 12px; border-end-end-radius: 12px; }
    }
    /* Readable text on tinted tabs (not the selected one: Zen's own look). */
    tab[zsg-fg]:not([visuallyselected], [multiselected]) :is(.tab-label, .tab-close-button) { color: var(--zsg-fg) !important; }
    :root { --zsg-neutral: light-dark(rgba(0, 0, 0, 0.25), rgba(255, 255, 255, 0.25)); }

    :root:not([zen-sidebar-expanded="true"]) {
      .zsg-chevron, .zsg-label, .zsg-count, .zsg-clear, .zsg-rest-clear { display: none !important; }
      .zsg-header { min-height: 12px; }
    }

    tab[zsg-collapsed]:not([selected], [multiselected]) { display: none !important; }

    /* The custom group a dragged tab would join. */
    .zsg-header[zsg-drop-target] {
      background: color-mix(in srgb, var(--zsg-color, currentColor) 22%, transparent) !important;
      outline: 2px solid color-mix(in srgb, var(--zsg-color, currentColor) 70%, transparent);
      outline-offset: -2px;
    }
    /* :not(#…) only lifts it above the background options' rules. */
    tab[zsg-drop-target]:not(#zsg-none) > .tab-stack > .tab-background {
      background-color: color-mix(in srgb, var(--zsg-color, currentColor) 18%, transparent) !important;
    }
  `;

  /* ---------- prefs ---------- */

  function readJSON(pref, fallback) {
    try {
      return JSON.parse(Services.prefs.getStringPref(pref));
    } catch {
      return fallback;
    }
  }
  const writeJSON = (pref, value) => Services.prefs.setStringPref(pref, JSON.stringify(value));

  function normalizeSite(text) {
    return String(text ?? "")
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .replace(/[/?#].*$/, "")
      .replace(/^www\./, "");
  }

  function defaultName(site) {
    let base = site;
    try {
      base = Services.eTLD.getBaseDomainFromHost(site);
    } catch {}
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const name = cap(base.split(".")[0]);
    return site === base ? name : `${name} ${cap(site.slice(0, -base.length - 1))}`;
  }

  const displayName = section => section.name?.trim() || defaultName(section.sites[0] ?? "");
  // What a section's header, tabs and folded state are known by: the name for
  // site sections (as before), the id for custom groups, which can be renamed
  // and may share a name with a site section.
  const headerKey = section => (section.kind === "custom" ? `custom:${section.id}` : displayName(section));

  function getSections() {
    const raw = readJSON(PREF_SECTIONS, null);
    if (!Array.isArray(raw)) {
      return defaultSections();
    }
    return raw
      .map(s => ({
        kind: s.kind === "collection" ? "collection" : "site",
        name: String(s.name ?? ""),
        sites: (Array.isArray(s.sites) ? s.sites : []).map(normalizeSite).filter(Boolean),
        color: /^#[0-9a-f]{6}$/i.test(s.color ?? "") ? s.color : null,
        spaces: [...new Set((Array.isArray(s.spaces) ? s.spaces : []).filter(id => SPACE_ID.test(id)))],
        minTabs: Number.isInteger(s.minTabs) && s.minTabs >= 1 && s.minTabs <= MAX_MIN_TABS ? s.minTabs : null,
      }))
      .filter(s => s.sites.length || s.kind === "collection");
  }

  // Ids of the browser's spaces, as of the last layout.
  let knownSpaces = new Set();

  // Whether a section is used in the space with this id (null: no spaces).
  // Spaces it lists that don't exist (deleted, or from a backup made on
  // another computer) don't count, and with none left it's used everywhere.
  const inSpace = (section, spaceId) =>
    !spaceId ||
    section.spaces.includes(spaceId) ||
    !section.spaces.some(id => knownSpaces.has(id));

  // The browser's spaces, for the settings page.
  function getSpaces() {
    try {
      return gZenWorkspaces.getWorkspaces().map(w => ({ id: w.uuid, name: w.name, icon: w.icon ?? "" }));
    } catch {
      return [];
    }
  }
  const setSections = sections => writeJSON(PREF_SECTIONS, sections);

  const getCollapsed = () => new Set(readJSON(PREF_COLLAPSED, []));
  const setCollapsed = set => writeJSON(PREF_COLLAPSED, [...set]);

  /* ---------- custom groups ---------- */

  function getCustomGroups() {
    const raw = readJSON(PREF_CUSTOM, []);
    return (Array.isArray(raw) ? raw : [])
      .filter(g => g && typeof g.id === "string" && g.id && String(g.name ?? "").trim())
      .map(g => ({
        id: g.id,
        name: String(g.name).trim(),
        color: /^#[0-9a-f]{6}$/i.test(g.color ?? "") ? g.color : null,
        space: SPACE_ID.test(g.space ?? "") ? g.space : null,
      }));
  }
  const setCustomGroups = groups => writeJSON(PREF_CUSTOM, groups);

  // A custom group in the shape of a section, so layout, colors, headers and
  // spaces treat both alike. A group with a space that's gone shows in all.
  const asSection = group => ({
    kind: "custom",
    id: group.id,
    name: group.name,
    color: group.color,
    sites: [],
    spaces: group.space ? [group.space] : [],
    minTabs: 1,
  });
  const groupsIn = (groups, space) => groups.filter(g => inSpace(asSection(g), space));

  const tabGroupId = tab => SessionStore.getCustomTabValue(tab, TAB_GROUP_KEY);
  function setTabGroup(tab, id) {
    SessionStore.setCustomTabValue(tab, TAB_GROUP_KEY, id);
    schedule();
  }
  function clearTabGroup(tab) {
    SessionStore.deleteCustomTabValue(tab, TAB_GROUP_KEY);
    schedule();
  }
  // Whether a tab is in a custom group of its space (never with the mod
  // switched off).
  function inCustomGroup(tab) {
    const id = modEnabled && tabGroupId(tab);
    return !!id && groupsIn(getCustomGroups(), tab.getAttribute("zen-workspace-id")).some(g => g.id === id);
  }

  const nameTaken = (name, space, exceptId = null) =>
    groupsIn(getCustomGroups(), space).some(g => g.id !== exceptId && g.name.toLowerCase() === name.toLowerCase());

  // Asks for a group name until it's free in the space; null if cancelled.
  function askGroupName(title, message, initial, space, exceptId = null) {
    for (;;) {
      const name = promptText(title, message, initial);
      if (!name || !nameTaken(name, space, exceptId)) {
        return name || null;
      }
      message = `“${name}” is already a group in this space. Pick another name:`;
      initial = name;
    }
  }

  // Makes a group in the space, named by the user. Returns its id, or null.
  function newGroup(space) {
    const name = askGroupName("New group", "Name for the new group:", "", space);
    if (!name) {
      return null;
    }
    const groups = getCustomGroups();
    const id = Services.uuid.generateUUID().toString();
    const color = GROUP_COLORS[groups.length % GROUP_COLORS.length][1];
    groups.push({ id, name, color, space: SPACE_ID.test(space ?? "") ? space : null });
    setCustomGroups(groups);
    return id;
  }

  // Earlier versions kept groups in numbered slots (zen.sitegroups.<n>.name/sites).
  function migrateOldPrefs() {
    if (Services.prefs.prefHasUserValue(PREF_SECTIONS)) {
      return;
    }
    const sections = [];
    let hadOld = false;
    for (let n = 1; n <= 8; n++) {
      const nameKey = `${PREF_BRANCH}${n}.name`;
      const sitesKey = `${PREF_BRANCH}${n}.sites`;
      if (!Services.prefs.prefHasUserValue(nameKey) && !Services.prefs.prefHasUserValue(sitesKey)) {
        continue;
      }
      hadOld = true;
      const name = Services.prefs.getStringPref(nameKey, "").trim();
      let sites = Services.prefs.getStringPref(sitesKey, "").split(/[\s,;]+/).map(normalizeSite).filter(Boolean);
      // youtu.be links redirect to youtube.com, so YouTube stays a single site.
      if (sites.includes("youtube.com")) {
        sites = sites.filter(s => s !== "youtu.be");
      }
      if (name && sites.length) {
        sections.push({ kind: sites.length > 1 ? "collection" : "site", name, sites, color: null });
      }
      Services.prefs.clearUserPref(nameKey);
      Services.prefs.clearUserPref(sitesKey);
    }
    setSections(hadOld ? sections : defaultSections());
  }

  /* ---------- on/off switch in Settings > Zen Mods ---------- */

  let modEnabled = true;
  async function refreshModEnabled() {
    try {
      const mods = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "zen-themes.json"));
      const mod = mods?.[MOD_ID];
      modEnabled =
        !Services.prefs.getBoolPref("zen.themes.disable-all", false) &&
        (!mod || mod.enabled === undefined || mod.enabled);
    } catch {
      modEnabled = true;
    }
  }

  /* ---------- header colors from site icons ---------- */

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) {
      return [0, 0, l];
    }
    const d = max - min;
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
      h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const hex = v => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  /* ---------- readable text ---------- */

  // "#rrggbb", "rgb(a)(…)" or "color(srgb r g b / a)" -> [r, g, b], 0-255.
  function parseColor(value) {
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    }
    const nums = (value.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3);
    return value.startsWith("color(") ? nums.map(v => v * 255) : nums;
  }
  const mixRgb = (a, b, share) => a.map((v, i) => v * share + b[i] * (1 - share));
  function luminance(rgb) {
    const [r, g, b] = rgb.map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // `fg`, or `fg` taken toward black or white until it reads on `bg`
  // (null: it already does). Same as the settings page's.
  function readableOn(fg, bg, min) {
    if (contrast(fg, bg) >= min) {
      return null;
    }
    const toward = luminance(bg) > 0.18 ? [0, 0, 0] : [255, 255, 255];
    let out = fg;
    for (let share = 0.1; share < 1.05 && contrast(out, bg) < min; share += 0.1) {
      out = mixRgb(toward, fg, Math.min(share, 1));
    }
    return "#" + out.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
  }

  // Text colors for a section that keep it readable on its backgrounds.
  // The sidebar's own color isn't readable from CSS (themes use gradients),
  // so it's taken as near-black or near-white, the opposite of its text.
  function sectionInk(color, text, opts) {
    const base = luminance(text) > 0.3 ? [32, 32, 36] : [245, 245, 247];
    const [hPct, tPct] = strengthPcts(opts.strength);
    const bg = opts.background;
    const headerPct = bg === "header" || bg === "both" ? hPct : bg === "group" ? tPct : 0;
    const tabPct = bg === "tabs" || bg === "both" || bg === "group" ? tPct : 0;
    const tint = color ? parseColor(color) : text;
    const headerBg = mixRgb(tint, base, headerPct / 100);
    return {
      header: headerPct ? readableOn(text, headerBg, 4.5) : null,
      // Names are bold, so plain headers get the lighter bar for large text.
      label: readableOn(tint, headerBg, headerPct ? 4.5 : 3),
      tabs: tabPct ? readableOn(text, mixRgb(tint, base, tabPct / 100), 4.5) : null,
    };
  }

  function setInk(el, attr, prop, value) {
    el.toggleAttribute(attr, !!value);
    if (value) {
      el.style.setProperty(prop, value);
    } else {
      el.style.removeProperty(prop);
    }
  }

  // Header color from a site icon:
  // - the most common color wins (YouTube: the red, not red mixed with white)
  // - white, grey and near-black pixels never count, so a half white, half
  //   green logo is green
  // - a mostly black/dark logo, or one with almost no color, gets no tint
  //   (null: the sidebar's normal text color)
  // - only when no single shade clearly leads is the color averaged
  function dominantColor(img) {
    const size = 32;
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // No smoothing: blending pixels while scaling invents in-between shades.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // Count every exact colorful shade (logos use flat colors; gradients
    // spread over many slightly different ones), and its hue family
    // (12 families of 30°, shifted so pure red sits in the middle of one).
    const shades = new Map();
    const families = Array.from({ length: 12 }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
    const add = (into, r, g, b) => {
      into.n++;
      into.r += r;
      into.g += g;
      into.b += b;
    };
    let opaque = 0;
    let dark = 0;
    let colorful = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 128) {
        continue;
      }
      opaque++;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (l < 0.2) {
        dark++;
        continue;
      }
      if (l > 0.85 || s < 0.25) {
        continue; // white / grey
      }
      colorful++;
      const key = (r << 16) | (g << 8) | b;
      if (!shades.has(key)) {
        shades.set(key, { n: 0, r: 0, g: 0, b: 0 });
      }
      add(shades.get(key), r, g, b);
      add(families[Math.floor(((h + 15) % 360) / 30)], r, g, b);
    }
    if (!opaque || dark / opaque >= 0.75 || colorful / opaque < 0.08) {
      return null;
    }
    // The most common shade, if it clearly leads; otherwise the average of
    // the biggest hue family (counting its neighbours, so a gradient that
    // crosses a family border isn't split in two).
    const [top, second] = [...shades.values()].sort((a, b) => b.n - a.n);
    let pick = top;
    if (second && top.n < second.n * 1.5 && top.n < colorful * 0.25) {
      const score = i => families[i].n + 0.5 * (families[(i + 11) % 12].n + families[(i + 1) % 12].n);
      let best = 0;
      for (let i = 1; i < 12; i++) {
        if (score(i) > score(best)) {
          best = i;
        }
      }
      pick = families[best];
    }
    let [h, s, l] = rgbToHsl(pick.r / pick.n, pick.g / pick.n, pick.b / pick.n);
    // Keep it readable on the sidebar without changing its character.
    l = Math.min(Math.max(l, 0.45), 0.72);
    s = Math.max(s, 0.45);
    return hslToHex(h, s, l);
  }

  function loadImage(src) {
    return new Promise(resolve => {
      const img = new window.Image();
      img.onload = () => resolve(img.naturalWidth ? img : null);
      img.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 5000);
      img.src = src;
    });
  }

  function iconCandidates(site) {
    const list = [];
    // An open tab on exactly this site (not a sub-site: a YouTube Music tab
    // must not lend its icon to YouTube).
    for (const tab of gBrowser.tabs) {
      const host = tabHost(tab);
      const image = tab.getAttribute("image");
      if (image && (host === site || host === "www." + site)) {
        list.push(image);
        break;
      }
    }
    list.push(`page-icon:https://www.${site}/`, `page-icon:https://${site}/`, `https://${site}/favicon.ico`);
    return list;
  }

  // Cached color for a website: "#rrggbb", "" (icon has no clear color),
  // or undefined (not worked out yet).
  const cachedIconColor = site => readJSON(PREF_ICON_COLORS, {})[site];

  const colorJobs = new Map();
  // Sites with no trustworthy icon yet; retried once a tab's icon arrives.
  const unsureSites = new Set();
  function retryUnsureColors() {
    for (const site of unsureSites) {
      colorJobs.delete(site);
    }
    unsureSites.clear();
    schedule();
  }
  function iconColor(site) {
    const cached = cachedIconColor(site);
    if (cached !== undefined) {
      return Promise.resolve(cached || null);
    }
    if (!colorJobs.has(site)) {
      const job = (async () => {
        let color = null;
        let sure = false; // only a real icon's answer is cached
        for (const src of iconCandidates(site)) {
          const img = await loadImage(src);
          if (!img) {
            continue;
          }
          try {
            color = dominantColor(img);
          } catch {}
          // No color from "page-icon:" may just be Zen's grey placeholder (a
          // site this profile hasn't visited yet), so try the next icon.
          if (color || !src.startsWith("page-icon:")) {
            sure = true;
            break;
          }
        }
        if (sure) {
          writeJSON(PREF_ICON_COLORS, { ...readJSON(PREF_ICON_COLORS, {}), [site]: color ?? "" });
          colorJobs.delete(site);
        } else {
          unsureSites.add(site); // the job stays, so it isn't rerun each layout
        }
        return color;
      })();
      colorJobs.set(site, job);
    }
    return colorJobs.get(site);
  }

  // Color for a section's header, or null. Starts the icon lookup if needed;
  // the header updates when the color cache pref changes.
  function sectionColor(section) {
    if (section.color) {
      return section.color;
    }
    for (const site of section.sites) {
      const cached = cachedIconColor(site);
      if (cached === undefined) {
        iconColor(site);
        return null;
      }
      if (cached) {
        return cached;
      }
    }
    return null;
  }

  /* ---------- matching ---------- */

  // URL a tab is on or about to load. New tabs report about:blank until the
  // page starts loading, so look at what was requested before that.
  const pendingURL = new WeakMap();

  function parseURI(spec) {
    try {
      return Services.io.newURI(spec);
    } catch {
      return null;
    }
  }

  function tabURI(tab) {
    const browser = tab.linkedBrowser;
    const pending = browser && pendingURL.get(browser);
    if (pending) {
      return parseURI(pending);
    }
    let uri = browser?.currentURI;
    if (!uri || BLANK_PAGES.has(uri.spec)) {
      const typed = browser?.userTypedValue;
      const typedURI = typed && /^https?:\/\//i.test(typed) ? parseURI(typed) : null;
      if (typedURI) {
        return typedURI;
      }
      try {
        const lazy = SessionStore.getLazyTabValue(tab, "url");
        if (lazy) {
          uri = parseURI(lazy) ?? uri;
        }
      } catch {}
    }
    return uri;
  }

  // The site each tab was last on. A tab woken from unloaded is on
  // about:blank until its page starts loading (Zen forgets the address it
  // kept for it), so it keeps its site meanwhile: otherwise it leaves its
  // section for a moment, the tabs below it move up, and it comes back at
  // the section's end.
  const lastHost = new WeakMap();

  function tabHost(tab) {
    let host = null;
    try {
      const uri = tabURI(tab);
      if (uri?.spec === "about:blank" && lastHost.has(tab)) {
        return lastHost.get(tab);
      }
      host = uri?.host?.toLowerCase() || null;
    } catch {} // about:, file:, etc.
    if (host) {
      lastHost.set(tab, host);
    } else {
      lastHost.delete(tab);
    }
    return host;
  }

  // Index of the section whose website matches most specifically, or -1.
  // With `spaceId`, only sections used in that space count.
  function sectionIndexForHost(host, sections, spaceId = null) {
    if (!host) {
      return -1;
    }
    let best = -1;
    let bestLen = 0;
    sections.forEach((section, i) => {
      if (spaceId && !inSpace(section, spaceId)) {
        return;
      }
      for (const d of section.sites) {
        if ((host === d || host.endsWith("." + d)) && d.length > bestLen) {
          best = i;
          bestLen = d.length;
        }
      }
    });
    return best;
  }

  /* ---------- sidebar layout ---------- */

  const isOurs = el => el.classList.contains("zsg-header") || el.classList.contains("zsg-rest");

  function isContent(el) {
    if (el.localName === "tab") {
      return !el.hasAttribute("zen-empty-tab") && !el.closing && !el.pinned;
    }
    return CONTAINER_TAGS.has(el.localName);
  }

  function nextContent(el) {
    let n = el.nextElementSibling;
    while (n && !isContent(n)) {
      n = n.nextElementSibling;
    }
    return n;
  }

  function makeHeader(key) {
    const header = document.createXULElement("hbox");
    header.className = "zsg-header";
    header.setAttribute("data-key", key);
    header.setAttribute("context", "zsg-header-menu");
    const chevron = document.createXULElement("image");
    chevron.className = "zsg-chevron";
    const text = document.createXULElement("label");
    text.className = "zsg-label";
    const count = document.createXULElement("label");
    count.className = "zsg-count";
    const line = document.createXULElement("hbox");
    line.className = "zsg-line";
    // "Clear" or "Unload", whichever the options pick (updateHeader).
    const clear = document.createXULElement("label");
    clear.className = "zsg-clear";
    header.append(chevron, text, count, line, clear);

    // Keep clicks away from the tab strip (double-click there opens a new tab).
    for (const type of ["mousedown", "dblclick", "auxclick"]) {
      header.addEventListener(type, e => e.stopPropagation());
    }
    header.addEventListener("click", e => {
      e.stopPropagation();
      if (e.button !== 0 || header.hasAttribute("zsg-empty")) {
        return;
      }
      if (e.target.classList.contains("zsg-clear")) {
        header.getAttribute("zsg-button") === "unload" ? unloadGroup(header) : closeGroup(header);
      } else {
        toggleCollapsed(header.getAttribute("data-key"));
      }
    });
    return header;
  }

  function makeRestDivider() {
    const rest = document.createXULElement("hbox");
    rest.className = "zsg-rest";
    const line = document.createXULElement("hbox");
    line.className = "zsg-line";
    const clear = document.createXULElement("label");
    clear.className = "zsg-rest-clear";
    clear.setAttribute("value", "Clear");
    clear.setAttribute("tooltiptext", "Close the tabs below (the ones not in a section)");
    rest.append(line, clear);
    for (const type of ["mousedown", "dblclick", "auxclick"]) {
      rest.addEventListener(type, e => e.stopPropagation());
    }
    rest.addEventListener("click", e => {
      e.stopPropagation();
      if (e.button === 0 && e.target === clear) {
        closeRest(rest);
      }
    });
    return rest;
  }

  const BUTTONS = {
    clear: ["Clear", "Close all tabs in this section"],
    unload: ["Unload", "Unload all tabs in this section"],
  };

  // A tab whose page is loaded (not unloaded, and not waiting to load).
  const isLoaded = tab => !tab.hasAttribute("pending");

  function setColor(el, color) {
    if (color) {
      el.style.setProperty("--zsg-color", color);
    } else {
      el.style.removeProperty("--zsg-color");
    }
  }

  // A section's color: its own (picked or from its icon), the one color
  // for all, or null with colors off.
  function colorFor(section, opts) {
    if (!opts.colored) {
      return null;
    }
    return opts.colorMode === "single" ? opts.singleColor : sectionColor(section);
  }

  function updateHeader(header, section, tabs, opts, look) {
    const label = displayName(section);
    header.setAttribute("data-label", label);
    header.querySelector(".zsg-label").setAttribute("value", label);
    header.querySelector(".zsg-count").setAttribute("value", String(tabs.length));
    header.toggleAttribute("zsg-closed", tabs.length > 0 && opts.collapsed.has(headerKey(section)));
    header.toggleAttribute("zsg-empty", !tabs.length);
    header.toggleAttribute("zsg-chevron-right", opts.chevron === "right");
    header.toggleAttribute("zsg-chevron-hidden", opts.chevron === "hidden");
    header.setAttribute("zsg-button", opts.button);
    header.toggleAttribute("zsg-none-loaded", !tabs.some(isLoaded));
    const [text, tooltip] = BUTTONS[opts.button] ?? BUTTONS.clear;
    const icon = opts.buttonStyle === "icon";
    header.toggleAttribute("zsg-button-icon", icon);
    const button = header.querySelector(".zsg-clear");
    button.setAttribute("value", icon ? "" : text);
    button.setAttribute("tooltiptext", tooltip);
    header.toggleAttribute("zsg-colored", !!look.color);
    setColor(header, look.color);
    setInk(header, "zsg-fg", "--zsg-fg", look.ink?.header);
    setInk(header, "zsg-label", "--zsg-label", look.ink?.label);
  }

  function ungroup(tab) {
    for (const name of ["zsg-group", "zsg-collapsed", "zsg-first", "zsg-last"]) {
      tab.removeAttribute(name);
    }
    tab.style.removeProperty("--zsg-color");
    setInk(tab, "zsg-fg", "--zsg-fg", null);
  }

  // Lays out one space's tabs. Returns the tabs it put in a section.
  // `groups`: the custom groups, or null to leave tabs' groups alone (mod off).
  function layoutSection(container, siteSections, groups, opts) {
    const spaceId = container.getAttribute("zen-workspace-id");
    const content = [...container.children].filter(isContent);
    // This space's custom groups come first, above the site sections.
    const custom = groupsIn(groups ?? [], spaceId);
    const sections = [...custom.map(asSection), ...siteSections];
    let grouped = [];
    for (const el of content) {
      if (el.localName !== "tab") {
        continue;
      }
      // A tab in a custom group stays there, whatever its site.
      const id = groups ? tabGroupId(el) : "";
      let si = id ? custom.findIndex(g => g.id === id) : -1;
      // Its group was deleted: it leaves it for good. (Not relaid out: this
      // layout already sorts it.) A group of another space only isn't laid
      // out here: tabs can pass through other lists while Zen starts up, so
      // that's no reason to forget their group.
      if (id && si < 0 && !groups.some(g => g.id === id)) {
        SessionStore.deleteCustomTabValue(el, TAB_GROUP_KEY);
      }
      if (si < 0) {
        const i = sectionIndexForHost(tabHost(el), siteSections, spaceId);
        si = i < 0 ? -1 : custom.length + i;
      }
      if (si >= 0) {
        grouped.push({ tab: el, si });
      } else {
        ungroup(el);
      }
    }
    // Sections with fewer tabs than their minimum don't form: their tabs stay
    // where they are.
    const counts = new Map();
    for (const { si } of grouped) {
      counts.set(si, (counts.get(si) ?? 0) + 1);
    }
    grouped = grouped.filter(({ tab, si }) => {
      if (counts.get(si) >= (sections[si].minTabs ?? opts.minTabs)) {
        return true;
      }
      ungroup(tab);
      return false;
    });
    // Stable: keeps order within a section, but tabs dropped on a group's
    // header go first in it.
    grouped.sort((a, b) => a.si - b.si || droppedFirst.has(b.tab) - droppedFirst.has(a.tab));
    // Each section's color, and text colors that read on its backgrounds.
    const text = parseColor(getComputedStyle(container).color);
    const looks = new Map();
    const lookFor = si => {
      if (!looks.has(si)) {
        const color = colorFor(sections[si], opts);
        looks.set(si, { color, ink: opts.readable ? sectionInk(color, text, opts) : null });
      }
      return looks.get(si);
    };
    grouped.forEach(({ tab, si }, i) => {
      const key = headerKey(sections[si]);
      tab.setAttribute("zsg-group", key);
      tab.toggleAttribute("zsg-collapsed", opts.collapsed.has(key));
      tab.toggleAttribute("zsg-first", grouped[i - 1]?.si !== si);
      tab.toggleAttribute("zsg-last", grouped[i + 1]?.si !== si);
      const look = lookFor(si);
      setColor(tab, look.color);
      setInk(tab, "zsg-fg", "--zsg-fg", look.ink?.tabs);
    });

    // 1. Move grouped tabs to the top, in section order.
    let prevTab = null;
    for (const { tab } of grouped) {
      try {
        if (!prevTab) {
          const first = [...container.children].find(isContent);
          if (first && first !== tab) {
            gBrowser.moveTabBefore(tab, first);
          }
        } else if (nextContent(prevTab) !== tab) {
          gBrowser.moveTabAfter(tab, prevTab);
        }
      } catch (ex) {
        console.error("[Zen Tab Groups] move failed", ex);
      }
      prevTab = tab;
    }

    // 2. A header above each section (also empty ones, if enabled).
    const existing = new Map();
    for (const el of container.children) {
      if (el.classList.contains("zsg-header")) {
        existing.set(el.getAttribute("data-key"), el);
      }
    }
    const keep = new Set();
    let last = null; // last element of the sections area so far
    sections.forEach((section, si) => {
      const tabs = grouped.filter(g => g.si === si).map(g => g.tab);
      // A custom group keeps its header while empty: it lasts until deleted.
      if ((!tabs.length && !opts.keepEmpty && section.kind !== "custom") || !inSpace(section, spaceId)) {
        return;
      }
      const key = headerKey(section);
      if (keep.has(existing.get(key))) {
        return; // two sections with the same name: the first one wins
      }
      const header = existing.get(key) ?? makeHeader(key);
      updateHeader(header, section, tabs, opts, lookFor(si));

      if (tabs.length) {
        if (header.nextElementSibling !== tabs[0]) {
          container.insertBefore(header, tabs[0]);
        }
        last = tabs.at(-1);
      } else if (last) {
        if (last.nextElementSibling !== header) {
          last.after(header);
        }
        last = header;
      } else {
        // Nothing placed yet: go first. (The new-tab button row is always
        // the container's last child, so never insert after it.)
        const anchor =
          [...container.children].find(isContent) ??
          container.querySelector(":scope > #tabbrowser-arrowscrollbox-periphery");
        if (anchor && header.nextElementSibling !== anchor) {
          container.insertBefore(header, anchor);
        }
        last = header;
      }
      keep.add(header);
    });

    // 3. A plain line between the sections and everything else, with Zen's
    // Clear on it if picked (then just the button if the line is off).
    const clearHere = opts.clearButton !== "top";
    if (last && (opts.restDivider || clearHere)) {
      const firstOther = nextContent(last);
      if (firstOther) {
        let rest = [...container.children].find(el => el.classList.contains("zsg-rest"));
        rest ??= makeRestDivider();
        if (rest.nextElementSibling !== firstOther) {
          container.insertBefore(rest, firstOther);
        }
        rest.toggleAttribute("zsg-no-line", !opts.restDivider);
        rest.toggleAttribute("zsg-clear", clearHere);
        keep.add(rest);
      }
    }
    // Zen's own Clear (above the tabs) goes away when it's on the divider
    // only, as long as there are sections; without any, it stays.
    container.closest("zen-workspace")?.toggleAttribute("zsg-clear-moved", !!last && opts.clearButton === "divider");

    for (const el of [...container.children]) {
      if (isOurs(el) && !keep.has(el)) {
        el.remove();
      }
    }
    return grouped.map(({ tab }) => tab);
  }

  // Options that style tabs and headers through attributes on the window.
  function applyLook(opts) {
    const root = document.documentElement;
    root.setAttribute("zsg-tab-count", opts.tabCount);
    root.setAttribute("zsg-background", opts.background);
    const [hPct, tPct] = strengthPcts(opts.strength);
    root.style.setProperty("--zsg-hpct", hPct + "%");
    root.style.setProperty("--zsg-tpct", tPct + "%");
    root.toggleAttribute("zsg-no-header-line", !opts.headerLine);
    root.toggleAttribute("zsg-indent", opts.indent);
    root.toggleAttribute("zsg-group-line", opts.groupLine);
  }

  const choice = (pref, fallback, values) => {
    const value = Services.prefs.getStringPref(pref, fallback);
    return values.includes(value) ? value : fallback;
  };

  // Lay out before the next paint, so new tabs never flash in the wrong spot.
  let frame = null;
  let retry = null;
  function schedule() {
    if (frame === null) {
      frame = requestAnimationFrame(run);
    }
  }

  function run() {
    frame = null;
    // Don't fight the user mid-drag.
    if (gBrowser.tabContainer.hasAttribute("movingtab")) {
      clearTimeout(retry);
      retry = setTimeout(schedule, 300);
      return;
    }
    try {
      // Switched off in Settings: an empty list strips everything back out.
      const sections = modEnabled ? getSections() : [];
      const groups = modEnabled ? getCustomGroups() : null;
      const opts = {
        collapsed: getCollapsed(),
        keepEmpty: Services.prefs.getBoolPref(PREF_KEEP_EMPTY, false),
        restDivider: Services.prefs.getBoolPref(PREF_REST_DIVIDER, true),
        colored: Services.prefs.getBoolPref(PREF_COLORED, true),
        chevron: choice(PREF_CHEVRON, "right", ["right", "left", "hidden"]),
        tabCount: choice(PREF_TAB_COUNT, "folded", ["folded", "always", "never"]),
        headerLine: Services.prefs.getBoolPref(PREF_HEADER_LINE, true),
        button: choice(PREF_HEADER_BUTTON, "clear", ["clear", "unload", "none"]),
        buttonStyle: choice(PREF_BUTTON_STYLE, "icon", ["icon", "text"]),
        indent: Services.prefs.getBoolPref(PREF_INDENT, false),
        groupLine: Services.prefs.getBoolPref(PREF_GROUP_LINE, false),
        background: choice(PREF_BACKGROUND, "none", ["none", "header", "tabs", "both", "group"]),
        strength: Services.prefs.getStringPref(PREF_BG_STRENGTH, "10"),
        colorMode: choice(PREF_COLOR_MODE, "section", ["section", "single"]),
        singleColor: /^#[0-9a-f]{6}$/i.test(Services.prefs.getStringPref(PREF_SINGLE_COLOR, ""))
          ? Services.prefs.getStringPref(PREF_SINGLE_COLOR)
          : "#4da3ff",
        readable: Services.prefs.getBoolPref(PREF_READABLE, true),
        clearButton: choice(PREF_CLEAR_BUTTON, "top", ["top", "divider", "both"]),
        minTabs: Number(choice(PREF_MIN_TABS, "1", Array.from({ length: MAX_MIN_TABS }, (_, i) => String(i + 1)))),
      };
      applyLook(opts);
      knownSpaces = new Set(getSpaces().map(s => s.id));
      const grouped = new Set();
      for (const container of document.querySelectorAll(".zen-workspace-normal-tabs-section")) {
        layoutSection(container, sections, groups, opts).forEach(tab => grouped.add(tab));
      }
      droppedFirst.clear(); // placed: from now on they're ordinary tabs
      // Tabs that left a space's list (pinned, put in a folder or a split
      // view) keep nothing of their section, so a folded one isn't hidden.
      for (const tab of gBrowser.tabs) {
        if (!grouped.has(tab) && tab.hasAttribute("zsg-group")) {
          ungroup(tab);
        }
      }
    } catch (ex) {
      console.error("[Zen Tab Groups]", ex);
    }
  }

  /* ---------- dragging tabs into and out of custom groups ---------- */

  const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";
  // Tabs dropped on a group's header, for the next layout to put first.
  const droppedFirst = new Set();

  // Where tabs dragged in this window would land, judged from the pointer
  // (Zen decides where they go in the list; this decides their group):
  // - { key, header }: a custom group, over its header or one of its tabs
  // - "loose": elsewhere in the normal list (sections, other tabs, divider,
  //   the space below): tabs leave their group
  // - null: anywhere else (pinned tabs, split views, outside the sidebar):
  //   Zen's business, groups are left as they are
  function dropTargetAt(event, moving) {
    const space = event.target?.closest?.("zen-workspace");
    if (!space || event.target.closest(".zen-workspace-pinned-tabs-section")) {
      return null;
    }
    const list = space.querySelector(".zen-workspace-normal-tabs-section");
    let best = null;
    let bestDist = Infinity;
    let bottom = -Infinity;
    for (const el of list?.children ?? []) {
      if (moving.includes(el) || !(isContent(el) || isOurs(el))) {
        continue;
      }
      // Other tabs make room for the dragged ones, so their boxes as drawn
      // are what the user sees. Folded tabs have none.
      const r = el.getBoundingClientRect();
      if (!r.height) {
        continue;
      }
      bottom = Math.max(bottom, r.bottom);
      const dist = Math.max(r.top - event.clientY, event.clientY - r.bottom, 0);
      if (dist < bestDist) {
        best = el;
        bestDist = dist;
      }
    }
    if (!best || event.clientY > bottom) {
      return "loose";
    }
    if (CONTAINER_TAGS.has(best.localName)) {
      return null;
    }
    const header = best.classList.contains("zsg-header");
    const key = header ? best.getAttribute("data-key") : best.getAttribute("zsg-group");
    return key?.startsWith("custom:") ? { key, header } : "loose";
  }

  // The tab being dragged and the tabs moving with it, if it's a tab drag
  // from this window.
  function draggedTabs(event) {
    const dragged = event.dataTransfer?.mozGetDataAt(TAB_DROP_TYPE, 0);
    if (!modEnabled || dragged?.localName !== "tab" || dragged.documentGlobal !== window) {
      return null;
    }
    return (dragged._dragData?.movingTabs ?? [dragged]).filter(t => t.localName === "tab");
  }

  let litKey = null;
  function lightUp(key) {
    if (key === litKey) {
      return;
    }
    litKey = key;
    for (const el of document.querySelectorAll("[zsg-drop-target]")) {
      el.removeAttribute("zsg-drop-target");
    }
    if (key) {
      for (const el of document.querySelectorAll(".zsg-header[data-key], tab[zsg-group]")) {
        if ((el.getAttribute("data-key") ?? el.getAttribute("zsg-group")) === key) {
          el.setAttribute("zsg-drop-target", "");
        }
      }
    }
  }

  function setupDrag() {
    window.addEventListener(
      "dragover",
      e => {
        const tabs = draggedTabs(e);
        const target = tabs && dropTargetAt(e, tabs);
        lightUp(target?.key ?? null);
      },
      true
    );
    // Before Zen's own drop: the group is set now, and the layout that
    // follows the move (once the drag is over) puts the tabs in it.
    window.addEventListener(
      "drop",
      e => {
        lightUp(null);
        const tabs = draggedTabs(e);
        // Ctrl-drag copies: the dragged tabs stay where they were.
        if (!tabs || e.dataTransfer.dropEffect === "copy") {
          return;
        }
        const target = dropTargetAt(e, tabs);
        if (target === "loose") {
          tabs.filter(inCustomGroup).forEach(clearTabGroup);
        } else if (target) {
          const id = target.key.slice("custom:".length);
          for (const tab of tabs) {
            setTabGroup(tab, id);
            if (target.header) {
              droppedFirst.add(tab);
            }
          }
        }
      },
      true
    );
    window.addEventListener("dragend", () => lightUp(null), true);
  }

  /* ---------- actions ---------- */

  function toggleCollapsed(key) {
    const set = getCollapsed();
    set.has(key) ? set.delete(key) : set.add(key);
    setCollapsed(set); // pref observer re-runs layout
  }

  function groupTabs(header) {
    const key = header.getAttribute("data-key");
    return [...header.parentElement.children].filter(
      el => el.localName === "tab" && el.getAttribute("zsg-group") === key
    );
  }

  // The divider's Clear: the tabs below it, which aren't in a section
  // (folders and split views are left alone, like Zen's own Clear).
  function closeRest(rest) {
    const tabs = [...rest.parentElement.children].filter(
      el => el.localName === "tab" && !el.hasAttribute("zsg-group") && !el.pinned
    );
    if (tabs.length) {
      gBrowser.removeTabs(tabs);
    }
  }

  function closeGroup(header) {
    gBrowser.removeTabs(groupTabs(header));
  }

  // Like a folder's unload button: the tabs stay, their pages are unloaded
  // (Zen picks another tab first if the selected one is among them).
  function unloadGroup(header) {
    const tabs = groupTabs(header).filter(isLoaded);
    if (tabs.length) {
      gBrowser.explicitUnloadTabs(tabs);
    }
  }

  function openSettings() {
    const existing = gBrowser.tabs.find(t => t.linkedBrowser?.currentURI?.spec === SETTINGS_URL);
    gBrowser.selectedTab = existing ?? gBrowser.addTrustedTab(SETTINGS_URL);
  }

  function promptText(title, message, initial) {
    const value = { value: initial };
    return Services.prompt.prompt(window, title, message, value, null, {}) ? value.value.trim() : null;
  }

  // The site to group for a tab: the main site (en.wikipedia.org ->
  // wikipedia.org), except for real sub-sites like music.youtube.com.
  function siteForHost(host) {
    const site = normalizeSite(host);
    let base = site;
    try {
      base = Services.eTLD.getBaseDomainFromHost(site);
    } catch {
      return site;
    }
    const sub = site.slice(0, -base.length - 1);
    return !sub || /^(www\d*|m|mobile|amp|[a-z]{2}(-[a-z]{2})?)$/.test(sub) ? base : site;
  }

  function addSiteAsSection(host) {
    const site = siteForHost(host);
    const name = promptText("New section", `Name for the section with tabs from ${site}:`, defaultName(site));
    if (name === null) {
      return;
    }
    const sections = getSections();
    sections.push({ kind: "site", name, sites: [site], color: null });
    setSections(sections);
  }

  function addSiteToCollection(host, index) {
    const sections = getSections();
    sections[index].sites.push(siteForHost(host));
    setSections(sections);
  }

  function removeSite(host) {
    const sections = getSections();
    const si = sectionIndexForHost(host, sections);
    if (si < 0) {
      return;
    }
    const section = sections[si];
    const site = section.sites.find(d => host === d || host.endsWith("." + d));
    section.sites = section.sites.filter(d => d !== site);
    if (!section.sites.length && section.kind === "site") {
      sections.splice(si, 1);
    }
    setSections(sections);
  }

  /* ---------- menus ---------- */

  function menuItem(label, oncommand) {
    const item = document.createXULElement("menuitem");
    item.setAttribute("label", label);
    item.addEventListener("command", oncommand);
    return item;
  }

  function setupMenus() {
    // Tab context menu: put the tab's website in a section, or take it out.
    let contextHost = null;
    const tabMenu = document.getElementById("tabContextMenu");
    const sep = document.createXULElement("menuseparator");
    // Labels name the tab's site once the menu opens; these are for anything
    // that lists the items before that (like Zen Context Menu's settings).
    const ownItem = menuItem("Give this site its own section", () => contextHost && addSiteAsSection(contextHost));
    const collectionMenu = document.createXULElement("menu");
    collectionMenu.setAttribute("label", "Add this site to a collection");
    const collectionPopup = document.createXULElement("menupopup");
    collectionMenu.append(collectionPopup);
    const removeItem = menuItem("Remove this site from its section", () => contextHost && removeSite(contextHost));
    // Custom groups: put the tab (or all selected tabs) in one, or take it out.
    // The tabs are noted when the menu opens; the name prompt outlasts it.
    let menuTabs = [];
    let currentGroup = null;
    const groupMenu = document.createXULElement("menu");
    groupMenu.setAttribute("label", "Add to group");
    const groupPopup = document.createXULElement("menupopup");
    groupMenu.append(groupPopup);
    const leaveItem = menuItem("Remove from its group", () => {
      menuTabs.filter(t => tabGroupId(t) === currentGroup?.id).forEach(clearTabGroup);
    });
    const settingsItem = menuItem("Tab Groups settings…", openSettings);
    const siteItems = [ownItem, collectionMenu, removeItem, settingsItem];
    // Ids let other mods (Zen Context Menu) recognize the items, whose labels
    // change with the tab's site.
    sep.id = "context_zsg-separator";
    ownItem.id = "context_zsg-own-section";
    collectionMenu.id = "context_zsg-add-to-collection";
    removeItem.id = "context_zsg-remove-site";
    groupMenu.id = "context_zsg-add-to-group";
    leaveItem.id = "context_zsg-remove-from-group";
    settingsItem.id = "context_zsg-settings";
    tabMenu.append(sep, ownItem, collectionMenu, removeItem, groupMenu, leaveItem, settingsItem);

    // The groups the tab can go in (all but its own), then "New group…".
    function fillGroupItems(tab) {
      groupMenu.hidden = leaveItem.hidden = !tab;
      if (!tab) {
        return;
      }
      const tabs = (tab.multiselected ? gBrowser.selectedTabs : [tab]).filter(t => !t.pinned);
      const space = tab.getAttribute("zen-workspace-id") || null;
      const groups = getCustomGroups();
      menuTabs = tabs;
      currentGroup = groupsIn(groups, space).find(g => g.id === tabGroupId(tab)) ?? null;
      leaveItem.hidden = !currentGroup;
      if (currentGroup) {
        leaveItem.setAttribute("label", `Remove from “${currentGroup.name}”`);
      }
      const others = groupsIn(groups, space).filter(g => g !== currentGroup);
      groupPopup.replaceChildren(
        ...others.map(g => menuItem(g.name, () => tabs.forEach(t => setTabGroup(t, g.id)))),
        ...(others.length ? [document.createXULElement("menuseparator")] : []),
        menuItem("New group…", () => {
          const id = newGroup(space);
          if (id) {
            tabs.forEach(t => setTabGroup(t, id));
          }
        })
      );
    }

    tabMenu.addEventListener("popupshowing", e => {
      if (e.target !== tabMenu) {
        return;
      }
      const tab = TabContextMenu.contextTab;
      const usable = tab && !tab.pinned && modEnabled;
      // Custom groups are always offered: the menu is the only way in.
      fillGroupItems(usable ? tab : null);
      // Switched off in the options: none of the site items, settings
      // included (the header menu and Sine's gear button still open it).
      const showItems = Services.prefs.getBoolPref(PREF_TAB_MENU, true);
      const host = usable && showItems ? tabHost(tab) : null;
      contextHost = host;
      siteItems.forEach(el => (el.hidden = !host));
      sep.hidden = !host && groupMenu.hidden;
      if (!host) {
        return;
      }
      const site = siteForHost(host);
      const sections = getSections();
      const si = sectionIndexForHost(host, sections);
      ownItem.hidden = collectionMenu.hidden = si >= 0;
      removeItem.hidden = si < 0;
      if (si >= 0) {
        // Next to "Remove from “olai”", say it's the site that goes.
        const name = displayName(sections[si]);
        removeItem.setAttribute("label", currentGroup ? `Remove ${site} from “${name}”` : `Remove from “${name}”`);
        return;
      }
      ownItem.setAttribute("label", `Give ${site} its own section`);
      collectionMenu.setAttribute("label", `Add ${site} to a collection`);
      collectionPopup.replaceChildren(
        ...sections
          .map((s, i) => [s, i])
          .filter(([s]) => s.kind === "collection")
          .map(([s, i]) => menuItem(displayName(s), () => addSiteToCollection(host, i)))
      );
      collectionMenu.hidden = !collectionPopup.children.length;
    });

    // Header context menu: reorder / rename / remove.
    const popup = document.createXULElement("menupopup");
    popup.id = "zsg-header-menu";
    const triggerHeader = () => popup.triggerNode?.closest(".zsg-header");
    const closeAllItem = menuItem("Close all tabs in this section", () => {
      const header = triggerHeader();
      if (header) {
        closeGroup(header);
      }
    });
    const unloadAllItem = menuItem("Unload all tabs in this section", () => {
      const header = triggerHeader();
      if (header) {
        unloadGroup(header);
      }
    });
    const edit = fn => () => {
      const label = triggerHeader()?.getAttribute("data-label");
      const sections = getSections();
      const i = sections.findIndex(s => displayName(s) === label);
      if (i >= 0 && fn(sections, i) !== false) {
        setSections(sections);
      }
    };
    // The custom group a header belongs to (by id), or null for a section.
    const customIdOf = header => {
      const key = header?.getAttribute("data-key") ?? "";
      return key.startsWith("custom:") ? key.slice("custom:".length) : null;
    };
    const editGroup = fn => () => {
      const id = customIdOf(triggerHeader());
      const groups = getCustomGroups();
      const i = groups.findIndex(g => g.id === id);
      if (i >= 0 && fn(groups, i) !== false) {
        setCustomGroups(groups);
      }
    };
    // One menu item for both kinds of header.
    const either = (forSection, forGroup) => () => (customIdOf(triggerHeader()) ? forGroup : forSection)();
    // The space whose list the header is in.
    const headerSpace = () => triggerHeader()?.parentElement?.getAttribute("zen-workspace-id") ?? null;
    // Groups move past the groups shown in the same space (step: -1 or 1).
    const moveGroup = step =>
      editGroup((g, i) => {
        const space = headerSpace();
        let j = i + step;
        while (g[j] && !inSpace(asSection(g[j]), space)) {
          j += step;
        }
        if (!g[j]) {
          return false;
        }
        [g[i], g[j]] = [g[j], g[i]];
      });
    const colorMenu = document.createXULElement("menu");
    colorMenu.id = "zsg-header-color";
    colorMenu.setAttribute("label", "Color");
    const colorPopup = document.createXULElement("menupopup");
    colorMenu.append(colorPopup);
    for (const [name, hex] of GROUP_COLORS) {
      const item = menuItem(
        name,
        editGroup((g, i) => {
          g[i].color = hex;
        })
      );
      item.setAttribute("type", "radio");
      item.setAttribute("name", "zsg-group-color");
      item.setAttribute("value", hex);
      colorPopup.append(item);
    }
    // Lets go of the group's tabs (they're sorted as usual again); none close.
    const deleteItem = menuItem("Delete group", () => {
      const id = customIdOf(triggerHeader());
      if (!id) {
        return;
      }
      setCustomGroups(getCustomGroups().filter(g => g.id !== id));
      const set = getCollapsed();
      if (set.delete(`custom:${id}`)) {
        setCollapsed(set);
      }
      // Tabs in other windows let go on their next layout: their group is gone.
      gBrowser.tabs.filter(t => tabGroupId(t) === id).forEach(clearTabGroup);
    });
    deleteItem.id = "zsg-header-delete";
    const removeSectionItem = menuItem("Remove section", edit((s, i) => s.splice(i, 1)));
    const moveUpItem = menuItem("Move section up", either(edit((s, i) => i > 0 && ([s[i - 1], s[i]] = [s[i], s[i - 1]])), moveGroup(-1)));
    const moveDownItem = menuItem(
      "Move section down",
      either(edit((s, i) => i < s.length - 1 && ([s[i + 1], s[i]] = [s[i], s[i + 1]])), moveGroup(1))
    );
    const spacesSep = document.createXULElement("menuseparator");
    const onlyHereItem = menuItem(
      "Only in this space",
      edit((s, i) => {
        const space = headerSpace();
        if (!space) {
          return false;
        }
        s[i].spaces = [space];
      })
    );
    const everywhereItem = menuItem(
      "Show in all spaces",
      edit((s, i) => {
        s[i].spaces = [];
      })
    );
    popup.addEventListener("popupshowing", e => {
      if (e.target !== popup) {
        return;
      }
      const header = triggerHeader();
      closeAllItem.disabled = !!header?.hasAttribute("zsg-empty");
      unloadAllItem.disabled = !!header?.hasAttribute("zsg-none-loaded");
      const groupId = customIdOf(header);
      const kind = groupId ? "group" : "section";
      moveUpItem.setAttribute("label", `Move ${kind} up`);
      moveDownItem.setAttribute("label", `Move ${kind} down`);
      closeAllItem.setAttribute("label", `Close all tabs in this ${kind}`);
      unloadAllItem.setAttribute("label", `Unload all tabs in this ${kind}`);
      removeSectionItem.hidden = !!groupId;
      colorMenu.hidden = deleteItem.hidden = !groupId;
      if (groupId) {
        // A group always belongs to its own space.
        onlyHereItem.hidden = everywhereItem.hidden = spacesSep.hidden = true;
        const color = getCustomGroups().find(g => g.id === groupId)?.color;
        for (const item of colorPopup.children) {
          if (item.getAttribute("value") === color) {
            item.setAttribute("checked", "true");
          } else {
            item.removeAttribute("checked");
          }
        }
        return;
      }
      const section = getSections().find(s => displayName(s) === header?.getAttribute("data-label"));
      const space = headerSpace();
      // With one space (or spaces off) there's nothing to choose.
      const several = getSpaces().length > 1;
      onlyHereItem.hidden = !several || !space || (section?.spaces.length === 1 && section.spaces[0] === space);
      everywhereItem.hidden = !section?.spaces.length;
      spacesSep.hidden = onlyHereItem.hidden && everywhereItem.hidden;
    });
    popup.append(
      moveUpItem,
      moveDownItem,
      menuItem(
        "Rename…",
        either(
          // Like a group's: the name first, then the list read and written,
          // finding the section again by its old name (sections have no id).
          () => {
            const old = triggerHeader()?.getAttribute("data-label");
            const name = getSections().some(s => displayName(s) === old) && promptText("Rename section", "New name:", old);
            if (!name) {
              return;
            }
            const sections = getSections();
            const section = sections.find(s => displayName(s) === old);
            if (!section) {
              return;
            }
            section.name = name;
            setSections(sections);
            const set = getCollapsed();
            if (set.delete(old)) {
              set.add(name);
              setCollapsed(set);
            }
          },
          // Folded state is kept by id, so it survives a rename as is. The
          // name is asked first and the list read after: the prompt only
          // blocks this window, and another may change the groups meanwhile.
          () => {
            const id = customIdOf(triggerHeader());
            const old = getCustomGroups().find(g => g.id === id);
            const name = old && askGroupName("Rename group", "New name:", old.name, headerSpace(), id);
            if (!name) {
              return;
            }
            const groups = getCustomGroups();
            const group = groups.find(g => g.id === id);
            if (group) {
              group.name = name;
              setCustomGroups(groups);
            }
          }
        )
      ),
      colorMenu,
      removeSectionItem,
      deleteItem,
      spacesSep,
      onlyHereItem,
      everywhereItem,
      document.createXULElement("menuseparator"),
      unloadAllItem,
      closeAllItem,
      document.createXULElement("menuseparator"),
      menuItem("Tab Groups settings…", openSettings)
    );
    document.getElementById("mainPopupSet").append(popup);
  }

  // The settings button on this mod's card (Settings > Zen Mods, or Sine
  // Mods) opens the full settings page instead of the basic options box.
  function hookModCard(browser) {
    let win;
    try {
      win = browser.contentWindow;
    } catch {
      return;
    }
    if (!win || win.__zsgHooked || !/^about:(preferences|settings)/.test(String(win.location?.href))) {
      return;
    }
    win.__zsgHooked = true;
    win.addEventListener(
      "click",
      e => {
        const zenButton = e.target.closest?.(".zenThemeMarketplaceItemConfigureButton");
        const sineButton = e.target.closest?.(".sineItemConfigureButton");
        const ours =
          zenButton
            ?.closest(".zenThemeMarketplaceItem")
            ?.querySelector(".zenThemeMarketplaceItemUninstallButton")
            ?.getAttribute("zen-mod-id") === MOD_ID ||
          sineButton?.closest(".sineItem")?.getAttribute("mod-id") === SINE_MOD_ID;
        if (ours) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openSettings();
        }
      },
      true
    );
  }

  // Zen's Clear (close unpinned tabs) keeps custom groups' tabs, like it keeps
  // a folder's. It works out what to close itself, then closes it all with
  // one gBrowser.removeTabs call before returning, so that call is filtered
  // just while it runs. If Zen changes, Clear is left as Zen made it.
  // A middle- or Ctrl-click on + (or the new tab command) opens a blank tab
  // "related to" the selected one, so it gets that tab as its opener. It's
  // not a link from it, so while that command runs, new tabs join no group.
  // The tab is made before the command returns.
  let openingBlankTab = 0;
  function hookNewTabCommand() {
    const original = window.BrowserCommands?.openTab;
    if (typeof original !== "function") {
      console.error("[Zen Tab Groups] couldn't hook the new tab command");
      return;
    }
    BrowserCommands.openTab = function (...args) {
      openingBlankTab++;
      try {
        return original.apply(this, args);
      } finally {
        openingBlankTab--;
      }
    };
  }

  function hookZenClear() {
    const original = window.gZenWorkspaces?.closeAllUnpinnedTabs;
    if (typeof original !== "function") {
      console.error("[Zen Tab Groups] couldn't hook Zen's Clear button");
      return;
    }
    gZenWorkspaces.closeAllUnpinnedTabs = function (...args) {
      const removeTabs = gBrowser.removeTabs;
      const showToast = gZenUIManager.showToast;
      let closedAny = false;
      gBrowser.removeTabs = (tabs, options) => {
        const closing = tabs.filter(t => !inCustomGroup(t));
        closedAny ||= closing.length > 0;
        return removeTabs.call(gBrowser, closing, options);
      };
      // Zen then says it closed tabs; not when the groups kept them all.
      gZenUIManager.showToast = (id, ...rest) =>
        id === "zen-workspaces-close-all-unpinned-tabs-toast" && !closedAny
          ? undefined
          : showToast.call(gZenUIManager, id, ...rest);
      try {
        return original.apply(this, args);
      } finally {
        gBrowser.removeTabs = removeTabs;
        gZenUIManager.showToast = showToast;
      }
    };
  }

  /* ---------- wiring ---------- */

  function init() {
    migrateOldPrefs();
    windowUtils.loadSheetUsingURIString(
      "data:text/css;charset=utf-8," + encodeURIComponent(CSS),
      windowUtils.AUTHOR_SHEET
    );
    setupMenus();
    hookZenClear();
    hookNewTabCommand();
    setupDrag();

    // Used by the settings page.
    window.ZenSiteGroups = { getSections, setSections, defaultSections, normalizeSite, defaultName, displayName, iconColor, getSpaces };
    for (const pref of OLD_ICON_COLOR_PREFS) {
      if (Services.prefs.prefHasUserValue(pref)) {
        Services.prefs.clearUserPref(pref);
      }
    }

    const tabContainer = gBrowser.tabContainer;
    // A tab opened from a custom group's tab (a link, middle-click, "Open
    // Link in New Tab") joins that group. Ctrl+T and + leave no opener, and
    // Zen's glance previews are passing tabs, so they stay out.
    tabContainer.addEventListener("TabOpen", e => {
      const tab = e.target;
      const opener = tab.openerTab;
      if (!modEnabled || !opener || openingBlankTab || tab.pinned || tabGroupId(tab) || tab.hasAttribute("zen-glance-tab") || opener.hasAttribute("zen-glance-tab")) {
        return;
      }
      const id = tabGroupId(opener);
      if (id && getCustomGroups().some(g => g.id === id)) {
        setTabGroup(tab, id);
      }
    });
    // TabBrowserDiscarded / TabBrowserInserted: a tab unloaded or loaded
    // again, for the Unload button.
    for (const type of ["TabOpen", "TabClose", "TabMove", "TabPinned", "TabUnpinned", "TabSelect", "TabGrouped", "TabUngrouped", "TabBrowserDiscarded", "TabBrowserInserted"]) {
      tabContainer.addEventListener(type, schedule);
    }
    window.addEventListener("ZenWorkspacesUIUpdate", schedule);
    tabContainer.addEventListener("TabAttrModified", e => {
      if (unsureSites.size && e.detail?.changed?.includes("image")) {
        retryUnsureColors();
      }
    });

    const { STATE_START, STATE_STOP, STATE_IS_DOCUMENT } = Ci.nsIWebProgressListener;
    gBrowser.addTabsProgressListener({
      onStateChange(browser, webProgress, request, flags) {
        if (!webProgress?.isTopLevel || !(flags & STATE_IS_DOCUMENT)) {
          return;
        }
        if (flags & STATE_START) {
          let spec = null;
          try {
            spec = request.QueryInterface(Ci.nsIChannel).URI.spec;
          } catch {
            spec = request?.name ?? null;
          }
          if (spec && /^https?:/i.test(spec)) {
            pendingURL.set(browser, spec);
            schedule();
          }
        } else if (flags & STATE_STOP) {
          pendingURL.delete(browser);
          hookModCard(browser);
        }
      },
      onLocationChange(browser, webProgress) {
        if (webProgress?.isTopLevel) {
          pendingURL.delete(browser);
          schedule();
          hookModCard(browser);
        }
      },
    });

    // Any zen.sitegroups.* change (settings page, menus, collapsing, colors).
    const prefObserver = { observe: schedule };
    // Zen flips this pref whenever a mod is switched on/off in Settings.
    const modsObserver = { observe: () => refreshModEnabled().then(schedule) };
    const modPrefs = ["zen.mods.updated-value-observer", "zen.themes.disable-all"];
    Services.prefs.addObserver(PREF_BRANCH, prefObserver);
    modPrefs.forEach(p => Services.prefs.addObserver(p, modsObserver));
    window.addEventListener("unload", () => {
      Services.prefs.removeObserver(PREF_BRANCH, prefObserver);
      modPrefs.forEach(p => Services.prefs.removeObserver(p, modsObserver));
    });

    // Settings may already be open (e.g. restored from the last session).
    gBrowser.browsers.forEach(hookModCard);

    refreshModEnabled().then(schedule);
  }

  function whenReady(fn) {
    // Some windows (e.g. with spaces disabled) may never report "initialized".
    const go = () =>
      Promise.race([
        window.gZenWorkspaces?.promiseInitialized ?? Promise.resolve(),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]).then(fn);
    if (gBrowserInit.delayedStartupFinished) {
      go();
      return;
    }
    const obs = subject => {
      if (subject === window) {
        Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
        go();
      }
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  }

  whenReady(init);
})();
