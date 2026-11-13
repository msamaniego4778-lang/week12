# Daylight To-do Organizer

A browser-based task organizer served by a small Node.js backend. The backend uses only Node's built-in modules; no package installation is required.

## Run locally

1. Install Node.js 18 or newer.
2. From this folder, run `npm start`.
3. Open `http://127.0.0.1:3000` in your browser.

The server stores tasks in `data/tasks.json`. It listens on `127.0.0.1` by default; set `PORT` to choose another port.

## API

- `GET /api/tasks` — list tasks
- `POST /api/tasks` — create a task
- `PATCH /api/tasks/:id` — update task fields or completion state
- `DELETE /api/tasks/:id` — delete a task
- `POST /api/plan` — generate a task checklist from a goal

The planner currently uses local keyword-based templates, not a third-party generative AI service. No task data or API keys are sent to an external provider.

On static hosting without the Node API (for example, a basic Netlify static deploy), the app falls back to browser storage. In that mode, tasks are private to that browser and do not sync across devices. To use the server API, deploy the Node server on a host that runs Node.js and serve the frontend from the same origin.