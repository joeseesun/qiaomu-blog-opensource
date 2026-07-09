/**
 * Qiaomu Blog Clipper - Popup Script (Redesigned)
 *
 * Views: clip | settings | progress | success | error
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- DOM refs ----
const views = {
  clip: $('#view-clip'),
  settings: $('#view-settings'),
  progress: $('#view-progress'),
  success: $('#view-success'),
  error: $('#view-error'),
};

const btnBack = $('#btn-back');
const btnSettings = $('#btn-settings');
const btnClip = $('#btn-clip');
const btnSave = $('#btn-save');
const btnDone = $('#btn-done');
const btnRetry = $('#btn-retry');
const btnCloseError = $('#btn-close-error');
const btnEdit = $('#btn-edit');
const btnView = $('#btn-view');

const inputTitle = $('#input-title');
const selectCategory = $('#select-category');
const inputApiUrl = $('#input-api-url');
const inputToken = $('#input-token');

const progressText = $('#progress-text');
const progressDetail = $('#progress-detail');
const successTitle = $('#success-title');
const successDetail = $('#success-detail');
const errorMessage = $('#error-message');

const pills = $$('.pill');

let currentView = 'clip';
let selectedStatus = 'draft';
let categoriesCache = null;

// ---- View management ----

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });

  // Header logic
  const isSettings = name === 'settings';
  btnBack.classList.toggle('hidden', !isSettings);
  btnSettings.classList.toggle('hidden', isSettings || name === 'progress');

  currentView = name;
}

// ---- Toast helper ----

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 1500);
}

// ---- Settings ----

btnSettings.addEventListener('click', () => {
  chrome.storage.sync.get(['apiUrl', 'apiToken'], (data) => {
    inputApiUrl.value = data.apiUrl || '';
    inputToken.value = data.apiToken || '';
  });
  showView('settings');
});

btnBack.addEventListener('click', () => {
  showView('clip');
});

btnSave.addEventListener('click', () => {
  const apiUrl = inputApiUrl.value.trim().replace(/\/+$/, '');
  const apiToken = inputToken.value.trim();

  if (!apiUrl) {
    inputApiUrl.focus();
    return;
  }
  if (!apiToken) {
    inputToken.focus();
    return;
  }

  chrome.storage.sync.set({ apiUrl, apiToken }, () => {
    showToast('设置已保存');
    // Refresh categories with new settings
    categoriesCache = null;
    setTimeout(() => {
      showView('clip');
      fetchCategories();
    }, 600);
  });
});

// ---- Pill toggle ----

pills.forEach((pill) => {
  pill.addEventListener('click', () => {
    pills.forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    selectedStatus = pill.dataset.status;
  });
});

// ---- Fetch categories ----

async function fetchCategories() {
  if (categoriesCache) {
    populateCategories(categoriesCache);
    return;
  }

  const data = await chrome.storage.sync.get(['apiUrl', 'apiToken']);
  if (!data.apiUrl || !data.apiToken) return;

  try {
    const resp = await fetch(`${data.apiUrl}/api/admin/categories`, {
      headers: { Authorization: `Bearer ${data.apiToken}` },
    });
    if (!resp.ok) return;

    const json = await resp.json();
    if (json.categories) {
      categoriesCache = json.categories;
      populateCategories(json.categories);
    }
  } catch {
    // Silently fail — categories are optional
  }
}

function populateCategories(categories) {
  // Keep the default option
  selectCategory.innerHTML = '<option value="">未分类</option>';
  categories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = cat.name;
    selectCategory.appendChild(opt);
  });
}

// ---- Auto-fill title from active tab ----

async function fillTitle() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.title) {
      inputTitle.value = tab.title;
    }
  } catch {
    // ignore
  }
}

// ---- Clip action ----

btnClip.addEventListener('click', async () => {
  const data = await chrome.storage.sync.get(['apiUrl', 'apiToken']);
  if (!data.apiUrl || !data.apiToken) {
    showView('settings');
    showToast('请先配置 API 信息');
    return;
  }

  const title = inputTitle.value.trim();
  if (!title) {
    inputTitle.focus();
    return;
  }

  showView('progress');
  progressText.textContent = '正在提取内容...';
  progressDetail.textContent = '';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'clip',
      title: title,
      category: selectCategory.value,
      status: selectedStatus,
    });

    if (response && response.success) {
      const apiUrl = data.apiUrl;
      const editUrl = `${apiUrl}/editor?edit=${response.slug}`;
      const viewUrl = `${apiUrl}/${response.slug}`;

      successTitle.textContent = response.title || title;
      successDetail.textContent = response.imageCount > 0
        ? `上传了 ${response.imageCount} 张图片`
        : '内容已保存';

      btnEdit.href = editUrl;
      btnView.href = viewUrl;

      // 剪藏成功后自动打开草稿编辑页并关闭弹窗
      // 若 tabs API 不可用或被阻止，则优雅降级到原有 success 视图
      try {
        chrome.tabs.create({ url: editUrl, active: true }, () => {
          if (chrome.runtime.lastError) {
            showView('success');
            return;
          }
          window.close();
        });
      } catch (e) {
        showView('success');
      }
    } else {
      errorMessage.textContent = response?.error || '剪藏失败';
      showView('error');
    }
  } catch (err) {
    errorMessage.textContent = err.message || '发生未知错误';
    showView('error');
  }
});

// ---- Success / Error buttons ----

btnDone.addEventListener('click', () => {
  window.close();
});

btnRetry.addEventListener('click', () => {
  showView('clip');
});

btnCloseError.addEventListener('click', () => {
  window.close();
});

// ---- Listen for progress updates from background ----

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'progress' && currentView === 'progress') {
    switch (msg.step) {
      case 'extracting':
        progressText.textContent = '正在提取内容...';
        progressDetail.textContent = '';
        break;
      case 'uploading':
        progressText.textContent = '正在上传图片...';
        progressDetail.textContent = msg.total > 0
          ? `${msg.current} / ${msg.total}`
          : '';
        break;
      case 'creating':
        progressText.textContent = '正在创建文章...';
        progressDetail.textContent = '';
        break;
    }
  }
});

// ---- Init ----

(async function init() {
  const data = await chrome.storage.sync.get(['apiUrl', 'apiToken']);
  if (!data.apiUrl || !data.apiToken) {
    showView('settings');
    return;
  }

  showView('clip');
  fillTitle();
  fetchCategories();
})();
