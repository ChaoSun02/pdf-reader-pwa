/**
 * PDF Reader PWA - Main Application
 * Material 3 UI with PDF.js, IndexedDB, File System Access API
 */

// ========================================
// Configuration & Constants
// ========================================

const CONFIG = {
  DB_NAME: 'pdf-reader-pwa',
  DB_VERSION: 1,
  STORES: {
    BOOKS: 'books',
    PROGRESS: 'progress',
    SETTINGS: 'settings'
  },
  PDF_JS_VERSION: '4.8.69', // Latest stable as of 2024
  DEFAULT_SETTINGS: {
    theme: 'system', // 'light', 'dark', 'system'
    keepScreenOn: false,
    defaultZoom: 'auto',
    continuousScroll: true
  }
};

// ========================================
// State Management
// ========================================

const state = {
  db: null,
  books: [], // { id, name, fileHandle, lastModified, size, coverUrl, pageCount }
  currentBook: null,
  pdfDoc: null,
  currentPage: 1,
  totalPages: 0,
  scale: 1.5,
  rotation: 0,
  viewMode: 'grid', // 'grid', 'list'
  sortMode: 'name-asc',
  searchQuery: '',
  settings: { ...CONFIG.DEFAULT_SETTINGS },
  fileHandle: null, // Directory handle for persistent access
  wakeLock: null,
  isLoading: false
};

// ========================================
// DOM Elements Cache
// ========================================

const els = {};

// ========================================
// Utility Functions
// ========================================

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

function throttle(fn, limit) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(date) {
  return new Intl.DateTimeFormat('el-GR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date));
}

function generateId() {
  return crypto.randomUUID();
}

function showToast(message, duration = 3000) {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration + 500);
}

function setLoading(loading) {
  state.isLoading = loading;
  const overlay = $('.loading-overlay');
  if (overlay) {
    overlay.hidden = !loading;
  }
}

// ========================================
// IndexedDB
// ========================================

async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      state.db = request.result;
      resolve(state.db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(CONFIG.STORES.BOOKS)) {
        const booksStore = db.createObjectStore(CONFIG.STORES.BOOKS, { keyPath: 'id' });
        booksStore.createIndex('name', 'name', { unique: false });
        booksStore.createIndex('lastModified', 'lastModified', { unique: false });
      }

      if (!db.objectStoreNames.contains(CONFIG.STORES.PROGRESS)) {
        db.createObjectStore(CONFIG.STORES.PROGRESS, { keyPath: 'bookId' });
      }

      if (!db.objectStoreNames.contains(CONFIG.STORES.SETTINGS)) {
        db.createObjectStore(CONFIG.STORES.SETTINGS, { keyPath: 'key' });
      }
    };
  });
}

async function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbClear(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ========================================
// Settings
// ========================================

async function loadSettings() {
  const saved = await dbGet(CONFIG.STORES.SETTINGS, 'user-settings');
  if (saved) {
    state.settings = { ...CONFIG.DEFAULT_SETTINGS, ...saved.value };
  }
  applyTheme(state.settings.theme);
  updateKeepScreenOn();
}

async function saveSettings() {
  await dbPut(CONFIG.STORES.SETTINGS, { key: 'user-settings', value: state.settings });
}

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    html.setAttribute('data-theme', theme);
  }
}

async function toggleTheme() {
  const themes = ['light', 'dark', 'system'];
  const currentIndex = themes.indexOf(state.settings.theme);
  state.settings.theme = themes[(currentIndex + 1) % themes.length];
  applyTheme(state.settings.theme);
  await saveSettings();
  showToast(`Θέμα: ${state.settings.theme === 'system' ? 'Σύστημα' : state.settings.theme}`);
}

async function updateKeepScreenOn() {
  if (state.settings.keepScreenOn && 'wakeLock' in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => {
        state.wakeLock = null;
      });
    } catch (err) {
      console.warn('Wake Lock failed:', err);
    }
  } else if (state.wakeLock) {
    await state.wakeLock.release();
    state.wakeLock = null;
  }
}

// ========================================
// File System Access API
// ========================================

async function requestDirectoryAccess() {
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'read',
      startIn: 'documents'
    });
    state.fileHandle = handle;
    await loadBooksFromDirectory(handle);
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Directory access denied:', err);
      showToast('Αποτυχία πρόσβασης στον φάκελο');
    }
    return false;
  }
}

