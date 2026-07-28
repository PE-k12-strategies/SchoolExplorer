/**
 * Searchable dropdown (combobox) that mirrors a native <select>.
 * Typing filters options; choosing an option updates the select and fires change.
 * Supports single or multiple selection (options.multiple or select.multiple).
 * Multiple mode: check freely, then Apply / Enter to commit + load.
 * Outside click keeps the draft checks but does not load until Apply / Enter.
 * Escape discards the unfinished draft.
 */
(function (global) {
  const registry = new Map();

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function closeAll(exceptId) {
    registry.forEach((api, id) => {
      if (id !== exceptId) api.close();
    });
  }

  function enhance(selectOrId, options = {}) {
    const select = typeof selectOrId === 'string'
      ? document.getElementById(selectOrId)
      : selectOrId;
    if (!select) return null;

    const selectId = select.id;
    if (!selectId) return null;
    if (registry.has(selectId)) return registry.get(selectId);

    if (options.multiple) select.multiple = true;
    const isMultiple = !!(options.multiple || select.multiple);
    const allLabel = options.allLabel || 'All';

    const wrap = document.createElement('div');
    wrap.className = 'searchable-select' + (isMultiple ? ' is-multiple' : '');
    wrap.dataset.selectId = selectId;

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'searchable-select-input';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.placeholder = options.placeholder || 'Type to search…';

    const panel = document.createElement('div');
    panel.className = 'searchable-select-panel';
    panel.hidden = true;

    let toolbar = null;
    if (isMultiple) {
      toolbar = document.createElement('div');
      toolbar.className = 'searchable-select-toolbar';
      toolbar.innerHTML =
        '<button type="button" class="searchable-select-tool" data-action="all">Select all</button>'
        + '<button type="button" class="searchable-select-tool" data-action="none">Clear</button>'
        + '<button type="button" class="searchable-select-tool searchable-select-apply" data-action="apply">Apply</button>';
      panel.appendChild(toolbar);
    }

    const list = document.createElement('ul');
    list.className = 'searchable-select-list';
    list.setAttribute('role', 'listbox');
    if (isMultiple) list.setAttribute('aria-multiselectable', 'true');
    panel.appendChild(list);

    select.classList.add('searchable-select-native');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(input);
    wrap.appendChild(panel);
    wrap.appendChild(select);

    let highlight = -1;
    let open = false;
    let lastQuery = '';
    /** Last applied selection (what the page has loaded). */
    let committedValues = getSelectedValuesSnapshot();
    /**
     * In-progress multi checks. Null = no draft (UI follows committed / select).
     * Draft does NOT write to the native <select> until Apply / Enter, so filters
     * and loaders keep seeing the last committed scope.
     */
    let draftValues = null;

    function getSelectedValuesSnapshot() {
      return [...select.selectedOptions]
        .map((o) => o.value)
        .filter((v) => v !== '');
    }

    function getOptions() {
      return [...select.options].map((o) => ({
        value: o.value,
        label: o.textContent || '',
        disabled: o.disabled,
        selected: o.selected,
        incomplete: o.classList.contains('is-incomplete'),
      }));
    }

    function getSelectedValues() {
      return getSelectedValuesSnapshot();
    }

    function activeValues() {
      if (isMultiple && draftValues != null) return draftValues.slice();
      return committedValues.slice();
    }

    function draftDirty() {
      return isMultiple && draftValues != null;
    }

    function applySelectedValues(values) {
      const wanted = new Set((values || []).map(String));
      [...select.options].forEach((o) => {
        if (o.value === '') return;
        o.selected = wanted.has(o.value);
      });
    }

    function setSelectedValues(values) {
      applySelectedValues(values);
      committedValues = getSelectedValuesSnapshot();
      draftValues = null;
      syncPendingUi();
      syncFromSelect();
      if (open) renderList(lastQuery);
    }

    function syncPendingUi() {
      const pending = draftDirty();
      wrap.classList.toggle('is-pending', pending);
      if (toolbar) {
        const applyBtn = toolbar.querySelector('[data-action="apply"]');
        if (applyBtn) applyBtn.classList.toggle('is-pending', pending);
      }
    }

    function ensureDraft() {
      if (draftValues == null) draftValues = committedValues.slice();
    }

    function revertDraft() {
      if (!draftDirty()) return;
      draftValues = null;
      syncPendingUi();
    }

    /** Commit draft (or current select) and notify listeners — Apply / Enter only. */
    function commitDraft(optsCommit) {
      if (select.disabled) return;
      const next = draftValues != null ? draftValues.slice() : getSelectedValuesSnapshot();
      const prev = committedValues.slice().sort().join('\0');
      const now = next.slice().sort().join('\0');
      applySelectedValues(next);
      committedValues = getSelectedValuesSnapshot();
      draftValues = null;
      syncPendingUi();
      syncFromSelect();
      const skipClose = optsCommit && optsCommit.skipClose;
      if (!skipClose) close({ keepSelection: true });
      if (prev !== now) fireChange();
    }

    function summaryForValues(values) {
      const wanted = new Set((values || []).map(String));
      const selected = [...select.options].filter((o) => o.value && wanted.has(o.value));
      if (!selected.length) return allLabel;
      if (selected.length === 1) return selected[0].textContent;
      const labels = selected.map((o) => {
        const t = (o.textContent || o.value).split(' — ')[0];
        return t;
      });
      const joined = labels.join(', ');
      const base = joined.length <= 36 ? joined : `${selected.length} selected`;
      return draftDirty() ? `${base} — Apply to load` : base;
    }

    function selectedSummary() {
      if (!isMultiple) {
        const opt = select.selectedOptions[0];
        return opt ? opt.textContent : '';
      }
      return summaryForValues(activeValues());
    }

    function selectedLabel() {
      return selectedSummary();
    }

    function isValueSelected(value) {
      if (!isMultiple) return select.value === value;
      return activeValues().map(String).includes(String(value));
    }

    function syncDisabled() {
      input.disabled = select.disabled;
      wrap.classList.toggle('is-disabled', select.disabled);
    }

    function close(optsClose) {
      const keep = optsClose && optsClose.keepSelection;
      const forceRevert = optsClose && optsClose.revert;
      // Multi: Escape discards draft. Outside/blur keeps draft (no load) so
      // users can check several values, click away, reopen, then Apply.
      if (isMultiple && draftDirty() && !keep) {
        if (forceRevert) revertDraft();
        // else: keep draftValues; do not write select / do not fireChange
      }
      open = false;
      wrap.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
      panel.style.left = '';
      panel.style.right = '';
      highlight = -1;
      syncPendingUi();
      input.value = selectedLabel();
    }

    function syncFromSelect() {
      if (!draftDirty()) {
        committedValues = getSelectedValuesSnapshot();
      }
      input.value = selectedLabel();
      syncDisabled();
      syncPendingUi();
      if (select.disabled) close({ keepSelection: true });
    }

    function refreshFromSelect() {
      committedValues = getSelectedValuesSnapshot();
      draftValues = null;
      syncFromSelect();
      if (open) renderList(lastQuery || '');
      else if (!isMultiple) close({ keepSelection: true });
    }

    function fireChange() {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function selectableOptions(query) {
      const q = (query || '').trim().toLowerCase();
      return getOptions().filter((o) => {
        if (!o.value || o.disabled) return false;
        return !q || o.label.toLowerCase().includes(q);
      });
    }

    function selectAllFiltered() {
      if (select.disabled) return;
      const items = selectableOptions(lastQuery);
      if (!items.length) return;
      ensureDraft();
      const wanted = new Set(items.map((o) => String(o.value)));
      const kept = draftValues.filter((v) => !wanted.has(String(v)));
      draftValues = kept.concat(items.map((o) => o.value));
      input.value = '';
      syncPendingUi();
      renderList(lastQuery);
    }

    function clearAll() {
      if (select.disabled) return;
      draftValues = [];
      input.value = '';
      syncPendingUi();
      renderList(lastQuery);
    }

    function renderList(query) {
      lastQuery = query || '';
      const q = lastQuery.trim().toLowerCase();
      const items = getOptions().filter((o) => !q || o.label.toLowerCase().includes(q));
      highlight = items.length ? 0 : -1;

      if (toolbar) {
        const n = selectableOptions(lastQuery).length;
        const allBtn = toolbar.querySelector('[data-action="all"]');
        if (allBtn) {
          allBtn.textContent = q
            ? `Select all (${n})`
            : 'Select all';
          allBtn.disabled = n === 0;
        }
      }

      if (!items.length) {
        list.innerHTML = '<li class="searchable-select-empty">No matches</li>';
        return;
      }

      list.innerHTML = items
        .map((o, i) => {
          const selected = isValueSelected(o.value);
          const isAll = o.value === '';
          const cls = [
            'searchable-select-option',
            selected ? 'is-selected' : '',
            i === highlight ? 'is-active' : '',
            o.disabled ? 'is-disabled' : '',
            o.incomplete ? 'is-incomplete' : '',
            isAll ? 'is-all' : '',
          ]
            .filter(Boolean)
            .join(' ');

          if (isMultiple && !isAll) {
            return (
              '<li class="' + cls + '" role="option" data-value="' + escapeHtml(o.value)
              + '" aria-selected="' + (selected ? 'true' : 'false') + '">'
              + '<span class="searchable-select-check" aria-hidden="true"></span>'
              + '<span class="searchable-select-label">' + escapeHtml(o.label) + '</span>'
              + '</li>'
            );
          }

          return (
            '<li class="' + cls + '" role="option" data-value="' + escapeHtml(o.value)
            + '" aria-selected="' + (selected ? 'true' : 'false') + '">'
            + escapeHtml(o.label)
            + '</li>'
          );
        })
        .join('');
    }

    function openList() {
      if (select.disabled) return;
      closeAll(selectId);
      open = true;
      wrap.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      panel.style.left = '';
      panel.style.right = '';
      if (isMultiple && !draftDirty()) {
        committedValues = getSelectedValuesSnapshot();
      }
      const closedSummary = selectedLabel();
      const filterQuery = input.value && input.value !== closedSummary
        && !String(input.value).includes('Apply to load')
        ? input.value
        : '';
      renderList(filterQuery);
      const rect = panel.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        panel.style.left = 'auto';
        panel.style.right = '0';
      } else {
        panel.style.left = '';
        panel.style.right = '';
      }
    }

    function choose(value) {
      if (select.disabled) return;
      const opt = [...select.options].find((o) => o.value === value);
      if (!opt || opt.disabled) return;

      if (isMultiple) {
        ensureDraft();
        if (value === '') {
          draftValues = [];
        } else {
          const id = String(value);
          const set = new Set(draftValues.map(String));
          if (set.has(id)) set.delete(id);
          else set.add(id);
          draftValues = [...set];
        }
        input.value = '';
        syncPendingUi();
        renderList(lastQuery);
        return;
      }

      const prev = select.value;
      select.value = value;
      syncFromSelect();
      close({ keepSelection: true });
      if (prev !== select.value) fireChange();
    }

    function moveHighlight(delta) {
      const opts = [...list.querySelectorAll('.searchable-select-option:not(.is-disabled)')];
      if (!opts.length) return;
      highlight = (highlight + delta + opts.length) % opts.length;
      opts.forEach((el, i) => el.classList.toggle('is-active', i === highlight));
      opts[highlight].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('focus', () => {
      if (select.disabled) return;
      if (!isMultiple) input.select();
      openList();
    });

    input.addEventListener('input', () => {
      if (select.disabled) return;
      if (!open) openList();
      else renderList(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (select.disabled) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) openList();
        else moveHighlight(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) openList();
        else moveHighlight(-1);
      } else if (e.key === 'Enter') {
        if (!open) return;
        e.preventDefault();
        if (isMultiple) {
          commitDraft();
          return;
        }
        const active = list.querySelector('.searchable-select-option.is-active');
        if (active) choose(active.dataset.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close({ revert: true });
        input.blur();
      }
    });

    list.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.searchable-select-option');
      if (!opt || opt.classList.contains('is-disabled')) return;
      // Keep focus on the input, and stop bubbling: choose() re-renders the list
      // and detaches this row, which would otherwise make document.mousedown
      // think the click was outside and close the panel.
      e.preventDefault();
      e.stopPropagation();
      choose(opt.dataset.value);
    });

    if (toolbar) {
      toolbar.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        if (action === 'all') selectAllFiltered();
        else if (action === 'none') clearAll();
        else if (action === 'apply') commitDraft();
      });
    }

    // Clicks inside the panel are not "outside" — don't let them bubble to
    // document closeAll (important after list re-render detaches the option node).
    panel.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!open) return;
        if (wrap.contains(document.activeElement)) return;
        // Multi stays open until outside click / Apply / Enter / Escape.
        if (isMultiple) return;
        close();
      }, 120);
    });

    const api = {
      refresh: refreshFromSelect,
      refreshFromSelect,
      close,
      commit: commitDraft,
      getSelectedValues,
      setSelectedValues,
      selectAll: selectAllFiltered,
      clearAll,
      get disabled() {
        return select.disabled;
      },
      setDisabled(v) {
        select.disabled = !!v;
        syncFromSelect();
      },
    };

    registry.set(selectId, api);
    syncFromSelect();
    return api;
  }

  function refresh(selectId) {
    const api = registry.get(selectId);
    if (api) api.refreshFromSelect();
  }

  function refreshAll() {
    registry.forEach((api) => api.refreshFromSelect());
  }

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.searchable-select')) closeAll();
  });

  global.SearchableSelect = { enhance, refresh, refreshAll };
})(window);
