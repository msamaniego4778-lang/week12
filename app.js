const THEME_KEY = 'daylight-organizer-theme-v1';
const TASKS_KEY = 'daylight-organizer-tasks-v1';
const priorityOrder = { high: 0, medium: 1, low: 2 };

const taskList = document.querySelector('#task-list');
const taskDialog = document.querySelector('#task-dialog');
const taskForm = document.querySelector('#task-form');
const assistantForm = document.querySelector('#assistant-form');
const assistantResult = document.querySelector('#assistant-result');
const appStatus = document.querySelector('#app-status');
let tasks = [];
let activeFilter = 'all';
let loadState = 'loading';
let useBrowserStorage = false;

function loadBrowserTasks() {
  const saved = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]');
  if (!Array.isArray(saved)) throw new Error('Saved browser tasks are not in the expected format.');
  return saved.filter((task) => task && typeof task.id === 'string'
    && typeof task.title === 'string' && typeof task.completed === 'boolean'
    && ['low', 'medium', 'high'].includes(task.priority));
}

function saveBrowserTasks(nextTasks) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(nextTasks));
}

function createBrowserTask(values) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: values.title,
    description: values.description || '',
    date: values.date || '',
    priority: values.priority || 'medium',
    completed: false,
    createdAt: Date.now()
  };
}

async function browserStorageRequest(path, options) {
  const method = options.method || 'GET';
  const taskPath = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (path === '/api/tasks' && method === 'GET') return loadBrowserTasks();
  if (path === '/api/tasks' && method === 'POST') {
    const task = createBrowserTask(JSON.parse(options.body));
    const nextTasks = [task, ...loadBrowserTasks()];
    saveBrowserTasks(nextTasks);
    return task;
  }
  if (taskPath && method === 'PATCH') {
    const id = decodeURIComponent(taskPath[1]);
    const changes = JSON.parse(options.body);
    const currentTasks = loadBrowserTasks();
    const index = currentTasks.findIndex((task) => task.id === id);
    if (index === -1) throw new Error('Task not found.');
    currentTasks[index] = { ...currentTasks[index], ...changes };
    saveBrowserTasks(currentTasks);
    return currentTasks[index];
  }
  if (taskPath && method === 'DELETE') {
    const id = decodeURIComponent(taskPath[1]);
    const currentTasks = loadBrowserTasks();
    const nextTasks = currentTasks.filter((task) => task.id !== id);
    if (nextTasks.length === currentTasks.length) throw new Error('Task not found.');
    saveBrowserTasks(nextTasks);
    return null;
  }
  if (path === '/api/plan' && method === 'POST') {
    const input = JSON.parse(options.body);
    return { suggestions: makeSuggestions(input.goal) };
  }
  throw new Error('This action is not available in browser storage mode.');
}

async function apiRequest(path, options = {}) {
  if (useBrowserStorage) return browserStorageRequest(path, options);
  const requestOptions = { ...options };
  requestOptions.headers = { ...(requestOptions.headers || {}) };
  if (requestOptions.body) requestOptions.headers['Content-Type'] = 'application/json';
  const response = await fetch(path, requestOptions);
  const responseText = await response.text();
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const errorResult = JSON.parse(responseText);
      if (errorResult.error) message = errorResult.error;
    } catch {
      // Non-JSON error pages are expected on static hosts without an API.
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  let result = null;
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('The server returned an invalid response.');
    }
  }
  return result;
}

function showStatus(message, isError) {
  appStatus.textContent = message;
  appStatus.hidden = !message;
  appStatus.setAttribute('role', isError ? 'alert' : 'status');
  appStatus.classList.toggle('info', Boolean(message) && !isError);
}

function clearStatus() {
  if (useBrowserStorage) {
    showStatus('This site has no task server. Tasks are saved only in this browser.', false);
  } else {
    showStatus('', false);
  }
}