async function loadBooksFromDirectory(dirHandle) {
  setLoading(true);
  state.books = [];

  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf')) {
        await processPDFFile(entry);
      }
    }
    await renderLibrary();
    updateLibraryCount();
  } catch (err) {
    console.error('Error loading books:', err);
    showToast('Σφάλμα φόρτωσης βιβλίων');
  } finally {
    setLoading(false);
  }
}

async function processPDFFile(fileHandle) {
  try {
    const file = await fileHandle.getFile();
    const id = generateId();

    // Generate cover thumbnail
    const coverUrl = await generateCoverThumbnail(file);

    // Get page count
    const pageCount = await getPageCount(file);

    const book = {
      id,
      name: file.name.replace(/\.pdf$/i, ''),
      fileName: file.name,
      fileHandle,
      lastModified: file.lastModified,
      size: file.size,
      coverUrl,
      pageCount,
      addedAt: Date.now()
    };

    // Save to IndexedDB
    await dbPut(CONFIG.STORES.BOOKS, book);

    // Load progress
    const progress = await dbGet(CONFIG.STORES.PROGRESS, id);
    if (progress) {
      book.currentPage = progress.page;
      book.progress = progress.progress;
    } else {
      book.currentPage = 1;
      book.progress = 0;
    }

    state.books.push(book);
  } catch (err) {
    console.error('Error processing PDF:', fileHandle.name, err);
  }
}

async function generateCoverThumbnail(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 0.3 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch (err) {
    console.warn('Cover generation failed:', err);
    return null;
  }
}

async function getPageCount(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    return pdf.numPages;
  } catch (err) {
    console.warn('Page count failed:', err);
    return 0;
  }
}

// ========================================
// PDF.js Integration
// ========================================

async function loadPDFJS() {
  if (typeof pdfjsLib !== 'undefined') return;

  // Configure PDF.js worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${CONFIG.PDF_JS_VERSION}/pdf.worker.min.js`;
}

async function openBook(book) {
  state.currentBook = book;
  state.currentPage = book.currentPage || 1;

  await loadPDFJS();

  try {
    setLoading(true);
    const file = await book.fileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();

    state.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    state.totalPages = state.pdfDoc.numPages;

    // Clamp current page
    if (state.currentPage > state.totalPages) state.currentPage = 1;
    if (state.currentPage < 1) state.currentPage = 1;

    // Switch to reader view
    switchView('reader-view');
    updateReaderUI();

    // Render first page
    await renderPage(state.currentPage);

    // Save progress
    await saveProgress();
  } catch (err) {
    console.error('Error opening book:', err);
    showToast('Σφάλμα ανοίγματος PDF');
    setLoading(false);
  }
}

async function renderPage(pageNum) {
  if (!state.pdfDoc || pageNum < 1 || pageNum > state.totalPages) return;

  setLoading(true);

  try {
    const page = await state.pdfDoc.getPage(pageNum);

    // Calculate scale based on container width
    const container = $('#pdf-viewport');
    const containerWidth = container.clientWidth - 32; // padding
    const viewport = page.getViewport({ scale: 1, rotation: state.rotation });
    const scale = Math.min(state.scale, containerWidth / viewport.width);

    const scaledViewport = page.getViewport({ scale, rotation: state.rotation });

    const canvas = $('#pdf-canvas');
    const context = canvas.getContext('2d');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    // High quality rendering
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    await page.render({
      canvasContext: context,
      viewport: scaledViewport
    }).promise;

    state.currentPage = pageNum;
    updateReaderUI();
  } catch (err) {
    console.error('Render page error:', err);
    showToast('Σφάλμα απόδοσης σελίδας');
  } finally {
    setLoading(false);
  }
}

function updateReaderUI() {
  $('#reader-title').textContent = state.currentBook?.name || 'PDF';
  $('#page-input').value = state.currentPage;
  $('#page-input').max = state.totalPages;
  $('#page-total').textContent = `/ ${state.totalPages}`;
  $('#zoom-level').textContent = `${Math.round(state.scale * 100)}%`;

  const progress = state.totalPages > 0 ? (state.currentPage / state.totalPages) * 100 : 0;
  $('#progress-fill').style.width = `${progress}%`;
  $('#progress-text').textContent = `${Math.round(progress)}%`;

  // Update book progress in library
  if (state.currentBook) {
    state.currentBook.currentPage = state.currentPage;
    state.currentBook.progress = progress;
    renderLibrary();
  }
}

