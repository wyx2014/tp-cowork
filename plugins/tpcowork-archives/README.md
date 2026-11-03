# @tpcowork/dsh-archives

ZCode-style archive management for TP Cowork. Archived sessions leave the sidebar (tpcowork-ui hides DSH's
"show archived" filters), and **Settings › Data & Statistics › Archive management** lists them by workspace with
search, sort by updated or created time, and a project filter. Each session can be unarchived or deleted, each
workspace group has "Unarchive all" and "Delete all", and the page header deletes everything that matches the
current filters. Deleting asks for confirmation and reports succeeded, failed and skipped counts, as ZCode does.

Above the list, ZCode's auto-archive card has two settings, both stored in this plugin's config (`cordis.patch.yml`)
and read live:

- **Auto-archive old sessions** (`autoArchive`, off by default as in ZCode).
- **Archive retention** (`autoArchiveDays`): 3, 7, 14 or 30 days, default 30. Despite its name, this is the idle time
  before a session is archived. Nothing is ever deleted automatically.

While the switch is on, the Host scans at start, every 5 minutes, and right after either setting changes (the page
calls the `rescan()` Remote). It archives sessions whose last activity is older than the period. It skips pinned,
running, blank and subagent sessions, and also sessions loaded in this run, so a conversation that is open is never
archived out from under the user.

**Workspaces work as ZCode's projects: there is no 未分组.** DSH lists sessions that belong to no workspace under
未分组 (a removed workspace's sessions among them), and adding the same folder again starts an empty workspace. In ZCode a
conversation shows only under its project, a removed project's conversations leave with it, and adding the folder back
shows them again. Nothing is deleted either way.

- `hidden()` on the `archiveManager` Remote returns every session in no workspace, except archived sessions (archive
  management lists them) and subagent sessions. The Client (`src/removed-workspaces.ts`) puts them in a virtual
  sidebar group, which takes them out of 未分组, and draws neither that group, its rows, nor the 未分组 section, in the
  grouped and the flat list. Sessions another plugin's group shows, such as 定时任务, stay in that group.
- The Host watches the Workspace table (`domain/changed`). When a workspace is created, and for every workspace at
  start, the sessions in no workspace whose folder (compared by real path) is the workspace's folder are attached to it
  through DSH's `attachSession`, which checks each session's own stored folder. So adding a removed folder again brings
  its conversations back, including ones removed before this feature existed. Scheduled runs (`automation-…` sessions)
  and subagent sessions are never attached.
- The "删除工作区" confirmation's last sentence, DSH's "其会话将显示在'未分组'下", is replaced with
  "其会话会随工作区一起隐藏，重新添加此文件夹即可恢复".
- Differences from ZCode: DSH asks before every removal, so there is no separate prompt for a workspace with a running
  conversation, and such a conversation keeps running in the background instead of being stopped. A session whose folder
  has never been added as a workspace (for example one created outside TP Cowork) is reachable only by adding its folder.

- **Client** (`src/client.tsx`): reads the Workspace archive set and Session list live, and unarchives through the
  Workspace service.
- **Host** (`src/host.ts`): the `archiveManager` Remote and the auto-archive scan. `list()` returns the archived sessions still stored with
  their creation times; `remove(ids)` deletes each still-archived session and its subagent sessions through
  `sessionPersistence.delete`, then tells clients the session left the list.

DSH keeps an opened session loaded until the app quits, and storage refuses to delete a loaded session. Such a
session is hidden at once and queued in `$DSH_HOME/tpcowork/archives-pending-delete.json`; its files are removed
the next time the app starts, unless it was unarchived meanwhile.

```bash
node build.mjs              # type-check, then bundle lib/host.js and lib/client.js
node build.mjs --typecheck
npm test
```

Expanded archive groups follow the supplied ZCode reference: one light-gray rounded list, inset row separators, a single-line semibold title with an independently spaced timestamp, and right-aligned delete/unarchive actions. Rows have a 70px minimum height; longer titles ellipsize while preserving their full title tooltip. The disclosure button names and controls the list. Preview: `artifacts/archive-settings/expanded-list.png`. The list test covers disclosure, restore, and explicit delete confirmation.