async function loadTasks() {
  loadState = 'loading';
  renderTasks();
  try {
    tasks = await apiRequest('/api/tasks');
    loadState = 'ready';
    clearStatus();
  } catch (error) {
    if (error.status === 404) {
      useBrowserStorage = true;
      try {
        tasks = await apiRequest('/api/tasks');
        loadState = 'ready';
        clearStatus();
      } catch (storageError) {
        loadState = 'error';
        showStatus(`Could not load browser tasks: ${storageError.message}`, true);
      }
    } else {
      loadState = 'error';
      showStatus(`Could not load tasks: ${error.message}`, true);
    }
  }
  renderTasks();
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatDueDate(dateValue) {
  if (!dateValue) return '';
  const due = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(due.getTime())) return '';
  const today = new Date();
  const todayString = localDateString(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateValue === todayString) return 'Today';
  if (dateValue === localDateString(tomorrow)) return 'Tomorrow';
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderTasks() {
  const query = document.querySelector('#search-input').value.trim().toLowerCase();
  const priority = document.querySelector('#priority-filter').value;
  const sortBy = document.querySelector('#sort-select').value;
  const today = localDateString(new Date());
  let visibleTasks = tasks.filter((task) => {
    const matchesQuery = `${task.title} ${task.description || ''}`.toLowerCase().includes(query);
    const matchesPriority = priority === 'all' || task.priority === priority;
    let matchesView = true;
    if (activeFilter === 'today') matchesView = task.date === today && !task.completed;
    if (activeFilter === 'upcoming') matchesView = Boolean(task.date && task.date > today && !task.completed);
    if (activeFilter === 'completed') matchesView = task.completed;
    return matchesQuery && matchesPriority && matchesView;
  });

  visibleTasks = [...visibleTasks].sort((a, b) => {
    if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
    if (sortBy === 'priority') return priorityOrder[a.priority] - priorityOrder[b.priority];
    if (sortBy === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
    return (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31');
  });

  document.querySelector('#visible-count').textContent = visibleTasks.length;
  document.querySelector('#all-count').textContent = tasks.filter((task) => !task.completed).length;
  document.querySelector('#today-count').textContent = tasks.filter((task) => task.date === today && !task.completed).length;
  taskList.innerHTML = '';

  if (loadState === 'loading') {
    taskList.innerHTML = '<div class="empty-state"><p>Loading your tasks…</p></div>';
    return;
  }
  if (loadState === 'error') {
    taskList.innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">!</div><h3>Your tasks are unavailable</h3><p>Check that the server is running, then try again.</p><button class="retry-load" type="button">Retry</button></div>';
    return;
  }
  if (visibleTasks.length === 0) {
    const hasFilters = query || priority !== 'all';
    const emptyTitle = hasFilters ? 'No matching tasks' : emptyStateTitle();
    const emptyCopy = hasFilters
      ? 'Try another search or filter.'
      : 'Add a task or ask your planner to help you get started.';
    taskList.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">✳</div><h3>${emptyTitle}</h3><p>${emptyCopy}</p></div>`;
    return;
  }

  taskList.innerHTML = visibleTasks.map((task) => {
    const dateText = formatDueDate(task.date);
    const isOverdue = task.date && task.date < today && !task.completed;
    return `
      <article class="task-card${task.completed ? ' is-completed' : ''}" data-id="${escapeHTML(task.id)}">
        <button class="task-check" data-action="toggle" aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}: ${escapeHTML(task.title)}">${task.completed ? '✓' : ''}</button>
        <div class="task-main">
          <p class="task-title">${escapeHTML(task.title)}</p>
          ${task.description ? `<p class="task-description">${escapeHTML(task.description)}</p>` : ''}
        </div>
        <div class="task-meta">
          ${dateText ? `<span class="task-date${isOverdue ? ' overdue' : ''}">${isOverdue ? 'Overdue · ' : ''}${dateText}</span>` : ''}
          <span class="priority-pill priority-${task.priority}">${task.priority}</span>
          <div class="task-actions">
            <button data-action="edit" aria-label="Edit ${escapeHTML(task.title)}" title="Edit task">✎</button>
            <button class="delete-task" data-action="delete" aria-label="Delete ${escapeHTML(task.title)}" title="Delete task">×</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

function emptyStateTitle() {
  if (activeFilter === 'today') return 'Nothing on your plate today';
  if (activeFilter === 'upcoming') return 'No upcoming tasks';
  if (activeFilter === 'completed') return 'No completed tasks yet';
  return 'Your day, at a glance';
}

function makeSuggestions(goal) {
  const normalized = goal.toLowerCase();
  if (/launch|project|product|website|app/.test(normalized)) {
    return ['Define the goal and success criteria', 'Break the work into milestones', 'Gather the tools and resources you need', 'Review progress and decide the next step'];
  }
  if (/study|exam|learn|course|class/.test(normalized)) {
    return ['Gather your study materials', 'Break the topic into focused sections', 'Schedule a short study session', 'Review what you learned'];
  }
  if (/trip|travel|vacation|holiday/.test(normalized)) {
    return ['Choose dates and set a budget', 'Research and book transportation', 'Plan where you will stay', 'Make a packing checklist'];
  }
  if (/clean|organ|tidy|declutter/.test(normalized)) {
    return ['Pick one area to start with', 'Gather supplies and sort what you have', 'Clean or organize the first area', 'Set aside items to donate or put away'];
  }
  if (/write|essay|report|blog|article/.test(normalized)) {
    return ['Choose the main point and audience', 'Outline the key sections', 'Write a first draft', 'Review and polish the draft'];
  }
  return ['Clarify what success looks like', 'List the first few steps', 'Set aside time for the first step', 'Check your progress and adjust the plan'];
}

function openTaskDialog(task) {
  taskForm.reset();
  const dialogStatus = document.querySelector('#dialog-status');
  dialogStatus.textContent = '';
  dialogStatus.hidden = true;
  document.querySelector('#task-id').value = task ? task.id : '';
  document.querySelector('#task-title').value = task ? task.title : '';
  document.querySelector('#task-description').value = task ? task.description || '' : '';
  document.querySelector('#task-date').value = task ? task.date || '' : '';
  document.querySelector('#task-priority').value = task ? task.priority : 'medium';
  document.querySelector('#dialog-title').textContent = task ? 'Edit task' : 'Create a task';
  document.querySelector('#save-task-button').textContent = task ? 'Save changes' : 'Save task';
  taskDialog.showModal();
  document.querySelector('#task-title').focus();
}

async function createTask(title, options) {
  const task = await apiRequest('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description: options.description || '',
      date: options.date || '',
      priority: options.priority || 'medium'
    })
  });
  tasks.unshift(task);
  clearStatus();
  renderTasks();
  return task;
}

document.querySelector('#add-task-button').addEventListener('click', () => openTaskDialog());
document.querySelectorAll('.close-dialog').forEach((button) => {
  button.addEventListener('click', () => taskDialog.close());
});

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveButton = document.querySelector('#save-task-button');
  const id = document.querySelector('#task-id').value;
  const title = document.querySelector('#task-title').value.trim();
  if (!title) return;
  const changes = {
    title,
    description: document.querySelector('#task-description').value.trim(),
    date: document.querySelector('#task-date').value,
    priority: document.querySelector('#task-priority').value
  };
  saveButton.disabled = true;
  try {
    if (id) {
      const updatedTask = await apiRequest(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes)
      });
      tasks = tasks.map((task) => task.id === id ? updatedTask : task);
    } else {
      await createTask(title, changes);
    }
    clearStatus();
    renderTasks();
    taskDialog.close();
  } catch (error) {
    const dialogStatus = document.querySelector('#dialog-status');
    dialogStatus.textContent = `Could not save task: ${error.message}`;
    dialogStatus.hidden = false;
  } finally {
    saveButton.disabled = false;
  }
});

taskList.addEventListener('click', async (event) => {
  if (event.target.closest('.retry-load')) {
    loadTasks();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const card = button.closest('[data-id]');
  const task = tasks.find((item) => item.id === card.dataset.id);
  if (!task) return;
  if (button.dataset.action === 'edit') {
    openTaskDialog(task);
    return;
  }

  button.disabled = true;
  try {
    if (button.dataset.action === 'toggle') {
      const updatedTask = await apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !task.completed })
      });
      tasks = tasks.map((item) => item.id === task.id ? updatedTask : item);
    } else if (button.dataset.action === 'delete') {
      await apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
      tasks = tasks.filter((item) => item.id !== task.id);
    }
    clearStatus();
    renderTasks();
  } catch (error) {
    showStatus(`Could not update task: ${error.message}`, true);
    button.disabled = false;
  }
});

document.querySelectorAll('.nav-link').forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link === button));
    const labels = { all: 'All tasks', today: 'Today', upcoming: 'Upcoming', completed: 'Completed' };
    document.querySelector('#page-title').innerHTML = `${labels[activeFilter]} <span class="heading-sparkle" aria-hidden="true">✳</span>`;
    document.querySelector('#breadcrumb-view').textContent = labels[activeFilter];
    document.querySelector('#list-heading').textContent = activeFilter === 'all' ? 'Your tasks' : labels[activeFilter];
    renderTasks();
  });
});

document.querySelector('#search-input').addEventListener('input', renderTasks);
document.querySelector('#priority-filter').addEventListener('change', renderTasks);
document.querySelector('#sort-select').addEventListener('change', renderTasks);

assistantForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const goalInput = document.querySelector('#goal-input');
  const submitButton = assistantForm.querySelector('button[type="submit"]');
  const goal = goalInput.value.trim();
  if (!goal) return;
  submitButton.disabled = true;
  submitButton.textContent = 'Making a plan…';
  try {
    const result = await apiRequest('/api/plan', {
      method: 'POST',
      body: JSON.stringify({ goal })
    });
    assistantResult.innerHTML = `
      <p class="assistant-result-heading">A starting plan for “${escapeHTML(goal)}”</p>
      <ul class="suggestion-list">${result.suggestions.map((suggestion, index) => `
        <li><span>${index + 1}. ${escapeHTML(suggestion)}</span><button type="button" data-suggestion="${escapeHTML(suggestion)}">+ Add task</button></li>
      `).join('')}</ul>`;
    assistantResult.classList.add('visible');
    clearStatus();
  } catch (error) {
    showStatus(`Could not make a plan: ${error.message}`, true);
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Make a plan <span aria-hidden="true">→</span>';
  }
});

assistantResult.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-suggestion]');
  if (!button) return;
  button.disabled = true;
  try {
    await createTask(button.dataset.suggestion, { priority: 'medium' });
    button.textContent = 'Added';
  } catch (error) {
    button.disabled = false;
    showStatus(`Could not add suggested task: ${error.message}`, true);
  }
});

document.querySelector('#theme-button').addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  try {
    localStorage.setItem(THEME_KEY, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  } catch (error) {
    console.error('Could not save theme preference:', error);
  }
});

try {
  if (localStorage.getItem(THEME_KEY) === 'dark') document.body.classList.add('dark-mode');
} catch (error) {
  console.error('Could not load theme preference:', error);
}

document.querySelector('#today-label').textContent = new Date().toLocaleDateString(undefined, {
  weekday: 'long', month: 'long', day: 'numeric'
}).toUpperCase();
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    document.querySelector('#search-input').focus();
  }
});

loadTasks();
