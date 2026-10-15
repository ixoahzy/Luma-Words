(() => {
  "use strict";

  const source = () => window.IELTS_WORD_DATA || { lists: [] };
  const lists = () => Array.isArray(source().lists) ? source().lists : [];
  const listById = (listId) => lists().find((list) => list.id === listId) || null;
  const validScope = (scope) => scope === "all" || Boolean(listById(scope));
  const isSourceRecord = (candidate) => {
    const list = listById(candidate?.listId);
    const sourceItem = list?.items.find((item) => item.id === candidate?.id);
    return Boolean(sourceItem
      && sourceItem.order === Number(candidate.order)
      && sourceItem.word === candidate.word
      && sourceItem.meaning === candidate.meaning);
  };
  const scopedItems = (scope = "all") => {
    const selected = listById(scope);
    const sourceLists = selected ? [selected] : lists();
    return sourceLists.flatMap((list) => (Array.isArray(list.items) ? list.items : []).map((item) => ({ ...item, listId: list.id, listName: list.name })))
      .sort((left, right) => left.listId.localeCompare(right.listId, undefined, { numeric: true }) || left.order - right.order);
  };
  const quizWords = (scope = "all") => scopedItems(validScope(scope) ? scope : "all").map((item) => ({
    id: item.id,
    word: item.word,
    meaning: item.meaning,
    ipa: item.ipa,
    listId: item.listId,
    listName: item.listName,
    order: item.order,
    source: "ielts",
  }));
  const importedWord = (item, recordId) => ({
    id: recordId,
    word: item.word,
    meaning: item.meaning,
    ipa: item.ipa || "",
    listId: "custom",
    listName: "自定义",
    order: 0,
    source: "ielts",
  });

  window.IELTS_LIBRARY = { lists, listById, validScope, isSourceRecord, scopedItems, quizWords, importedWord };
})();
