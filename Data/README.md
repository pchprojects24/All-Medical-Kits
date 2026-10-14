# Data

## Where the numbers come from

One input: **`Data/source/`**, a single workbook exported from the SharePoint
kit catalogue (`All med kits from Sharepoint.xlsx`). It is one flat sheet of
about 46,600 rows covering every kit in the catalogue, and it is the source of
truth for every item: NSN, description, unit of measure, quantity and price.

Every other file in this directory is generated from it by
`tools/build_inventory.py` and should never be hand-edited.

### How the export is laid out

Every kit in the catalogue is a *Kit NSN* with rows of its own, and the export
lists each kit's contents more than once:

- rows with **Sub-Kit NSN blank** are the kit's *direct* contents;
- rows with **Sub-Kit NSN filled in** repeat a sub-kit's contents again from the
  point of view of every kit above it.

Only the direct rows become kit lines. The others are read for the hierarchy and
for how many copies of each sub-kit a kit holds. This is why the export has
46,600 rows but there are 15,545 kit lines.

### What is read from the export

| Export column | Used for |
| --- | --- |
| Kit NSN / Kit Name | The kit the row belongs to |
| Item NSN | Item NSN |
| Item Name | Description |
| UOM | Unit of measure |
| Total Qty | Quantity in the kit (direct rows) |
| Total Value | Price: unit price = Total Value ÷ Total Qty |
| Item Type | Item type (filter and column in the app) |
| # Sub-Kits Req | How many copies of a sub-kit the kit holds |
| Sub-Kit NSN / Full Sub-Kit Path | The hierarchy |
| Controlled? / SG? / Storage / On SOA? | Item flags |
| O&PEN Keywords | Extra search terms (brand names, part numbers) |

The other columns (Qty per Sub-Kit, Sub-Kit Name, Listed in # Kits, Internal
Catalogue Data, Specific Sort Order) are ignored.

### Kit structure

Parent/child links come from each row's *Full Sub-Kit Path*
(`A ➡️ B | NAME OF B ➡️ C` means C is in B, which is in A). The kits form a
hierarchy up to six levels deep, with 110 top-level kits and sets.

It is a graph, not a tree: 58 kits sit inside more than one parent (the same
medic bag in several ship sets, for example). A kit's `parent_nsns` lists all of
them, and the app shows the kit under each.

The export leaves kit definitions out, so it never lists a sub-kit as an item of
its parent. The build adds one container line per parent and child, with unit
of measure `KT`, quantity = copies of the child in one parent, and price = the
child's total value.

**Prices.** The unit price is pooled per item (sum of Total Value ÷ sum of Total
Qty over every row) so cent-level rounding can't make one item look differently
priced in two kits. A kit's `total_value` is the sum of its own lines, with
each sub-kit priced at the value of its contents. For 379 of the 384 kits this
matches the export's own Total Value sum to within rounding. The other five
differ because the export prices an item differently in different kits and the
pooled price evens that out (the BioFire validation kit is the largest gap, at
about $900).

## Generated files

| File | One row per | Use it for |
| --- | --- | --- |
| `kit_items.csv` | kit + item (15,545) | The full picture. Per-kit quantities are preserved here. |
| `master_inventory.csv` | distinct item (4,365) | "How much of this is there in total, and which kits hold it?" |
| `kits/<slug>.csv` | item within one kit | A single kit with every column. (The app's own kit download is built in the browser with five columns; see the main README.) |
| `inventory.json` | (n/a) | What the browser app loads. |

`kit_items.csv` is the canonical table: an item that appears in three kits
appears as three rows, each with that kit's own quantity. If you are counting
anything, count it here.

**Counting stock or money means leaving out `Is Kit = Y` (or `Is Sub-Kit = Y`)
rows.** They are kit containers, and a container's price already equals the sum
of its contents, so counting it as well double-counts.

## Known quirks in the source data

These are handled as described rather than silently corrected. Fix them at the
source if they are wrong, then re-run the build, which prints each one.

- **35 items are listed twice in the same kit** (for example the Pelican transport
  case in each MAJAID kit, once at qty 1 and once at qty 2). They become one line
  with the quantities added.
- **Two sub-kits have conflicting "# Sub-Kits Req"**: `6545-20-001-1537` in the
  field laboratory kit (1 on 73 rows, 2 on one) and `6545-20-A0Q-5514` in the
  DART main body set (1 on 132 rows, 3 on one). The most common value is used.
- **Some items have no NSN**: references and forms carry a name or a URL in the
  Item NSN column instead. They are kept; `is_nsn` is `false` for them.
- **Some items have no unit of measure or a $0 value** in the export, and show
  that way.

## Scope: a reference catalogue, not a tracking system

This answers "what is in each medical kit, and what are the stock numbers": the
authorised contents of each kit, with NSNs, descriptions, units of measure,
quantities and prices. Quantities are *required* holdings (what a kit is
supposed to contain), not counted ones. There is no quantity on hand, expiry
date or stowage location.

## Rebuilding

    pip install openpyxl
    python3 tools/build_inventory.py

Expected output:

    kits: 384 (110 top-level)  items: 4365  lines: 15545

followed by notes on the quirks above.
