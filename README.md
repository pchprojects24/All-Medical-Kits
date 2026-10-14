# All Medical Kits

A searchable browser for every kit in the SharePoint medical kit catalogue and
the items in them: what is held, which kit it belongs to, and its NATO stock
number. It is the same app as the Sickbay Master Inventory, built for the whole
catalogue instead of one sickbay set. No build step, no server-side anything, no
dependencies.

It is a reference catalogue, not a tracking system: there is no on-hand count,
expiry date or stowage location here, by design.

Serve the folder over HTTP (`python3 -m http.server` from the repository root, or
any static host such as GitHub Pages) and open `index.html`. It reads
`Data/inventory.json` with `fetch`, which browsers block for `file://` URLs, so
opening the file directly from disk will not load the data.

## The two ways in

**Items**: every distinct item (4,365) in one searchable list. Search matches
NSN, description, unit of measure, item type, storage, the O&PEN keywords from
SharePoint, and the names of the kits an item sits in, so "tourniquet",
"6515-01-649", "narcan" and "dive team" all work. Filter to a single kit or to an
item type (with *Controlled drugs* and *SG products* at the top of that list),
sort by NSN / description / quantity / price, or flip on *Group by Kit* to see
everything broken out kit by kit (groups start closed; open the ones you want).
Tapping the kit count on an item shows every kit that holds it, with that kit's
own quantity. Controlled drugs, SG products and refrigerated or frozen items are
badged.

The list shows 200 items at a time and loads more as you scroll, so it stays
quick on a phone.

**Kits**: all 384 kits as the hierarchy they form. The 110 top-level kits and
sets are listed first; the arrow beside a kit shows its sub-kits. A kit that sits
in more than one set (the same medic bag in several ship sets, for example)
appears under each of them. Open a kit to get its contents, line count, total
value, links to the sets it belongs to, and a download of its contents as CSV,
Excel or PDF. Searching in this view matches a kit by its name *or* by anything
inside it, so "naloxone" narrows the tree to the kits that carry it and opens
the branches that lead to them.

Each kit has its own URL (`#kit/6545-20-A0U-8722`), so a specific kit can be
bookmarked or passed to someone else.

## Pick lists

*Add* on any item puts it on a pick list, pre-filled with the quantity shown in
whatever kit you were looking at. *Add all to pick list* takes a whole kit at
once. Quantities are editable, a running total is shown, and the list survives
closing the tab. Export it as CSV, Excel or PDF, or print it.

## Exports

Kit downloads and pick-list exports share the same five columns: **NSN,
Description, Quantity, Unit of Measure, Kit Membership**. Quantity is the kit's
quantity (or the edited pick-list quantity); Kit Membership is the kit the line
came from, or every kit holding the item if it was added from the Items list.

- **CSV** opens in anything, Excel included.
- **Excel** is a real `.xlsx` workbook: bold header row frozen at the top,
  filters on, quantities as numbers, set to print landscape with the header on
  every page.
- **PDF** is a ruled table on US Letter landscape, with the header repeated on
  every page and page numbers in the footer.

All three are built in the browser by `assets/export.js`, with no libraries, so
they work offline. A kit download covers the whole kit, whatever the search box
holds.

## Repository layout

```
index.html                  the app
assets/                     app.js, export.js (CSV/Excel/PDF), style.css, icons
Data/source/*.xlsx          the SharePoint export of all medical kits
Data/kit_items.csv          every kit-item line (15,545)
Data/master_inventory.csv   one row per distinct item (4,365)
Data/kits/*.csv             one full-detail CSV per kit (384)
Data/inventory.json         what the app loads
tools/build_inventory.py    regenerates everything under Data/ from the export
tools/stamp_assets.py       versions the assets/ links in index.html (see below)
```

`Data/README.md` is the data dictionary: what each column means, how the
SharePoint export is turned into kit lines, how the kit hierarchy is derived, and
the quirks in the source data.

Counting stock from `Data/master_inventory.csv` means leaving out rows where
`Is Kit` is `Y`: kit rows are containers whose price already includes their
contents.

## Changing the data

Replace the export in `Data/source/` with a newer one from SharePoint (keep it the
only workbook in that folder), then:

```sh
pip install openpyxl
python3 tools/build_inventory.py
```

Everything else under `Data/` is generated. Don't hand-edit it, or the next
rebuild will overwrite the changes.

## Changing the app

After editing anything in `assets/`, run:

```sh
python3 tools/stamp_assets.py
```

It tags each `assets/` link in `index.html` with a fingerprint of the file
(`assets/app.js?v=809212393c`), so a browser never runs a cached old `app.js`
under a new page. `build_inventory.py` runs it too, and
`python3 tools/stamp_assets.py --check` fails if the tags are out of date.
