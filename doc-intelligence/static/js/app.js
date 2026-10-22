/**
 * DocAI - AI Document Intelligence Assistant JavaScript
 */

// Helper to retrieve CSRF token from cookies
function getCookie(name) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

// ==========================================================
// 1. Dark / Light Mode Toggle
// ==========================================================
function toggleDarkMode() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'light';
  const newTheme = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('themeIcon');
  if (!icon) return;
  if (theme === 'dark') {
    icon.className = 'fa-solid fa-sun text-warning';
  } else {
    icon.className = 'fa-solid fa-moon text-dark';
  }
}

// ==========================================================
// 2. Speech Recognition (Speech-to-Text)
// ==========================================================
let recognition = null;

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = function(e) {
      const transcript = e.results[0][0].transcript;
      const input = document.getElementById('questionInput');
      if (input) {
        input.value = transcript;
        input.focus();
      }
      showToast('Voice captured: "' + transcript + '"', 'info');
    };

    recognition.onerror = function(e) {
      console.warn('Speech recognition error:', e.error);
      const btn = document.getElementById('micBtn');
      if (btn) btn.classList.remove('recording');
      showToast('Microphone error: ' + e.error, 'danger');
    };

    recognition.onend = function() {
      const btn = document.getElementById('micBtn');
      if (btn) btn.classList.remove('recording');
    };
  }
}

function startVoiceInput() {
  if (!recognition) {
    alert('Voice input is not supported or permitted in this browser.');
    return;
  }
  const btn = document.getElementById('micBtn');
  try {
    if (btn) btn.classList.add('recording');
    recognition.start();
  } catch (err) {
    console.warn('Recognition start issue:', err);
    if (btn) btn.classList.remove('recording');
  }
}