async function saveProgress() {
  if (!state.currentBook) return;

  const progress = state.totalPages > 0 ? (state.currentPage / state.totalPages) * 100 : 0;

  await dbPut(CONFIG.STORES.PROGRESS, {
    bookId: state.currentBook.id,
    page: state.currentPage,
    progress,
    timestamp: Date.now()
  });

  // Update book in memory and DB
  state.currentBook.currentPage = state.currentPage;
  state.currentBook.progress = progress;
  await dbPut(CONFIG.STORES.BOOKS, state.currentBook);
}

async function goToPage(pageNum) {
  if (pageNum < 1) pageNum = 1;
  if (pageNum > state.totalPages) pageNum = state.totalPages;
  await renderPage(pageNum);
  await saveProgress();
}

async function nextPage() {
  if (state.currentPage < state.totalPages) {
    await goToPage(state.currentPage + 1);
  }
}

async function prevPage() {
  if (state.currentPage > 1) {
    await goToPage(state.currentPage - 1);
  }
}

function zoomIn() {
  state.scale = Math.min(state.scale + 0.25, 4);
  renderPage(state.currentPage);
}

function zoomOut() {
  state.scale = Math.max(state.scale - 0.25, 0.5);
  renderPage(state.currentPage);
}

function rotatePage() {
  state.rotation = (state.rotation + 90) % 360;
  renderPage(state.currentPage);
}

function resetZoom() {
  state.scale = 1.5;
  state.rotation = 0;
  renderPage(state.currentPage);
}

// ========================================
// Library Rendering
// ========================================

function getFilteredBooks() {
  let books = [...state.books];

  // Search filter
  if (state.searchQuery) {
    const query = state.searchQuery.toLowerCase();
    books = books.filter(b => b.name.toLowerCase().includes(query));
  }

  // Sort
  books.sort((a, b) => {
    switch (state.sortMode) {
      case 'name-asc': return a.name.localeCompare(b.name, 'el');
      case 'name-desc': return b.name.localeCompare(a.name, 'el');
      case 'date-desc': return b.addedAt - a.addedAt;
      case 'date-asc': return a.addedAt - b.addedAt;
      case 'progress-desc': return (b.progress || 0) - (a.progress || 0);
      case 'size-desc': return b.size - a.size;
      default: return 0;
    }
  });

  return books;
}

function renderLibrary() {
  const grid = $('#library-grid');
  const emptyState = $('#empty-state');
  const books = getFilteredBooks();

  grid.classList.toggle('list-view', state.viewMode === 'list');

  if (books.length === 0) {
    grid.innerHTML = '';
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  grid.innerHTML = books.map(book => createBookCard(book)).join('');

  // Add click listeners
  $$('.book-card', grid).forEach(card => {
    card.addEventListener('click', () => openBook(state.books.find(b => b.id === card.dataset.id)));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  });
}

function createBookCard(book) {
  const progress = book.progress || 0;
  const coverHtml = book.coverUrl
    ? `<img src="${book.coverUrl}" alt="" loading="lazy">`
    : `<div class="cover-placeholder"><span class="material-symbols-rounded">file_open</span></div>`;

  return `
    <article class="book-card ${state.viewMode === 'list' ? 'list-view' : ''}" data-id="${book.id}" tabindex="0" role="listitem">
      <div class="book-cover">
        ${coverHtml}
        <div class="book-progress-overlay">
          <div class="book-progress-fill" style="width: ${progress}%"></div>
        </div>
      </div>
      <div class="book-info">
        <h3 class="book-title" title="${book.name}">${book.name}</h3>
        <div class="book-meta">
          <span>${formatFileSize(book.size)}</span>
          <span>•</span>
          <span>${book.pageCount} σελ.</span>
          <span>•</span>
          <span>${formatDate(book.lastModified)}</span>
        </div>
        <div class="book-progress-bar">
          <div class="book-progress-bar-fill" style="width: ${progress}%"></div>
        </div>
        <span class="book-progress-text">${Math.round(progress)}% ολοκληρωμένο</span>
      </div>
    </article>
  `;
}

function updateLibraryCount() {
  const count = state.books.length;
  $('#library-count').textContent = `${count} βιβλ${count === 1 ? 'ίο' : 'ία'}`;
}

function switchView(viewId) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#${viewId}`).classList.add('active');
}

