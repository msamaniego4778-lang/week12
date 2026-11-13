const STORAGE_KEY = 'daylight-organizer-tasks-v1';
const THEME_KEY = 'daylight-organizer-theme-v1';
const priorityOrder = { high: 0, medium: 1, low: 2 };

const taskList = document.querySelector('#task-list');
const taskDialog = document.querySelector('#task-dialog');
const taskForm = document.querySelector('#task-form');
const assistantForm = document.querySelector('#assistant-form');
const assistantResult = document.querySelector('#assistant-result');
let tasks = loadTasks();
let activeFilter = 'all';

function loadTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter(isValidTask) : [];
  } catch (error) {
    console.error('Could not load saved tasks:', error);
    return [];
  }
}

function isValidTask(task) {
  return task && typeof task.id === 'string' && typeof task.title === 'string'
    && typeof task.completed === 'boolean'
    && ['low', 'medium', 'high'].includes(task.priority);
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (error) {
    console.error('Could not save tasks:', error);
    window.alert('Your changes could not be saved in this browser.');
  }
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

  if (visibleTasks.length === 0) {
    const emptyTitle = query || priority !== 'all' ? 'No matching tasks' : emptyStateTitle();
    const emptyCopy = query || priority !== 'all'
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

function openTaskDialog(task) {
  taskForm.reset();
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

function createTask(title, options) {
  tasks.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    description: options.description || '',
    date: options.date || '',
    priority: options.priority || 'medium',
    completed: false,
    createdAt: Date.now()
  });
  saveTasks();
  renderTasks();
}

document.querySelector('#add-task-button').addEventListener('click', () => openTaskDialog());
document.querySelectorAll('.close-dialog').forEach((button) => {
  button.addEventListener('click', () => taskDialog.close());
});

taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const id = document.querySelector('#task-id').value;
  const title = document.querySelector('#task-title').value.trim();
  if (!title) return;
  const changes = {
    title,
    description: document.querySelector('#task-description').value.trim(),
    date: document.querySelector('#task-date').value,
    priority: document.querySelector('#task-priority').value
  };
  if (id) {
    tasks = tasks.map((task) => task.id === id ? { ...task, ...changes } : task);
  } else {
    createTask(title, changes);
  }
  saveTasks();
  renderTasks();
  taskDialog.close();
});

taskList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const card = button.closest('[data-id]');
  const task = tasks.find((item) => item.id === card.dataset.id);
  if (!task) return;
  if (button.dataset.action === 'toggle') {
    task.completed = !task.completed;
    saveTasks();
    renderTasks();
  } else if (button.dataset.action === 'edit') {
    openTaskDialog(task);
  } else if (button.dataset.action === 'delete') {
    tasks = tasks.filter((item) => item.id !== task.id);
    saveTasks();
    renderTasks();
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

assistantForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const goal = document.querySelector('#goal-input').value.trim();
  if (!goal) return;
  const suggestions = makeSuggestions(goal);
  assistantResult.innerHTML = `
    <p class="assistant-result-heading">A starting plan for “${escapeHTML(goal)}”</p>
    <ul class="suggestion-list">${suggestions.map((suggestion, index) => `
      <li><span>${index + 1}. ${escapeHTML(suggestion)}</span><button type="button" data-suggestion="${escapeHTML(suggestion)}">+ Add task</button></li>
    `).join('')}</ul>`;
  assistantResult.classList.add('visible');
});

assistantResult.addEventListener('click', (event) => {
  const button = event.target.closest('[data-suggestion]');
  if (!button) return;
  createTask(button.dataset.suggestion, { priority: 'medium' });
  button.textContent = 'Added';
  button.disabled = true;
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

renderTasks();
