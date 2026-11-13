const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const DATA_DIRECTORY = path.join(__dirname, 'data');
const TASKS_FILE = path.join(DATA_DIRECTORY, 'tasks.json');
const MAX_BODY_BYTES = 16 * 1024;
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8']
};
const priorities = new Set(['low', 'medium', 'high']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let tasks = [];
let taskQueue = Promise.resolve();

function serializeTaskOperation(operation) {
  const result = taskQueue.then(operation);
  taskQueue = result.then(() => undefined, () => undefined);
  return result;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(value === null ? '' : JSON.stringify(value));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function validateTaskInput(input, partial) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Task details must be a JSON object.');
  }

  const result = {};
  if (!partial || Object.hasOwn(input, 'title')) {
    if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.trim().length > 100) {
      throw new HttpError(400, 'Task title must be between 1 and 100 characters.');
    }
    result.title = input.title.trim();
  }
  if (!partial || Object.hasOwn(input, 'description')) {
    if (input.description !== undefined && typeof input.description !== 'string') {
      throw new HttpError(400, 'Task notes must be text.');
    }
    const description = (input.description || '').trim();
    if (description.length > 400) {
      throw new HttpError(400, 'Task notes must be 400 characters or fewer.');
    }
    result.description = description;
  }
  if (!partial || Object.hasOwn(input, 'date')) {
    const date = input.date === undefined ? '' : input.date;
    if (typeof date !== 'string' || (date !== '' && !isValidDate(date))) {
      throw new HttpError(400, 'Due date must be a valid YYYY-MM-DD date.');
    }
    result.date = date;
  }
  if (!partial || Object.hasOwn(input, 'priority')) {
    const priority = input.priority === undefined ? 'medium' : input.priority;
    if (typeof priority !== 'string' || !priorities.has(priority)) {
      throw new HttpError(400, 'Priority must be low, medium, or high.');
    }
    result.priority = priority;
  }
  if (partial && Object.hasOwn(input, 'completed')) {
    if (typeof input.completed !== 'boolean') {
      throw new HttpError(400, 'Task completion must be true or false.');
    }
    result.completed = input.completed;
  }
  if (partial && Object.keys(result).length === 0) {
    throw new HttpError(400, 'Provide at least one task field to update.');
  }
  return result;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function persistTasks(nextTasks) {
  const temporaryFile = `${TASKS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(nextTasks, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryFile, TASKS_FILE);
}

function createPlan(goal) {
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

async function serveStaticFile(request, response, pathname) {
  const file = staticFiles[pathname];
  if (!file) return false;
  const [filename, contentType] = file;
  const content = await fs.readFile(path.join(__dirname, filename));
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(request.method === 'HEAD' ? undefined : content);
  return true;
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;
    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);

    if (pathname === '/api/tasks' && request.method === 'GET') {
      const currentTasks = await serializeTaskOperation(() => tasks.map((task) => ({ ...task })));
      sendJson(response, 200, currentTasks);
      return;
    }

    if (pathname === '/api/tasks' && request.method === 'POST') {
      const values = validateTaskInput(await readJsonBody(request), false);
      const task = {
        id: randomUUID(),
        ...values,
        completed: false,
        createdAt: Date.now()
      };
      await serializeTaskOperation(async () => {
        const nextTasks = [task, ...tasks];
        await persistTasks(nextTasks);
        tasks = nextTasks;
      });
      sendJson(response, 201, task);
      return;
    }

    if (taskMatch && request.method === 'PATCH') {
      let id;
      try {
        id = decodeURIComponent(taskMatch[1]);
      } catch {
        throw new HttpError(400, 'Task ID is not valid.');
      }
      const changes = validateTaskInput(await readJsonBody(request), true);
      const updatedTask = await serializeTaskOperation(async () => {
        const index = tasks.findIndex((task) => task.id === id);
        if (index === -1) throw new HttpError(404, 'Task not found.');
        const nextTasks = [...tasks];
        nextTasks[index] = { ...nextTasks[index], ...changes };
        await persistTasks(nextTasks);
        tasks = nextTasks;
        return nextTasks[index];
      });
      sendJson(response, 200, updatedTask);
      return;
    }

    if (taskMatch && request.method === 'DELETE') {
      let id;
      try {
        id = decodeURIComponent(taskMatch[1]);
      } catch {
        throw new HttpError(400, 'Task ID is not valid.');
      }
      await serializeTaskOperation(async () => {
        const nextTasks = tasks.filter((task) => task.id !== id);
        if (nextTasks.length === tasks.length) throw new HttpError(404, 'Task not found.');
        await persistTasks(nextTasks);
        tasks = nextTasks;
      });
      sendJson(response, 204, null);
      return;
    }

    if (pathname === '/api/plan' && request.method === 'POST') {
      const input = await readJsonBody(request);
      if (!input || typeof input.goal !== 'string' || input.goal.trim().length === 0 || input.goal.trim().length > 160) {
        throw new HttpError(400, 'Goal must be between 1 and 160 characters.');
      }
      sendJson(response, 200, { suggestions: createPlan(input.goal.trim()) });
      return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (await serveStaticFile(request, response, pathname)) return;
    }
    sendError(response, 404, 'Not found.');
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof HttpError) {
      sendError(response, error.status, error.message);
      return;
    }
    console.error('Request failed:', error);
    sendError(response, 500, 'The server could not complete the request.');
  }
}

async function startServer() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be a number between 1 and 65535.');
  }
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });
  try {
    const savedTasks = JSON.parse(await fs.readFile(TASKS_FILE, 'utf8'));
    if (!Array.isArray(savedTasks)) throw new Error('Task data must be a JSON array.');
    tasks = savedTasks;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await persistTasks([]);
  }

  const server = http.createServer(handleRequest);
  server.on('error', (error) => {
    console.error('Could not start the task organizer server:', error);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Daylight is running at http://${HOST}:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Could not initialize the task organizer:', error);
  process.exitCode = 1;
});