function toggleViewMode() {
  state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
  renderLibrary();
  showToast(state.viewMode === 'grid' ? 'Προβολή πλέγματος' : 'Προβολή λίστας');
}

// ========================================
// Search
// ========================================

function handleSearch(e) {
  state.searchQuery = e.target.value.trim();
  $('#clear-search').hidden = !state.searchQuery;
  renderLibrary();
}

function clearSearch() {
  $('#search-input').value = '';
  state.searchQuery = '';
  $('#clear-search').hidden = true;
  renderLibrary();
}

// ========================================
// Sort Menu
// ========================================

function toggleSortMenu() {
  const menu = $('#sort-menu');
  menu.hidden = !menu.hidden;
}

function handleSortSelect(e) {
  const item = e.target.closest('menuitem');
  if (!item) return;

  state.sortMode = item.dataset.sort;
  $('#sort-menu').hidden = true;
  renderLibrary();
  showToast(`Ταξινόμηση: ${item.textContent}`);
}

// ========================================
// Reader Settings Menu
// ========================================

function toggleReaderSettingsMenu() {
  const menu = $('#reader-settings-menu');
  menu.hidden = !menu.hidden;
}

function handleReaderSettingsSelect(e) {
  const item = e.target.closest('menuitem');
  if (!item) return;

  $('#reader-settings-menu').hidden = true;

  switch (item.id) {
    case 'menu-bookmark':
      addBookmark();
      break;
    case 'menu-go-to':
      promptGoToPage();
      break;
    case 'menu-outline':
      showOutline();
      break;
    case 'menu-properties':
      showProperties();
      break;
  }
}

function addBookmark() {
  if (!state.currentBook) return;
  // TODO: Implement bookmarks
  showToast('Σφραγίδα προστέθηκε στη σελίδα ' + state.currentPage);
}

function promptGoToPage() {
  const input = $('#page-input');
  input.focus();
  input.select();
}

async function showOutline() {
  if (!state.pdfDoc) return;

  try {
    const outline = await state.pdfDoc.getOutline();
    if (!outline || outline.length === 0) {
      showToast('Δεν βρέθηκαν περιεχόμενα');
      return;
    }
    // TODO: Show outline in a modal
    showToast('Περιεχόμενα: ' + outline.length + ' κεφάλαια');
  } catch (err) {
    showToast('Δεν βρέθηκαν περιεχόμενα');
  }
}

function showProperties() {
  if (!state.currentBook) return;
  const book = state.currentBook;
  showToast(`${book.name} • ${book.pageCount} σελίδες • ${formatFileSize(book.size)}`);
}

// ========================================
// Drawer
// ========================================

function openDrawer() {
  $('#settings-drawer').hidden = false;
  // Force reflow for animation
  requestAnimationFrame(() => {
    $('#settings-drawer').removeAttribute('hidden');
  });
}

function closeDrawer() {
  const drawer = $('#settings-drawer');
  drawer.hidden = true;
}

