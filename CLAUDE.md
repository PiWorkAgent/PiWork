# PiWork — working notes

## UI: native panes are stacked above the renderer

A window holds three layers: the renderer's DOM (sidebar, chat, title bar), and
the right column's **native `WebContentsView` panes** (plugin pages plus the
browser engine embedded in them) on top of it. `z-index`, portals and `fixed`
only order things *within* the renderer; nothing in the DOM can paint over a
native pane.

Consequences, and the rules that follow:

- **Floating layers stay inside their own column.** A menu, popover or tooltip
  that opens over the chat or sidebar is safe; one whose rect crosses into the
  right column is painted *under* the pane. Anchor it to its trigger and check
  the direction it opens in.
- **Title-bar tooltips open sideways** (`side="left"`), never downward: the
  toggle cluster sits at the window's right edge, and a downward tooltip lands
  on the right column's pane when that column is open.
- **Full-window modals hide the panes first.** Settings is the only flow that
  legitimately covers the window; it hides every pane for its lifetime
  (`ui-store.settingsOpen` → each `LiveSlot` reports 0×0). A centred dialog
  over a live pane is covered by it.
- **If a layer must overlap a pane, freeze it before showing** — snapshot the
  pane, hide the real view, show the bitmap (`freezeSlots` in
  `overlay-freeze-store`). Freezing *after* the layer is on screen flashes:
  the pane is exposed for as long as the capture takes. The panel tab strip
  does this for its menus.
- **Verify against the real screen.** A renderer screenshot does not include
  native panes, so a covered layer looks fine in the image. Compare rects
  (`[data-live-slot]` vs the layer) or look at the actual window.
