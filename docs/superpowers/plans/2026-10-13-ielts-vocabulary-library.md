# 雅思词汇真经词库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 22-list IELTS vocabulary source to every relevant DeskTalk learning flow while preserving its source order for list-based dictation.

**Architecture:** A new static data file exposes source-ordered IELTS records. `index.html` gains a third library mode and filters its existing quiz, study, dictation, library-management and mistake-book flows through a small set of source/list helpers instead of duplicating each flow.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Node.js test runner, Python/pypdf for source extraction.

**Spec:** `docs/superpowers/specs/2026-10-13-ielts-vocabulary-library-design.md`

## Global Constraints

- Preserve the 22 original Lists and all 3,605 source-numbered entries; never deduplicate across Lists.
- Keep ordinary and simple modes behaviorally unchanged.
- Do not require a server, build step, or new runtime dependency for the deployed page.
- The dictation order for an original List is ascending source `order`.
- Treat malformed stored settings and missing data as recoverable empty states.

## Review Focus

- Verify the parser does not mis-associate a wrapped meaning with the following English word.
- Verify duplicate spellings in different Lists get distinct, stable IDs and independent mistake records.
- Verify List filtering uses only the selected List for both correct and distractor answers.
- Verify a previous browser's settings with no IELTS fields still opens ordinary mode.
- Verify a custom IELTS import cannot reorder a source List.

### Task 1: Produce and validate the IELTS source data

**Files:**
- Create: `scripts/extract_ielts_vocabulary.py`
- Create: `ielts-word-data.js`
- Create: `tests/ielts-data.test.mjs`

**Interfaces:**
- Produces: `window.IELTS_WORD_DATA = { version, title, lists }`, where every list is `{ id, name, items }` and every item is `{ id, order, word, ipa, meaning }`.
- Consumes: `/Users/kage/Downloads/雅思词汇真经.pdf` only while generating the checked-in static data file.

- [ ] **Step 1: Write the failing data-contract test**

Assert that the data contains Lists 1 through 22, exactly 3,605 items, the expected final number for every List, and List 1 starts with `atmosphere` then `lithosphere`.

- [ ] **Step 2: Run the data-contract test to verify it fails**

Run: `node --test tests/ielts-data.test.mjs`

Expected: FAIL because `ielts-word-data.js` does not exist.

- [ ] **Step 3: Implement the source extractor and generate `ielts-word-data.js`**

Extract page text with pypdf, identify the List and numbered entries, join each wrapped pronunciation/meaning block until the next numbered entry, clean known PDF glyph noise, and stop if a List is not contiguous. Emit data in source order without deduplication.

- [ ] **Step 4: Run the data-contract test to verify it passes**

Run: `node --test tests/ielts-data.test.mjs`

Expected: PASS with all List counts and sentinel entries verified.

### Task 2: Add third-library selection and scoped multiple-choice questions

**Files:**
- Modify: `index.html`
- Test: `tests/ielts-ui.test.mjs`

**Interfaces:**
- Consumes: `window.IELTS_WORD_DATA.lists` from Task 1.
- Produces: a selected source mode of `ordinary`, `simple`, or `ielts`, and an IELTS scope value of `all` or a List ID.

- [ ] **Step 1: Write failing home-quiz tests**

Assert that selecting `ielts` with `list-1` yields a pool whose correct and distractor records are all from List 1, and that invalid scope falls back to all Lists.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/ielts-ui.test.mjs --test-name-pattern="home quiz"

Expected: FAIL because IELTS mode and pool helpers are absent.

- [ ] **Step 3: Implement mode, scope, persistence and rendering helpers in `index.html`**

Add the third button, List selector, versioned IELTS localStorage data, `activeWords()` and `activeIeltsLists()` helpers. Route `makeQuestion`, word counts, mode changes and empty states through the active pool so quiz options cannot escape the selected List.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --test tests/ielts-ui.test.mjs --test-name-pattern="home quiz"

Expected: PASS.

### Task 3: Add source-ordered IELTS study and dictation

**Files:**
- Modify: `index.html`
- Modify: `tests/ielts-ui.test.mjs`

**Interfaces:**
- Consumes: List items and `order` from Task 1, plus selected IELTS List from Task 2.
- Produces: a List chooser and ordered `dictationItems` for the existing dictation overlay.

- [ ] **Step 1: Write failing study/dictation tests**

Assert that the IELTS study categories are Lists 1–22 and `startDictation("list-1")` produces `atmosphere`, then `lithosphere`, and uses List-specific mistake IDs.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/ielts-ui.test.mjs --test-name-pattern="study|dictation"

Expected: FAIL because IELTS study and dictation adapters are absent.

- [ ] **Step 3: Implement IELTS study-data and dictation adapters in `index.html`**

Render third study tab and List categories from static data; sort entries numerically by `order`, preserve that order after search, and route the dictation chooser, question copy and completion message through the selected List.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --test tests/ielts-ui.test.mjs --test-name-pattern="study|dictation"

Expected: PASS.

### Task 4: Extend management flows and complete regression verification

**Files:**
- Modify: `index.html`
- Modify: `tests/ielts-ui.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: the selected third mode, IELTS records and shared mistake API.
- Produces: third-library browse/search/import/export support without source-order corruption.

- [ ] **Step 1: Write failing library-compatibility tests**

Assert that managed IELTS records retain a valid List/order, invalid metadata cannot enter a source List scope, duplicate spellings from different Lists remain separate mistakes, and old settings load ordinary mode.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/ielts-ui.test.mjs --test-name-pattern="library|compatibility|mistake"

Expected: FAIL because third-library metadata and migration are absent.

- [ ] **Step 3: Implement third-library management and compatibility behavior**

Add third-mode labels and storage keys; retain metadata on edit/import/export; prevent invalid custom entries from changing source List order; use `ielts-{list}-{order}` IDs for source mistakes; document the new mode and List practice in the README.

- [ ] **Step 4: Run the focused tests and full test suite to verify they pass**

Run: `node --test tests/*.test.mjs`

Expected: PASS with no skipped source-contract, selection, dictation, compatibility or regression tests.

- [ ] **Step 5: Verify the delivered page in a browser**

Open `index.html`, select IELTS List 1 on the home page, answer one question, open study, begin List 1 dictation, and confirm the first two prompts follow the source order.

## Self-review

- Spec coverage: Tasks 1–4 cover source fidelity, selection, List-scoped quiz, ordered study/dictation, management flows, shared mistakes, migration and documentation.
- Type consistency: every flow consumes `{ id, order, word, ipa, meaning }`; source List IDs are `list-1` through `list-22`.
- Review focus: each listed failure mode is assigned to a test in Tasks 1, 2 or 4.
- Scope: the plan adds a single third vocabulary source and reuses existing UI/interaction patterns rather than introducing a new framework.