function setupDrawerSettings() {
  // Dark mode toggle
  $('#dark-mode').checked = state.settings.theme === 'dark';
  $('#dark-mode').addEventListener('change', async (e) => {
    state.settings.theme = e.target.checked ? 'dark' : 'light';
    applyTheme(state.settings.theme);
    await saveSettings();
  });

  // Keep screen on
  $('#keep-screen-on').checked = state.settings.keepScreenOn;
  $('#keep-screen-on').addEventListener('change', async (e) => {
    state.settings.keepScreenOn = e.target.checked;
    await saveSettings();
    updateKeepScreenOn();
  });

  // Default zoom
  $('#default-zoom').value = state.settings.defaultZoom;
  $('#default-zoom').addEventListener('change', async (e) => {
    state.settings.defaultZoom = e.target.value;
    await saveSettings();
  });

  // Continuous scroll
  $('#continuous-scroll').checked = state.settings.continuousScroll;
  $('#continuous-scroll').addEventListener('change', async (e) => {
    state.settings.continuousScroll = e.target.checked;
    await saveSettings();
  });

  // Clear progress
  $('#clear-progress-btn').addEventListener('click', async () => {
    if (confirm('Διαγραφή всей της προόδου ανάγνωσης;')) {
      await dbClear(CONFIG.STORES.PROGRESS);
      state.books.forEach(b => { b.currentPage = 1; b.progress = 0; });
      await Promise.all(state.books.map(b => dbPut(CONFIG.STORES.BOOKS, b)));
      renderLibrary();
      showToast('Πρόοδος διαγράφηκε');
    }
    closeDrawer();
  });

  // Export data
  $('#export-data-btn').addEventListener('click', async () => {
    const data = {
      books: await dbGetAll(CONFIG.STORES.BOOKS),
      progress: await dbGetAll(CONFIG.STORES.PROGRESS),
      settings: state.settings,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pdf-reader-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    closeDrawer();
    showToast('Δεδομένα εξήχθησαν');
  });

  // Import data
  $('#import-data').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.books) {
        for (const book of data.books) {
          await dbPut(CONFIG.STORES.BOOKS, book);
        }
      }
      if (data.progress) {
        for (const prog of data.progress) {
          await dbPut(CONFIG.STORES.PROGRESS, prog);
        }
      }
      if (data.settings) {
        state.settings = { ...CONFIG.DEFAULT_SETTINGS, ...data.settings };
        await saveSettings();
        applyTheme(state.settings.theme);
        updateKeepScreenOn();
        // Update UI
        $('#dark-mode').checked = state.settings.theme === 'dark';
        $('#keep-screen-on').checked = state.settings.keepScreenOn;
        $('#default-zoom').value = state.settings.defaultZoom;
        $('#continuous-scroll').checked = state.settings.continuousScroll;
      }

      await loadBooksFromDB();
      showToast('Δεδομένα εισήχθησαν');
    } catch (err) {
      console.error('Import error:', err);
      showToast('Σφάλμα εισαγωγής');
    }
    e.target.value = '';
    closeDrawer();
  });
}

async function loadBooksFromDB() {
  const books = await dbGetAll(CONFIG.STORES.BOOKS);
  for (const book of books) {
    const progress = await dbGet(CONFIG.STORES.PROGRESS, book.id);
    if (progress) {
      book.currentPage = progress.page;
      book.progress = progress.progress;
    }
  }
  state.books = books;
  await renderLibrary();
  updateLibraryCount();
}

// ========================================
// Fullscreen
// ========================================

async function toggleFullscreen() {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    try {
      await elem.requestFullscreen();
      $('#fullscreen-btn .material-symbols-rounded').textContent = 'fullscreen_exit';
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  } else {
    await document.exitFullscreen();
    $('#fullscreen-btn .material-symbols-rounded').textContent = 'fullscreen';
  }
}

document.addEventListener('fullscreenchange', () => {
  const icon = $('#fullscreen-btn .material-symbols-rounded');
  if (icon) {
    icon.textContent = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen';
  }
});

// ========================================
// Keyboard Shortcuts
// ========================================

function handleKeydown(e) {
  // Ignore if typing in input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
    return;
  }

  const readerActive = $('#reader-view').classList.contains('active');

  if (readerActive) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case ' ':
      case 'PageDown':
        e.preventDefault();
        nextPage();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        prevPage();
        break;
      case 'Home':
        e.preventDefault();
        goToPage(1);
        break;
      case 'End':
        e.preventDefault();
        goToPage(state.totalPages);
        break;
      case '+':
      case '=':
        e.preventDefault();
        zoomIn();
        break;
      case '-':
      case '_':
        e.preventDefault();
        zoomOut();
        break;
      case '0':
        e.preventDefault();
        resetZoom();
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        rotatePage();
        break;
      case 'Escape':
        e.preventDefault();
        switchView('library-view');
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        toggleFullscreen();
        break;
    }
  } else {
    // Library view shortcuts
    switch (e.key) {
      case '/':
        e.preventDefault();
        $('#search-input').focus();
        break;
      case 'Escape':
        e.preventDefault();
        clearSearch();
        $('#search-input').blur();
        break;
      case 'v':
      case 'V':
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        toggleViewMode();
        break;
      case 's':
      case 'S':
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        toggleSortMenu();
        break;
      case 'o':
      case 'O':
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        $('#open-folder-btn').click();
        break;
    }
  }

  // Global shortcuts
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    openDrawer();
  }
}