// ==========================================================
// 3. Text-to-Speech (Voice Output)
// ==========================================================
function speakText(text) {
  if (!('speechSynthesis' in window)) {
    showToast('Text-to-speech not supported on this browser.', 'warning');
    return;
  }
  window.speechSynthesis.cancel(); // Stop any ongoing speech
  // Clean text from markdown or code
  const clean = text.replace(/[*_#`]/g, '');
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

// ==========================================================
// 4. Markdown-to-HTML Renderer (for Gemini answers)
// ==========================================================
function renderMarkdown(text) {
  if (!text) return '';

  let html = text;

  // Escape HTML special chars first (except we'll selectively re-insert tags)
  // We process line-by-line to handle block elements correctly
  const lines = html.split('\n');
  const result = [];
  let inList = false;
  let inOrderedList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Escape HTML entities in the raw line
    line = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Headings
    if (/^### (.+)/.test(line)) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
      result.push('<h6 class="fw-bold mt-3 mb-1">' + line.replace(/^### /, '') + '</h6>');
      continue;
    }
    if (/^## (.+)/.test(line)) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
      result.push('<h5 class="fw-bold mt-3 mb-1">' + line.replace(/^## /, '') + '</h5>');
      continue;
    }
    if (/^# (.+)/.test(line)) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
      result.push('<h4 class="fw-bold mt-3 mb-1">' + line.replace(/^# /, '') + '</h4>');
      continue;
    }

    // Unordered list items: - item or * item
    if (/^[\*\-] (.+)/.test(line)) {
      if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
      if (!inList) { result.push('<ul class="mb-2 ps-3">'); inList = true; }
      result.push('<li>' + applyInlineMarkdown(line.replace(/^[\*\-] /, '')) + '</li>');
      continue;
    }

    // Ordered list items: 1. item
    if (/^\d+\. (.+)/.test(line)) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (!inOrderedList) { result.push('<ol class="mb-2 ps-3">'); inOrderedList = true; }
      result.push('<li>' + applyInlineMarkdown(line.replace(/^\d+\. /, '')) + '</li>');
      continue;
    }

    // Close open lists
    if (inList) { result.push('</ul>'); inList = false; }
    if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      result.push('<hr class="my-2">');
      continue;
    }

    // Blank line → paragraph break
    if (line.trim() === '') {
      // Add spacing between blocks
      if (result.length > 0 && result[result.length - 1] !== '<br>') {
        result.push('<div class="mb-2"></div>');
      }
      continue;
    }

    // Regular paragraph line with inline formatting
    result.push('<span>' + applyInlineMarkdown(line) + '</span><br>');
  }

  if (inList) result.push('</ul>');
  if (inOrderedList) result.push('</ol>');

  return result.join('\n');
}

function applyInlineMarkdown(text) {
  // Bold+italic: ***text***
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* or _text_
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/_(.+?)_/g, '<em>$1</em>');
  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, '<code class="bg-secondary bg-opacity-25 px-1 rounded small">$1</code>');
  return text;
}

// ==========================================================
// 5. Keyword Highlighting
// ==========================================================
function highlightKeywords(text, keywords) {
  if (!text) return '';
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return escapeHtml(text);
  }

  let escaped = escapeHtml(text);
  // Sort keywords by length descending to prevent partial match overwrites
  const sorted = [...keywords].sort((a, b) => b.length - a.length);

  sorted.forEach(kw => {
    if (kw && kw.trim().length > 1) {
      const safeKw = escapeRegExp(kw.trim());
      const regex = new RegExp(`(${safeKw})`, 'gi');
      escaped = escaped.replace(regex, '<mark class="keyword-highlight">$1</mark>');
    }
  });

  return escaped;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ==========================================================
// 5. Chat Interaction (Send Question & Render Responses)
// ==========================================================
function handleSend() {
  const input = document.getElementById('questionInput');
  if (!input) return;
  const question = input.value.trim();
  if (question) {
    input.value = '';
    sendQuestion(question);
  }
}

async function sendQuestion(question) {
  if (!question || typeof DOC_ID === 'undefined' || !DOC_ID) return;

  const chatContainer = document.getElementById('chatContainer');
  if (!chatContainer) return;

  // 1. Render User Message Bubble
  const userBubble = document.createElement('div');
  userBubble.className = 'user-message';
  userBubble.innerHTML = `
    <div class="fw-semibold small mb-1 opacity-75">You</div>
    <div>${escapeHtml(question)}</div>
  `;
  chatContainer.appendChild(userBubble);

  // 2. Render Typing Indicator
  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'typing-indicator';
  typingIndicator.id = 'activeTypingIndicator';
  typingIndicator.innerHTML = `
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <span class="small text-secondary ms-2">DocAI is thinking...</span>
  `;
  chatContainer.appendChild(typingIndicator);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // Disable send button while answering
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const csrfToken = getCookie('csrftoken');
    const response = await fetch('/ask/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken || ''
      },
      body: JSON.stringify({
        question: question,
        doc_id: DOC_ID
      })
    });

    const data = await response.json();

    // 4. Remove Typing Indicator
    if (typingIndicator.parentNode) {
      typingIndicator.remove();
    }

    if (data.status === 'success') {
      // 5. Render AI Message Bubble
      const answerBubble = document.createElement('div');
      answerBubble.className = 'ai-message';

      const sourcesList = data.sources || [];
      const sourcesId = 'sources_' + Date.now();

      // Render markdown formatting in the answer
      const formattedAnswer = renderMarkdown(data.answer);

      let sourcesHtml = '';
      if (sourcesList.length > 0) {
        sourcesHtml = `
          <div class="mt-3 pt-2 border-top" style="border-color: var(--border-color) !important;">
            <button class="btn btn-sm btn-link p-0 text-decoration-none text-primary fw-semibold" type="button" data-bs-toggle="collapse" data-bs-target="#${sourcesId}">
              <i class="fa-solid fa-file-invoice me-1"></i> View ${sourcesList.length} Source Excerpt${sourcesList.length > 1 ? 's' : ''} (RAG References)
            </button>
            <div class="collapse mt-2" id="${sourcesId}">
              ${sourcesList.map((s, idx) => `
                <div class="source-chunk">
                  <div class="d-flex justify-content-between small text-secondary mb-1">
                    <span><strong>Chunk #${idx + 1}</strong></span>
                    ${s.keywords && s.keywords.length ? `<span class="badge bg-secondary-subtle text-secondary">Keywords: ${s.keywords.slice(0, 4).join(', ')}</span>` : ''}
                  </div>
                  <div>${highlightKeywords(s.text, s.keywords || [])}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      answerBubble.innerHTML = `
        <div class="d-flex align-items-center justify-content-between mb-2">
          <span class="fw-bold text-primary small d-flex align-items-center gap-1">
            <i class="fa-solid fa-robot"></i> DocAI Assistant
          </span>
          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-sm btn-outline-secondary rounded-circle tts-btn" title="Read Aloud" style="width: 30px; height: 30px; padding: 0;">
              <i class="fa-solid fa-volume-high"></i>
            </button>
          </div>
        </div>
        <div class="chat-answer-text">${formattedAnswer}</div>
        ${sourcesHtml}
      `;

      // Attach speakText listener cleanly
      const ttsBtn = answerBubble.querySelector('.tts-btn');
      if (ttsBtn) {
        ttsBtn.onclick = () => speakText(data.answer);
      }

      chatContainer.appendChild(answerBubble);

      // Update language badge if returned
      if (data.language) {
        const langBadge = document.getElementById('languageBadge');
        if (langBadge) {
          langBadge.innerHTML = `<i class="fa-solid fa-language me-1"></i> Lang: ${data.language.toUpperCase()}`;
        }
      }
    } else {
      // Error message bubble
      const errBubble = document.createElement('div');
      errBubble.className = 'ai-message text-danger';
      errBubble.innerHTML = `
        <div class="fw-bold small mb-1"><i class="fa-solid fa-triangle-exclamation me-1"></i> Error</div>
        <div>${escapeHtml(data.message || 'Failed to generate response.')}</div>
      `;
      chatContainer.appendChild(errBubble);
    }
  } catch (err) {
    if (typingIndicator.parentNode) typingIndicator.remove();
    console.error('sendQuestion error:', err);
    showToast('Failed to contact server: ' + err.message, 'danger');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

// ==========================================================
// 6. Suggested Questions Chips
// ==========================================================
function loadSuggestedQuestions(questions) {
  const container = document.getElementById('suggestedQuestions');
  if (!container || !questions || !Array.isArray(questions)) return;

  container.innerHTML = '';
  questions.forEach(q => {
    if (!q) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'question-chip shadow-sm';
    chip.innerHTML = `<i class="fa-regular fa-comment-dots me-1"></i> ${escapeHtml(q)}`;
    chip.onclick = () => {
      const input = document.getElementById('questionInput');
      if (input) input.value = '';
      sendQuestion(q);
    };
    container.appendChild(chip);
  });
}

// ==========================================================
// 7. File Upload & Drag-and-Drop
// ==========================================================
function initFileUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  if (!dropZone || !fileInput) return;

  // Drag over
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  // Drag leave
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  // Drop
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  // Click on drop zone
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // File chosen via browser dialog
  fileInput.addEventListener('change', e => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
  });
}

async function uploadFile(file) {
  if (!file) return;

  const validExts = ['pdf', 'txt'];
  const ext = file.name.split('.').pop().toLowerCase();
  if (!validExts.includes(ext)) {
    showToast('Invalid file type! Please upload a PDF or TXT file.', 'danger');
    return;
  }

  const progressBar = document.getElementById('uploadProgress');
  const statusMsg = document.getElementById('uploadStatus');
  const uploadSpinner = document.getElementById('uploadSpinner');
  const uploadIcon = document.getElementById('uploadIcon');
  const uploadBtn = document.getElementById('uploadBtn');

  if (progressBar) progressBar.classList.remove('d-none');
  if (uploadSpinner) uploadSpinner.classList.remove('d-none');
  if (uploadIcon) uploadIcon.classList.add('d-none');
  if (uploadBtn) uploadBtn.disabled = true;
  if (statusMsg) statusMsg.textContent = `Uploading and processing "${file.name}" with Gemini...`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const csrfToken = getCookie('csrftoken');
    const response = await fetch('/upload/', {
      method: 'POST',
      headers: {
        'X-CSRFToken': csrfToken || ''
      },
      body: formData
    });

    const data = await response.json();

    if (data.status === 'success') {
      showToast(`Document "${data.title}" processed successfully!`, 'success');
      if (statusMsg) statusMsg.textContent = 'Redirecting to document chat...';
      setTimeout(() => {
        window.location.href = `/chat/${data.doc_id}/`;
      }, 1000);
    } else {
      showToast(data.message || 'Upload failed', 'danger');
      if (statusMsg) statusMsg.textContent = 'Error: ' + (data.message || 'Failed');
    }
  } catch (err) {
    console.error('Upload error:', err);
    showToast('Upload error: ' + err.message, 'danger');
    if (statusMsg) statusMsg.textContent = 'Upload error occurred.';
  } finally {
    if (progressBar) progressBar.classList.add('d-none');
    if (uploadSpinner) uploadSpinner.classList.add('d-none');
    if (uploadIcon) uploadIcon.classList.remove('d-none');
    if (uploadBtn) uploadBtn.disabled = false;
  }
}

// ==========================================================
// 8. Document List Management
// ==========================================================
async function loadDocuments() {
  const grid = document.getElementById('documentsGrid');
  if (!grid) return;

  try {
    const response = await fetch('/documents/');
    const data = await response.json();

    if (data.status === 'success') {
      const docs = data.documents || [];
      if (docs.length === 0) {
        grid.innerHTML = `
          <div class="col-12 text-center py-5">
            <i class="fa-regular fa-folder-open fs-1 text-secondary mb-3"></i>
            <h6 class="fw-semibold text-secondary">No documents uploaded yet</h6>
            <p class="small text-secondary">Upload your first PDF or TXT document using the box on the left.</p>
          </div>
        `;
        return;
      }

      grid.innerHTML = docs.map(doc => `
        <div class="col-md-6" id="doc_card_${doc.id}">
          <div class="card doc-card shadow-sm rounded-4 h-100">
            <div class="card-body p-3 d-flex flex-column">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <span class="badge ${doc.file_type === 'PDF' ? 'bg-danger' : 'bg-primary'} px-2 py-1">${doc.file_type}</span>
                <span class="text-secondary small">${doc.uploaded_at}</span>
              </div>
              <h6 class="fw-bold mb-2 text-truncate" title="${escapeHtml(doc.title)}">
                <i class="fa-regular fa-file me-1 text-primary"></i> ${escapeHtml(doc.title)}
              </h6>
              <p class="small text-secondary mb-3">
                ${doc.questions_count} AI questions suggested
              </p>
              <div class="mt-auto d-flex gap-2">
                <a href="/chat/${doc.id}/" class="btn btn-sm btn-primary rounded-pill flex-grow-1">
                  <i class="fa-regular fa-comments me-1"></i> Open Chat
                </a>
                <button class="btn btn-sm btn-outline-danger rounded-pill px-3" onclick="deleteDocument(${doc.id}, '${escapeHtml(doc.title)}')" title="Delete Document">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      grid.innerHTML = `<div class="col-12 text-center py-4 text-danger">${escapeHtml(data.message || 'Failed to load documents')}</div>`;
    }
  } catch (err) {
    console.error('loadDocuments error:', err);
    grid.innerHTML = `<div class="col-12 text-center py-4 text-danger">Error loading documents: ${escapeHtml(err.message)}</div>`;
  }
}

async function deleteDocument(docId, title) {
  if (!confirm(`Are you sure you want to delete "${title}" and its RAG vector embeddings?`)) {
    return;
  }

  try {
    const csrfToken = getCookie('csrftoken');
    const response = await fetch(`/delete/${docId}/`, {
      method: 'POST',
      headers: {
        'X-CSRFToken': csrfToken || ''
      }
    });

    const data = await response.json();
    if (data.status === 'success') {
      showToast(`Document "${title}" removed successfully.`, 'success');
      loadDocuments();
    } else {
      showToast(data.message || 'Failed to delete document', 'danger');
    }
  } catch (err) {
    showToast('Error deleting document: ' + err.message, 'danger');
  }
}

// ==========================================================
// 9. Chat History Retrieval
// ==========================================================
async function loadChatHistory(docId) {
  const container = document.getElementById('historyContent');
  if (!container) return;

  container.innerHTML = `
    <div class="text-center py-4">
      <div class="spinner-border text-primary" role="status"></div>
      <p class="small text-secondary mt-2">Loading past interactions...</p>
    </div>
  `;

  try {
    const response = await fetch(`/history/${docId}/`);
    const data = await response.json();

    if (data.status === 'success') {
      const history = data.history || [];
      if (history.length === 0) {
        container.innerHTML = `
          <div class="text-center py-4 text-secondary">
            <i class="fa-regular fa-message fs-2 mb-2"></i>
            <p>No chat history yet for this document. Ask a question to get started!</p>
          </div>
        `;
        return;
      }

      container.innerHTML = history.map(item => `
        <div class="border rounded-3 p-3 mb-3 shadow-sm" style="border-color: var(--border-color) !important; background: var(--bg-secondary);">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="badge bg-primary-subtle text-primary small">Lang: ${(item.language || 'en').toUpperCase()}</span>
            <span class="small text-secondary">${item.created_at}</span>
          </div>
          <div class="mb-2">
            <strong><i class="fa-solid fa-user text-primary me-1"></i> Q:</strong> ${escapeHtml(item.question)}
          </div>
          <div class="mb-2">
            <strong><i class="fa-solid fa-robot text-success me-1"></i> A:</strong> ${escapeHtml(item.answer).replace(/\n/g, '<br>')}
          </div>
          ${item.sources && item.sources.length ? `
            <div class="small text-secondary mt-2">
              <i class="fa-solid fa-book-open me-1"></i> ${item.sources.length} source chunk(s) referenced.
            </div>
          ` : ''}
        </div>
      `).join('');
    } else {
      container.innerHTML = `<div class="text-danger">${escapeHtml(data.message || 'Failed to retrieve history')}</div>`;
    }
  } catch (err) {
    container.innerHTML = `<div class="text-danger">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ==========================================================
// 10. Toast Notification System
// ==========================================================
function showToast(message, type = 'success') {
  const toastEl = document.getElementById('liveToast');
  const toastMsg = document.getElementById('toastMessage');
  if (!toastEl || !toastMsg) return;

  const bgClasses = {
    success: 'bg-success',
    danger: 'bg-danger',
    info: 'bg-primary',
    warning: 'bg-warning text-dark'
  };

  // Reset classes
  toastEl.className = 'toast align-items-center border-0 shadow-lg text-white ' + (bgClasses[type] || 'bg-success');
  toastMsg.innerHTML = `<i class="fa-solid fa-circle-info me-2"></i><span>${escapeHtml(message)}</span>`;

  const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
  toast.show();
}

// ==========================================================
// 11. Initialization on DOM Loaded
// ==========================================================
document.addEventListener('DOMContentLoaded', function() {
  // Restore saved theme
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  // Initialize Speech Recognition
  initSpeechRecognition();

  // If on index page: initialize upload and load documents
  if (document.getElementById('dropZone')) {
    initFileUpload();
    loadDocuments();
  }

  // If on chat page: initialize suggested questions
  if (typeof SUGGESTED_QUESTIONS !== 'undefined' && SUGGESTED_QUESTIONS) {
    loadSuggestedQuestions(SUGGESTED_QUESTIONS);
  }
});
