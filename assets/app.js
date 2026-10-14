(function () {
  "use strict";

  /* ── State ── */
  var kits = [];            // every kit, ordered as generated
  var items = [];           // one record per distinct item NSN
  var kitByNsn = {};
  var itemByNsn = {};
  var childKits = {};       // parent NSN -> [kit, …]
  var kitContents = {};     // kit NSN -> [item, …] (its own lines)
  var rootKits = [];

  var view = "items";       // "items" | "kits"
  var openKit = "";         // NSN of the kit being drilled into, "" for the tree
  var filteredItems = [];
  var sortKey = "nsn";
  var sortAsc = true;
  var searchTerm = "";
  var kitFilter = "";
  var typeFilter = "";      // "" all | "flag:controlled" | "flag:sg" | an Item Type
  var groupByKit = false;
  var openGroups = {};      // grouped view: kits expanded (all start collapsed)
  var openTreeKits = {};    // kit tree: kits whose sub-kits are showing
  var expandedItems = {};
  /* Thousands of rows at once make phones stall, so lists render a page at a
     time and grow as the reader scrolls. */
  var PAGE_SIZE = 200;
  var renderLimit = PAGE_SIZE;
  var moreObserver = null;
  /* Below this the nine-column table cannot fit, so the card layout is used.
     Must stay in step with the same query in style.css. */
  var TABLE_BREAKPOINT = "(min-width: 920px)";
  var isDesktop = window.matchMedia(TABLE_BREAKPOINT).matches;
  var selected = [];        // [{nsn, qty}]
  var STORAGE_KEY = "medkits.picklist.v1";

  /* ── DOM refs ── */
  var searchInput = document.getElementById("search");
  var searchClearBtn = document.getElementById("search-clear");
  var kitSelect = document.getElementById("kit-filter");
  var typeSelect = document.getElementById("type-filter");
  var sortSelect = document.getElementById("sort-select");
  var itemControls = document.getElementById("item-controls");
  var statusBar = document.getElementById("status-bar");
  var listEl = document.getElementById("item-list");
  var groupBtn = document.getElementById("group-btn");
  var tabItems = document.getElementById("tab-items");
  var tabKits = document.getElementById("tab-kits");
  var selectedBtn = document.getElementById("selected-btn");
  var selOverlay = document.getElementById("sel-overlay");
  var selDrawer = document.getElementById("sel-drawer");
  var selTitle = document.getElementById("sel-title");
  var selList = document.getElementById("sel-list");
  var selClose = document.getElementById("sel-close");
  var selExport = document.getElementById("sel-export");
  var selPrint = document.getElementById("sel-print");
  var selClear = document.getElementById("sel-clear");

  /* ── Helpers ── */
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function num(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return String(Math.round(Number(n) * 10000) / 10000);
  }

  function compareText(a, b) {
    return String(a || "").localeCompare(String(b || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function compareKits(a, b) {
    return compareText(a.name, b.name);
  }

  function kitName(nsn) {
    return kitByNsn[nsn] ? kitByNsn[nsn].name : nsn;
  }

  function plural(n, word) {
    return n + " " + word + (n !== 1 ? "s" : "");
  }

  /* Controlled drug / special-grade flags, shown beside the NSN. */
  function flagBadges(item) {
    var html = "";
    if (item.is_kit) html += ' <span class="badge badge-kit">Kit</span>';
    if (item.controlled) {
      html += ' <span class="badge badge-controlled" title="Controlled drug">Controlled</span>';
    }
    if (item.sg) html += ' <span class="badge badge-sg" title="SG product">SG</span>';
    if (/refrigerat|frozen/i.test(item.storage || "")) {
      html += ' <span class="badge badge-cold" title="' + escapeHtml(item.storage) +
        '">' + (/frozen/i.test(item.storage) ? "Frozen" : "Fridge") + "</span>";
    }
    return html;
  }

  /* ── Load ── */
  function loadData() {
    listEl.innerHTML = '<div class="loading">Loading inventory…</div>';

    // Revalidate on every load (cheap: the server answers 304 when unchanged), so a
    // rebuilt inventory is never shadowed by a cached copy.
    fetch("Data/inventory.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        kits = data.kits || [];
        items = data.items || [];

        kits.forEach(function (kit) {
          kitByNsn[kit.nsn] = kit;
          kitContents[kit.nsn] = [];
        });
        kits.forEach(function (kit) {
          // A kit can sit in several parents; it appears under each of them.
          kit.parents = (kit.parent_nsns || []).filter(function (p) { return kitByNsn[p]; });
          kit.parents.forEach(function (p) {
            (childKits[p] = childKits[p] || []).push(kit);
          });
          if (!kit.parents.length) rootKits.push(kit);
        });

        items.forEach(function (item) {
          itemByNsn[item.nsn] = item;
          item.kitNsns = item.memberships.map(function (m) { return m.kit_nsn; });
          item.kitNames = item.kitNsns.map(kitName);
          item.kitNsns.forEach(function (k) {
            if (kitContents[k]) kitContents[k].push(item);
          });
          item.searchText = [
            item.nsn, item.description, item.uom, item.item_type, item.storage,
            item.keywords, item.kitNames.join(" "), item.kitNsns.join(" "),
            item.controlled ? "controlled" : "",
          ].join(" ").toLowerCase();
        });

        restoreSelection();
        buildKitSelect();
        buildTypeSelect();
        updateSelectedCount();
        applyRoute();
      })
      .catch(function (err) {
        listEl.innerHTML =
          '<div class="loading">Error loading data: ' + escapeHtml(err.message) + "</div>";
        statusBar.textContent = "Failed to load";
      });
  }

  function buildKitSelect() {
    var html = '<option value="">All Kits</option>';
    kits.slice().sort(compareKits)
      .forEach(function (kit) {
        html += '<option value="' + escapeHtml(kit.nsn) + '">' +
          escapeHtml(kit.name) + "</option>";
      });
    kitSelect.innerHTML = html;
    kitSelect.value = kitFilter;
  }

  function buildTypeSelect() {
    var counts = {};
    var controlled = 0;
    var sg = 0;
    items.forEach(function (it) {
      if (it.item_type) counts[it.item_type] = (counts[it.item_type] || 0) + 1;
      if (it.controlled) controlled++;
      if (it.sg) sg++;
    });
    var html = '<option value="">All Types</option>';
    if (controlled) html += '<option value="flag:controlled">Controlled drugs (' + controlled + ")</option>";
    if (sg) html += '<option value="flag:sg">SG products (' + sg + ")</option>";
    Object.keys(counts).sort(compareText).forEach(function (type) {
      html += '<option value="' + escapeHtml(type) + '">' + escapeHtml(type) +
        " (" + counts[type] + ")</option>";
    });
    typeSelect.innerHTML = html;
    typeSelect.value = typeFilter;
  }

  /* ── Routing (so a kit can be linked and the back button works) ── */
  function applyRoute() {
    var hash = window.location.hash.replace(/^#\/?/, "");
    var nsn = "";
    if (hash.indexOf("kit/") === 0) {
      var raw = hash.slice(4);
      try {
        nsn = decodeURIComponent(raw).toUpperCase();
      } catch (e) {
        nsn = raw.toUpperCase();  // hand-edited link with a bad %-escape
      }
    }
    if (nsn && kitByNsn[nsn]) {
      view = "kits";
      openKit = nsn;
    } else if (hash === "kits" || nsn) {
      view = "kits";
      openKit = "";
    } else {
      view = "items";
      openKit = "";
    }
    syncTabs();
    renderLimit = PAGE_SIZE;
    render();
    window.scrollTo(0, 0);
  }

  function navigate(hash) {
    if (window.location.hash === hash) applyRoute();
    else window.location.hash = hash;
  }

  function syncTabs() {
    tabItems.classList.toggle("active", view === "items");
    tabKits.classList.toggle("active", view === "kits");
    tabItems.setAttribute("aria-selected", view === "items" ? "true" : "false");
    tabKits.setAttribute("aria-selected", view === "kits" ? "true" : "false");
    itemControls.classList.toggle("hidden", view !== "items");
    searchInput.placeholder = view === "items"
      ? "Search NSN, description, keyword, kit…"
      : "Search kits…";
    syncTopBarHeight();
  }

  /* ── Items view ── */
  function typeMatches(item) {
    if (!typeFilter) return true;
    if (typeFilter === "flag:controlled") return !!item.controlled;
    if (typeFilter === "flag:sg") return !!item.sg;
    return item.item_type === typeFilter;
  }

  function applyFilters() {
    var term = searchTerm.toLowerCase();
    filteredItems = items.filter(function (item) {
      if (term && item.searchText.indexOf(term) === -1) return false;
      if (kitFilter && item.kitNsns.indexOf(kitFilter) === -1) return false;
      if (!typeMatches(item)) return false;
      return true;
    });
    sortList(filteredItems);
  }

  function sortList(list, kitNsn) {
    list.sort(function (a, b) {
      var cmp;
      if (sortKey === "qty") cmp = qtyFor(a, kitNsn) - qtyFor(b, kitNsn);
      else if (sortKey === "price") cmp = (a.price || 0) - (b.price || 0);
      else if (sortKey === "nsn") cmp = compareText(a.nsn, b.nsn);
      else cmp = compareText(a.description, b.description);
      if (cmp < 0) return sortAsc ? -1 : 1;
      if (cmp > 0) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }

  /* The line for this item in a given kit, or null outside a kit context. */
  function membershipIn(item, kitNsn) {
    if (!item || !kitNsn) return null;
    for (var i = 0; i < item.memberships.length; i++) {
      if (item.memberships[i].kit_nsn === kitNsn) return item.memberships[i];
    }
    return null;
  }

  /* Unit price for this item as that kit prices it, else the rollup price. */
  function priceFor(item, kitNsn) {
    var m = membershipIn(item, kitNsn);
    return m && m.price !== null && m.price !== undefined ? m.price : item.price;
  }

  /* Quantity in the kit being filtered on, else the total across all kits. */
  function qtyFor(item, kitNsn) {
    var target = kitNsn || kitFilter;
    if (target) {
      var m = membershipIn(item, target);
      return m ? m.qty || 0 : 0;
    }
    return item.total_qty || 0;
  }

  function render() {
    if (view === "kits") return openKit ? renderKitDetail() : renderKitTree();
    applyFilters();
    renderItems();
  }

  function renderItems() {
    var msg = "Showing " + filteredItems.length + " of " + items.length + " items";
    var isFiltering = searchTerm || kitFilter || typeFilter;
    statusBar.classList.toggle("filtering", !!isFiltering);
    if (isFiltering) msg += " — filtered";
    if (groupByKit) msg += " — grouped by kit";
    statusBar.textContent = msg;

    if (filteredItems.length === 0) return renderNoResults();
    if (groupByKit) return renderGrouped();
    var page = filteredItems.slice(0, renderLimit);
    listEl.innerHTML = (isDesktop ? itemTable(page) : itemCards(page)) +
      moreButton(filteredItems.length - page.length);
    watchMore();
  }

  /* "Show more", which also fires by itself once it scrolls into view. */
  function moreButton(remaining) {
    if (remaining <= 0) return "";
    return '<button class="show-more" id="show-more">Show ' +
      Math.min(remaining, PAGE_SIZE) + " more (" + remaining + " not shown)</button>";
  }

  function showMore() {
    var y = window.scrollY;
    renderLimit += PAGE_SIZE;
    render();
    window.scrollTo(0, y);
  }

  function watchMore() {
    if (moreObserver) moreObserver.disconnect();
    var btn = document.getElementById("show-more");
    if (!btn || !window.IntersectionObserver) return;
    moreObserver = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        moreObserver.disconnect();
        showMore();
      }
    }, { rootMargin: "600px 0px" });
    moreObserver.observe(btn);
  }

  function renderNoResults() {
    var html = '<div class="no-results"><p>No items match';
    if (searchTerm) html += ' search "' + escapeHtml(searchTerm) + '"';
    if (kitFilter) html += ' in kit "' + escapeHtml(kitName(kitFilter)) + '"';
    if (typeFilter) {
      html += " of type \"" + escapeHtml(typeSelect.options[typeSelect.selectedIndex].text) + '"';
    }
    html += '.</p><button id="reset-btn">Reset Filters</button></div>';
    listEl.innerHTML = html;
    document.getElementById("reset-btn").addEventListener("click", resetFilters);
  }

  function addBtn(item, kitNsn) {
    var on = isSelected(item.nsn);
    return '<button class="sel-add-btn' + (on ? " added" : "") +
      '" data-nsn="' + escapeHtml(item.nsn) +
      '" data-qty="' + escapeHtml(qtyFor(item, kitNsn)) +
      '" data-kit="' + escapeHtml(kitNsn || "") + '">' +
      (on ? "Added ✓" : "Add") + "</button>";
  }

  function itemCards(list, kitNsn) {
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var open = !!expandedItems[it.nsn];
      html += '<div class="card' + (it.is_kit ? " card-kit" : "") + '">';
      html += '<div class="card-top"><div class="card-top-left">';
      html += '<div class="nsn">' + escapeHtml(it.nsn) + "</div>" + flagBadges(it);
      html += "</div>" + addBtn(it, kitNsn) + "</div>";
      html += '<div class="desc">' + escapeHtml(it.description || "—") + "</div>";
      html += '<div class="meta">';
      html += '<span><span class="label">Qty:</span> ' + num(qtyFor(it, kitNsn)) + "</span>";
      html += '<span><span class="label">UoM:</span> ' + escapeHtml(it.uom || "—") + "</span>";
      html += '<span><span class="label">Unit:</span> ' + money(priceFor(it, kitNsn)) + "</span>";
      html += '<span><span class="label">Type:</span> ' + escapeHtml(it.item_type || "—") + "</span>";
      html += "</div>";
      if (kitNsn && it.is_kit && kitByNsn[it.nsn]) {
        html += '<a class="detail-toggle" href="#kit/' + encodeURIComponent(it.nsn) +
          '">Open kit</a>';
      } else if (!kitNsn) {
        html += '<button class="detail-toggle" data-nsn="' + escapeHtml(it.nsn) +
          '" aria-expanded="' + open + '">' +
          (open ? "Hide" : "In " + plural(it.kit_count, "kit")) + "</button>";
        if (open) html += membershipTable(it);
      }
      html += "</div>";
    }
    return html;
  }

  function itemTable(list, kitNsn) {
    var html = '<table class="inv-table"><thead><tr>';
    html += "<th></th><th>NSN</th><th>Description</th><th>Qty</th><th>UoM</th>" +
      "<th>Unit Price</th><th>Type</th><th>Storage</th><th>" +
      (kitNsn ? "Ext. Price" : "Kits") + "</th></tr></thead><tbody>";
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var open = !!expandedItems[it.nsn];
      html += '<tr class="' + (it.is_kit ? "row-kit" : "") + '">';
      html += '<td class="sel-cell">' + addBtn(it, kitNsn) + "</td>";
      html += "<td>" + (it.is_kit && kitByNsn[it.nsn]
        ? '<a href="#kit/' + encodeURIComponent(it.nsn) + '">' + escapeHtml(it.nsn) + "</a>"
        : escapeHtml(it.nsn)) + flagBadges(it) + "</td>";
      html += "<td>" + escapeHtml(it.description || "—") + "</td>";
      html += '<td class="num">' + num(qtyFor(it, kitNsn)) + "</td>";
      html += "<td>" + escapeHtml(it.uom || "—") + "</td>";
      html += '<td class="num">' + money(priceFor(it, kitNsn)) +
        (it.price_varies && !kitNsn ? ' <span class="badge badge-warn" title="Priced differently in different kits">varies</span>' : "") + "</td>";
      html += "<td>" + escapeHtml(it.item_type || "—") + "</td>";
      html += "<td>" + escapeHtml(it.storage || "—") + "</td>";
      if (kitNsn) {
        var line = membershipIn(it, kitNsn);
        html += '<td class="num">' + money(line ? line.extended_price : null) + "</td>";
      } else {
        html += '<td><button class="detail-toggle" data-nsn="' + escapeHtml(it.nsn) +
          '" aria-expanded="' + open + '">' + it.kit_count + "</button></td>";
      }
      html += "</tr>";
      if (open && !kitNsn) {
        html += '<tr class="detail-row"><td></td><td colspan="8">' +
          membershipTable(it) + "</td></tr>";
      }
    }
    return html + "</tbody></table>";
  }

  function membershipTable(item) {
    var html = '<div class="memberships"><div class="memberships-title">Held in</div>';
    var list = item.memberships.slice().sort(function (a, b) {
      return compareText(kitName(a.kit_nsn), kitName(b.kit_nsn));
    });
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      html += '<a class="membership" href="#kit/' + encodeURIComponent(m.kit_nsn) + '">';
      html += '<span class="membership-name">' + escapeHtml(kitName(m.kit_nsn)) + "</span>";
      html += '<span class="membership-nsn">' + escapeHtml(m.kit_nsn) + "</span>";
      html += '<span class="membership-qty">' + num(m.qty) + " " +
        escapeHtml(item.uom || "") + " · " + money(m.extended_price) + "</span>";
      html += "</a>";
    }
    return html + "</div>";
  }

  /* With hundreds of kits, groups start collapsed: open the ones you want. A
     single kit (from the kit filter) opens by itself. */
  function renderGrouped() {
    var shown = kitFilter ? [kitByNsn[kitFilter]] : kits.slice().sort(compareKits);
    var inFiltered = {};
    filteredItems.forEach(function (it) { inFiltered[it.nsn] = true; });
    var html = "";
    var any = false;

    for (var k = 0; k < shown.length; k++) {
      var kit = shown[k];
      if (!kit) continue;
      var kitItems = kitContents[kit.nsn].filter(function (it) { return inFiltered[it.nsn]; });
      if (!kitItems.length) continue;
      any = true;

      var open = shown.length === 1 || !!openGroups[kit.nsn];
      html += '<div class="kit-group">';
      html += '<button class="kit-group-header" data-kit="' + escapeHtml(kit.nsn) +
        '" aria-expanded="' + open + '">';
      html += '<span class="kit-group-chevron">' + (open ? "&#9660;" : "&#9654;") + "</span>";
      html += '<span class="kit-group-name">' + escapeHtml(kit.name) + "</span>";
      html += '<span class="kit-group-count">' + plural(kitItems.length, "item") +
        "</span></button>";
      if (open) {
        sortList(kitItems, kit.nsn);
        html += '<div class="kit-group-body">' +
          (isDesktop ? itemTable(kitItems, kit.nsn) : itemCards(kitItems, kit.nsn)) +
          "</div>";
      }
      html += "</div>";
    }

    if (!any) return renderNoResults();
    listEl.innerHTML = html;
  }

  /* ── Kits view ── */
  function renderKitTree() {
    var term = searchTerm.toLowerCase();
    var matching = {};
    // A kit matches by its name or NSN, or by anything it contains.
    kits.forEach(function (kit) {
      if (!term || (kit.name + " " + kit.nsn).toLowerCase().indexOf(term) !== -1) {
        matching[kit.nsn] = true;
      }
    });
    if (term) {
      items.forEach(function (it) {
        if (it.searchText.indexOf(term) === -1) return;
        it.kitNsns.forEach(function (k) { matching[k] = true; });
      });
    }
    // Keep ancestors of a match visible (and open) so the tree stays navigable.
    var onPath = {};
    function markAncestors(kit, seen) {
      kit.parents.forEach(function (p) {
        if (seen[p]) return;
        seen[p] = true;
        onPath[p] = true;
        markAncestors(kitByNsn[p], seen);
      });
    }
    if (term) {
      kits.forEach(function (kit) {
        if (matching[kit.nsn]) markAncestors(kit, {});
      });
    }

    var visible = function (kit) { return matching[kit.nsn] || onPath[kit.nsn]; };
    var count = kits.filter(function (k) { return matching[k.nsn]; }).length;
    statusBar.classList.toggle("filtering", !!term);
    statusBar.textContent = term
      ? "Showing " + count + " of " + kits.length + " kits (filtered)"
      : plural(kits.length, "kit") + " (" + rootKits.length + " top-level) · " +
        items.length + " distinct items";

    if (!count) {
      listEl.innerHTML = '<div class="no-results"><p>No kits match "' +
        escapeHtml(searchTerm) + '".</p><button id="reset-btn">Reset Filters</button></div>';
      document.getElementById("reset-btn").addEventListener("click", resetFilters);
      return;
    }

    var html = '<div class="kit-tree">';
    function walk(list, depth, trail) {
      list.slice().sort(compareKits)
        .forEach(function (kit) {
          if (!visible(kit) || trail[kit.nsn]) return;
          var children = (childKits[kit.nsn] || []).filter(visible);
          // While searching, open every branch that leads to a match.
          var open = children.length && (term ? !!onPath[kit.nsn] : !!openTreeKits[kit.nsn]);
          html += '<div class="kit-node" style="padding-left:' + (depth * 18) + 'px">';
          if (children.length) {
            html += '<button class="kit-toggle" data-kit="' + escapeHtml(kit.nsn) +
              '" aria-expanded="' + !!open + '" aria-label="' +
              (open ? "Hide" : "Show") + " sub-kits of " + escapeHtml(kit.name) + '">' +
              (open ? "&#9660;" : "&#9654;") + "</button>";
          } else {
            html += '<span class="kit-toggle-spacer"></span>';
          }
          html += '<a class="kit-row" href="#kit/' + encodeURIComponent(kit.nsn) + '">';
          html += '<div class="kit-row-main">';
          html += '<div class="kit-row-name">' + escapeHtml(kit.name) + "</div>";
          html += '<div class="kit-row-nsn">' + escapeHtml(kit.nsn) +
            (children.length && !open ? " · " + plural(children.length, "sub-kit") : "") +
            "</div></div>";
          html += '<div class="kit-row-stats">';
          html += "<span>" + kit.line_count + " lines</span>";
          html += "<span>" + money(kit.total_value) + "</span>";
          html += "</div></a></div>";
          if (open) {
            var next = Object.create(trail);
            next[kit.nsn] = true;
            walk(children, depth + 1, next);
          }
        });
    }
    walk(rootKits, 0, {});
    listEl.innerHTML = html + "</div>";
  }

  function renderKitDetail() {
    var kit = kitByNsn[openKit];
    if (!kit) return navigate("#kits");

    var contents = kitContents[kit.nsn].slice();
    var term = searchTerm.toLowerCase();
    if (term) {
      contents = contents.filter(function (it) {
        return it.searchText.indexOf(term) !== -1;
      });
    }
    sortList(contents, kit.nsn);

    statusBar.classList.toggle("filtering", !!term);
    statusBar.textContent = kit.line_count + " lines · " + money(kit.total_value) +
      (term ? " · showing " + contents.length + " matching" : "");

    var html = '<div class="kit-detail">';
    html += '<a class="back-link" href="#kits">&#8592; All kits</a>';
    html += '<h1 class="kit-title">' + escapeHtml(kit.name) + "</h1>";
    html += '<div class="kit-sub">' + escapeHtml(kit.nsn) + "</div>";

    if (kit.parents.length) {
      html += '<div class="kit-parent">Component of ' + kit.parents.map(function (p) {
        return '<a href="#kit/' + encodeURIComponent(p) + '">' + escapeHtml(kitName(p)) + "</a>";
      }).join(", ") + "</div>";
    }

    html += '<div class="kit-stats">';
    html += '<div class="stat"><div class="stat-value">' + kit.line_count +
      '</div><div class="stat-label">Lines</div></div>';
    html += '<div class="stat"><div class="stat-value">' + money(kit.total_value) +
      '</div><div class="stat-label">Total value</div></div>';
    html += '<div class="stat"><div class="stat-value">' + kit.sub_kits.length +
      '</div><div class="stat-label">Sub-kits</div></div>';
    html += "</div>";

    html += '<div class="kit-actions">';
    html += '<button id="kit-add-all" class="sel-action-btn">Add all to pick list</button>';
    if (kit.line_count) {
      html += '<div class="export-group" id="kit-export" role="group" ' +
        'aria-label="Download this kit">' + exportButtons("Download") + "</div>";
    }
    html += "</div>";

    if (!contents.length) {
      html += '<div class="no-results"><p>' + (term
        ? 'Nothing in this kit matches "' + escapeHtml(searchTerm) +
          '".</p><button id="reset-btn">Clear search</button></div>'
        : "This kit has no items listed.</p></div>");
    } else {
      var page = contents.slice(0, renderLimit);
      html += (isDesktop ? itemTable(page, kit.nsn) : itemCards(page, kit.nsn)) +
        moreButton(contents.length - page.length);
    }
    listEl.innerHTML = html + "</div>";
    watchMore();

    var reset = document.getElementById("reset-btn");
    if (reset) reset.addEventListener("click", resetFilters);

    var kitExport = document.getElementById("kit-export");
    if (kitExport) {
      kitExport.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-export]");
        if (btn) exportKit(kit, btn.getAttribute("data-export"), btn);
      });
    }

    var addAll = document.getElementById("kit-add-all");
    if (addAll) {
      addAll.disabled = !contents.length;
      addAll.addEventListener("click", function () {
        contents.forEach(function (it) {
          if (!isSelected(it.nsn)) {
            selected.push({ nsn: it.nsn, qty: qtyFor(it, kit.nsn), kitNsn: kit.nsn });
          }
        });
        persistSelection();
        updateSelectedCount();
        render();
      });
    }
  }

  /* ── Pick list ── */
  function isSelected(nsn) {
    return selected.some(function (s) { return s.nsn === nsn; });
  }

  function toggleSelect(nsn, qty, kitNsn) {
    var idx = -1;
    for (var i = 0; i < selected.length; i++) {
      if (selected[i].nsn === nsn) { idx = i; break; }
    }
    if (idx >= 0) selected.splice(idx, 1);
    else if (itemByNsn[nsn]) {
      selected.push({ nsn: nsn, qty: qty, kitNsn: kitNsn || "" });
    }
    persistSelection();
    updateSelectedCount();
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function persistSelection() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch (e) { /* private mode or blocked storage — the list stays in memory */ }
  }

  function restoreSelection() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var saved = raw ? JSON.parse(raw) : [];
      if (Object.prototype.toString.call(saved) === "[object Array]") {
        selected = saved.filter(function (s) {
          return s && s.nsn && itemByNsn[s.nsn];
        });
      }
    } catch (e) { selected = []; }
  }

  function updateSelectedCount() {
    selectedBtn.textContent = "List (" + selected.length + ")";
    selTitle.textContent = "Pick list (" + selected.length + ")";
  }

  /* Estimated total, and how many lines could not be priced at all. */
  function drawerTotals() {
    var total = 0;
    var unpriced = 0;
    for (var i = 0; i < selected.length; i++) {
      var it = itemByNsn[selected[i].nsn];
      if (!it) continue;
      var unit = priceFor(it, selected[i].kitNsn);
      if (unit === null || unit === undefined) unpriced++;
      else total += (selected[i].qty || 0) * unit;
    }
    return { total: total, unpriced: unpriced };
  }

  function totalLabel() {
    var t = drawerTotals();
    return "Estimated total " + money(t.total) +
      (t.unpriced ? " (excludes " + t.unpriced + " unpriced item" +
        (t.unpriced !== 1 ? "s" : "") + ")" : "");
  }

  function updateDrawerTotal() {
    var el = selList.querySelector(".sel-total");
    if (el) el.textContent = totalLabel();
  }

  function renderDrawer() {
    updateSelectedCount();
    selExport.querySelectorAll("button").forEach(function (btn) {
      btn.disabled = !selected.length;
    });
    if (!selected.length) {
      selList.innerHTML = '<div class="sel-empty">Nothing on the pick list yet.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < selected.length; i++) {
      var it = itemByNsn[selected[i].nsn];
      if (!it) continue;
      var qty = selected[i].qty || 0;
      var unit = priceFor(it, selected[i].kitNsn);
      html += '<div class="sel-card">';
      html += '<div class="sel-card-top"><div class="nsn">' + escapeHtml(it.nsn) +
        flagBadges(it) + "</div>";
      html += '<button class="sel-remove-btn" data-nsn="' + escapeHtml(it.nsn) +
        '">Remove</button></div>';
      html += '<div class="desc">' + escapeHtml(it.description || "—") + "</div>";
      html += '<div class="meta"><span><span class="label">Qty:</span> ';
      html += '<input class="qty-input" type="number" min="0" step="any" value="' +
        escapeHtml(qty) + '" data-nsn="' + escapeHtml(it.nsn) + '" aria-label="Quantity for ' +
        escapeHtml(it.nsn) + '"></span>';
      html += '<span><span class="label">UoM:</span> ' + escapeHtml(it.uom || "—") + "</span>";
      html += '<span><span class="label">Ext:</span> <span class="sel-ext">' +
        money(unit === null || unit === undefined ? null : qty * unit) + "</span></span>";
      html += "</div></div>";
    }
    selList.innerHTML = '<div class="sel-total">' + escapeHtml(totalLabel()) +
      "</div>" + html;
  }

  function openDrawer() {
    renderDrawer();
    selDrawer.classList.remove("hidden");
    selOverlay.classList.remove("hidden");
    selDrawer.removeAttribute("aria-hidden");
    selDrawer.removeAttribute("inert");
    document.body.style.overflow = "hidden";
    setTimeout(function () { selClose.focus(); }, 100);
  }

  function closeDrawer() {
    selDrawer.classList.add("hidden");
    selOverlay.classList.add("hidden");
    selDrawer.setAttribute("aria-hidden", "true");
    selDrawer.setAttribute("inert", "");
    document.body.style.overflow = "";
    selectedBtn.focus();
  }

  /* ── Exports (CSV / Excel / PDF, built by assets/export.js) ──
     The same five columns everywhere: what to pull and where it lives. */
  var EXPORT_COLUMNS = [
    { key: "nsn", label: "NSN", pdfWidth: 13, xlsxWidth: 20 },
    { key: "description", label: "Description", pdfWidth: 41, xlsxWidth: 60 },
    { key: "qty", label: "Quantity", type: "number", pdfWidth: 7, xlsxWidth: 10 },
    { key: "uom", label: "Unit of Measure", pdfWidth: 8, xlsxWidth: 10 },
    { key: "kits", label: "Kit Membership", pdfWidth: 31, xlsxWidth: 45 },
  ];

  function exportRow(item, qty, kits) {
    return {
      nsn: item.nsn,
      description: item.description,
      qty: Math.round((qty || 0) * 10000) / 10000,
      uom: item.uom,
      kits: kits,
    };
  }

  function timestamp() {
    var now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
      "_" + pad(now.getHours()) + pad(now.getMinutes());
  }

  function exportedOn() {
    return "exported " + new Date().toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  }

  /* Briefly confirm on the button that was pressed. */
  function flashExported(btn, label) {
    if (!btn) return;
    btn.textContent = "Saved ✓";
    btn.disabled = true;
    setTimeout(function () {
      btn.textContent = label;
      btn.disabled = false;
      if (btn.closest("#sel-export")) btn.disabled = !selected.length;
    }, 1500);
  }

  function runExport(format, doc, btn) {
    var label = btn ? btn.textContent : "";
    if (!window.MedKitsExport) {
      // assets/export.js failed to load (offline on first visit, or blocked).
      window.alert("The export tool did not load. Reload the page and try again.");
      return;
    }
    try {
      window.MedKitsExport.download(format, doc);
      flashExported(btn, label);
    } catch (e) {
      window.alert("Export failed: " + e.message);
    }
  }

  function exportPickList(format, btn) {
    if (!selected.length) return;
    var rows = [];
    selected.forEach(function (sel) {
      var it = itemByNsn[sel.nsn];
      if (!it) return;
      rows.push(exportRow(it, sel.qty,
        sel.kitNsn ? kitName(sel.kitNsn) : it.kitNames.join("; ")));
    });
    runExport(format, {
      title: "Medical kits pick list",
      subtitle: plural(rows.length, "item") + " · " + exportedOn(),
      filename: "medkits_picklist_" + timestamp(),
      columns: EXPORT_COLUMNS,
      rows: rows,
    }, btn);
  }

  /* A kit's contents, whatever the search box holds, in the on-screen order. */
  function exportKit(kit, format, btn) {
    var list = sortList(kitContents[kit.nsn].slice(), kit.nsn);
    runExport(format, {
      title: kit.name,
      subtitle: kit.nsn + " · " + plural(list.length, "item") + " · " + exportedOn(),
      filename: kit.slug,
      columns: EXPORT_COLUMNS,
      rows: list.map(function (it) { return exportRow(it, qtyFor(it, kit.nsn), kit.name); }),
    }, btn);
  }

  function exportButtons(label) {
    return '<span class="export-label">' + label + "</span>" +
      '<button class="sel-action-btn" data-export="csv">CSV</button>' +
      '<button class="sel-action-btn" data-export="xlsx">Excel</button>' +
      '<button class="sel-action-btn" data-export="pdf">PDF</button>';
  }

  /* The desktop table header sticks below the top bar, whose height changes
     with the viewport and with which control rows are showing. */
  function syncTopBarHeight() {
    var bar = document.querySelector(".top-bar");
    if (bar) {
      document.documentElement.style.setProperty(
        "--topbar-h", Math.round(bar.getBoundingClientRect().height) + "px");
    }
  }

  if (window.ResizeObserver) {
    new ResizeObserver(syncTopBarHeight).observe(document.querySelector(".top-bar"));
  } else {
    window.addEventListener("resize", syncTopBarHeight);
  }

  /* Re-render in place: toggles and buttons should not jump the page. */
  function rerenderHere() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  /* ── Events ── */
  listEl.addEventListener("click", function (e) {
    var header = e.target.closest(".kit-group-header");
    if (header) {
      var nsn = header.getAttribute("data-kit");
      if (openGroups[nsn]) delete openGroups[nsn];
      else openGroups[nsn] = true;
      rerenderHere();
      return;
    }

    var toggle = e.target.closest(".kit-toggle");
    if (toggle) {
      var tn = toggle.getAttribute("data-kit");
      if (openTreeKits[tn]) delete openTreeKits[tn];
      else openTreeKits[tn] = true;
      rerenderHere();
      return;
    }

    if (e.target.closest("#show-more")) {
      showMore();
      return;
    }

    var detail = e.target.closest("button.detail-toggle");
    if (detail) {
      var dn = detail.getAttribute("data-nsn");
      if (expandedItems[dn]) delete expandedItems[dn];
      else expandedItems[dn] = true;
      rerenderHere();
      return;
    }

    var add = e.target.closest(".sel-add-btn");
    if (add) {
      e.preventDefault();
      e.stopPropagation();
      var addQty = parseFloat(add.getAttribute("data-qty"));
      toggleSelect(add.getAttribute("data-nsn"), isNaN(addQty) ? 0 : addQty,
                   add.getAttribute("data-kit"));
    }
  });

  tabItems.addEventListener("click", function () { navigate("#items"); });
  tabKits.addEventListener("click", function () { navigate("#kits"); });
  window.addEventListener("hashchange", applyRoute);

  /* Any change to what is listed starts the list from the top again. */
  function refilter() {
    renderLimit = PAGE_SIZE;
    render();
  }

  var debounceTimer;
  searchInput.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      searchTerm = searchInput.value.trim();
      searchClearBtn.classList.toggle("hidden", !searchTerm);
      refilter();
    }, 200);
  });

  searchClearBtn.addEventListener("click", function () {
    searchInput.value = "";
    searchTerm = "";
    searchClearBtn.classList.add("hidden");
    refilter();
    searchInput.focus();
  });

  kitSelect.addEventListener("change", function () {
    kitFilter = kitSelect.value;
    refilter();
  });

  typeSelect.addEventListener("change", function () {
    typeFilter = typeSelect.value;
    refilter();
  });

  sortSelect.addEventListener("change", function () {
    var parts = sortSelect.value.split("-");
    sortAsc = parts[parts.length - 1] === "asc";
    sortKey = parts.slice(0, -1).join("-");
    refilter();
  });

  groupBtn.addEventListener("click", function () {
    groupByKit = !groupByKit;
    openGroups = {};
    groupBtn.setAttribute("aria-pressed", groupByKit ? "true" : "false");
    groupBtn.classList.toggle("active", groupByKit);
    refilter();
  });

  function resetFilters() {
    searchInput.value = "";
    kitSelect.value = "";
    typeSelect.value = "";
    sortSelect.value = "nsn-asc";
    searchTerm = "";
    kitFilter = "";
    typeFilter = "";
    sortKey = "nsn";
    sortAsc = true;
    searchClearBtn.classList.add("hidden");
    refilter();
  }

  window.matchMedia(TABLE_BREAKPOINT).addEventListener("change", function (e) {
    isDesktop = e.matches;
    render();
  });

  selectedBtn.addEventListener("click", openDrawer);
  selClose.addEventListener("click", closeDrawer);
  selOverlay.addEventListener("click", closeDrawer);
  selExport.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-export]");
    if (btn) exportPickList(btn.getAttribute("data-export"), btn);
  });
  selPrint.addEventListener("click", function () { window.print(); });
  selClear.addEventListener("click", function () {
    selected = [];
    persistSelection();
    renderDrawer();
    rerenderHere();
  });

  selList.addEventListener("click", function (e) {
    var btn = e.target.closest(".sel-remove-btn");
    if (!btn) return;
    var nsn = btn.getAttribute("data-nsn");
    for (var i = 0; i < selected.length; i++) {
      if (selected[i].nsn === nsn) { selected.splice(i, 1); break; }
    }
    persistSelection();
    renderDrawer();
    rerenderHere();
  });

  /* Re-rendering the whole drawer here would remove the input mid-edit and drop
     focus (and the soft keyboard), so update only the two derived figures. */
  selList.addEventListener("input", function (e) {
    if (!e.target.classList.contains("qty-input")) return;
    var nsn = e.target.getAttribute("data-nsn");
    var qty = parseFloat(e.target.value);
    if (isNaN(qty) || qty < 0) qty = 0;

    var sel = null;
    for (var i = 0; i < selected.length; i++) {
      if (selected[i].nsn === nsn) { sel = selected[i]; break; }
    }
    if (!sel) return;
    sel.qty = qty;
    persistSelection();

    var item = itemByNsn[nsn];
    var unit = priceFor(item, sel.kitNsn);
    var priced = unit !== null && unit !== undefined;
    var card = e.target.closest(".sel-card");
    var ext = card && card.querySelector(".sel-ext");
    if (ext) ext.textContent = money(priced ? qty * unit : null);
    updateDrawerTotal();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!selDrawer.classList.contains("hidden")) return closeDrawer();
    if (document.activeElement === searchInput && searchInput.value) {
      searchInput.value = "";
      searchTerm = "";
      searchClearBtn.classList.add("hidden");
      refilter();
    }
  });

  loadData();
})();