// ========================================
// Touch/Gesture Support
// ========================================

let touchStartX = 0;
let touchStartY = 0;

function handleTouchStart(e) {
  if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}

function handleTouchEnd(e) {
  if (e.changedTouches.length === 1) {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    const readerActive = $('#reader-view').classList.contains('active');

    if (readerActive && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX > 0) {
        prevPage();
      } else {
        nextPage();
      }
    }
  }
}

// ========================================
// Event Listeners Setup
// ========================================

function setupEventListeners() {
  // View switching
  $('#open-folder-btn').addEventListener('click', requestDirectoryAccess);
  $('#empty-open-folder').addEventListener('click', requestDirectoryAccess);
  $('#back-btn').addEventListener('click', () => switchView('library-view'));

  // Search
  $('#search-input').addEventListener('input', debounce(handleSearch, 150));
  $('#clear-search').addEventListener('click', clearSearch);

  // View toggle
  $('#view-toggle-btn').addEventListener('click', toggleViewMode);

  // Sort
  $('#sort-btn').addEventListener('click', toggleSortMenu);
  $('#sort-menu').addEventListener('click', handleSortSelect);

  // Reader toolbar
  $('#prev-page').addEventListener('click', prevPage);
  $('#next-page').addEventListener('click', nextPage);
  $('#page-input').addEventListener('change', (e) => goToPage(parseInt(e.target.value) || 1));
  $('#zoom-in').addEventListener('click', zoomIn);
  $('#zoom-out').addEventListener('click', zoomOut);
  $('#rotate-btn').addEventListener('click', rotatePage);
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#fullscreen-btn').addEventListener('click', toggleFullscreen);

  // Reader settings menu
  $('#reader-settings-btn').addEventListener('click', toggleReaderSettingsMenu);
  $('#reader-settings-menu').addEventListener('click', handleReaderSettingsSelect);

  // Bookmark
  $('#bookmark-btn').addEventListener('click', addBookmark);

  // Settings drawer
  $('#settings-btn').addEventListener('click', openDrawer);
  $('#close-drawer').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);

  // Keyboard
  document.addEventListener('keydown', handleKeydown);

  // Touch
  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchend', handleTouchEnd, { passive: true });

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#sort-btn') && !e.target.closest('#sort-menu')) {
      $('#sort-menu').hidden = true;
    }
    if (!e.target.closest('#reader-settings-btn') && !e.target.closest('#reader-settings-menu')) {
      $('#reader-settings-menu').hidden = true;
    }
  });

  // System theme change
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (state.settings.theme === 'system') {
      applyTheme('system');
    }
  });
}

// ========================================
// Initialization
// ========================================

async function init() {
  // Cache DOM elements
  els.libraryView = $('#library-view');
  els.readerView = $('#reader-view');
  els.libraryGrid = $('#library-grid');
  els.emptyState = $('#empty-state');
  els.readerContainer = $('#reader-container');

  try {
    // Initialize IndexedDB
    await initDB();

    // Load settings
    await loadSettings();

    // Setup drawer settings
    setupDrawerSettings();

    // Setup event listeners
    setupEventListeners();

    // Load books from DB (for previously added books)
    await loadBooksFromDB();

    // Check for existing directory handle (permission persistence)
    if ('storage' in navigator && 'getDirectory' in navigator.storage) {
      try {
        const handle = await navigator.storage.getDirectory();
        // Note: This doesn't restore File System Access API handles
        // User will need to re-select folder on each session unless using File System Access API
      } catch (err) {
        // Ignore
      }
    }

    showToast('PDF Reader έτοιμο');
  } catch (err) {
    console.error('Init error:', err);
    showToast('Σφάλμα αρχικοποίησης');
  }
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for debugging
window.PDFReaderApp = {
  state,
  openBook,
  goToPage,
  nextPage,
  prevPage,
  zoomIn,
  zoomOut,
  rotatePage,
  toggleTheme,
  toggleFullscreen
};