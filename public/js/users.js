import { api, escapeHtml, toast } from "/static/js/api.js";

const root = document.getElementById("users-root");

const STATE = { users: [], folders: [], teamFolders: [] };

root.innerHTML = `
  <div class="users-toolbar"><button id="add-person-btn">Add person</button></div>
  <div id="add-person-form"></div>
  <div id="edit-person-form"></div>
  <table id="users-table">
    <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
    <tbody id="users-tbody"></tbody>
  </table>
`;

const els = {
  addBtn: document.getElementById("add-person-btn"),
  addForm: document.getElementById("add-person-form"),
  editForm: document.getElementById("edit-person-form"),
  tbody: document.getElementById("users-tbody"),
};

async function readJson(res) {
  try { return await res.json(); } catch { return {}; }
}

function reportError(data) {
  if (data.code === "LAST_OWNER") { toast("Add another owner before deactivating this one."); return; }
  toast(data.error || "Something went wrong.");
}

function folderCheckboxes(idPrefix, checkedList) {
  const checked = new Set(checkedList || []);
  return STATE.folders.map((f) => `
    <label class="checkbox-row"><input type="checkbox" name="${idPrefix}-folder" value="${escapeHtml(f)}" ${checked.has(f) ? "checked" : ""}> ${escapeHtml(f)}</label>
  `).join("");
}

function teamFolderSelect(idPrefix, current) {
  const opts = STATE.teamFolders.map((t) => `<option value="${escapeHtml(t)}" ${t === current ? "selected" : ""}>${escapeHtml(t)}</option>`).join("");
  return `<select id="${idPrefix}-team-folder"><option value="">(none)</option>${opts}</select>`;
}

function renderTable() {
  els.tbody.innerHTML = STATE.users.map((u) => `
    <tr data-id="${u.id}">
      <td>${escapeHtml(u.displayName)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td><span class="badge ${u.active ? "active" : "inactive"}">${u.active ? "Active" : "Inactive"}</span></td>
      <td><button class="edit-btn" data-id="${u.id}">Edit</button></td>
    </tr>
  `).join("");
}

async function loadAll() {
  const [usersRes, foldersRes] = await Promise.all([api("GET", "/api/users"), api("GET", "/api/users/folders")]);
  if (usersRes.ok) STATE.users = await usersRes.json();
  if (foldersRes.ok) {
    const f = await foldersRes.json();
    STATE.folders = f.folders || [];
    STATE.teamFolders = f.teamFolders || [];
  }
  renderTable();
}

function closeForms() {
  els.addForm.innerHTML = "";
  els.editForm.innerHTML = "";
}

function openAddForm() {
  els.editForm.innerHTML = "";
  els.addForm.innerHTML = `
    <form class="card" id="add-form">
      <h1>Add person</h1>
      <label>Display name<input type="text" name="displayName" required></label>
      <label>Username<input type="text" name="username" required></label>
      <label>Temporary password<input type="password" name="password" required minlength="10"></label>
      <label>Role
        <select name="role">
          <option value="staff" selected>Staff</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      <fieldset><legend>Folders</legend>${folderCheckboxes("add", [])}</fieldset>
      <label>Team folder ${teamFolderSelect("add", "")}</label>
      <label class="checkbox-row"><input type="checkbox" name="assetsView"> Assets browser</label>
      <label class="checkbox-row"><input type="checkbox" name="artifactsShared" checked> Shared artifacts</label>
      <div class="error" id="add-error"></div>
      <button type="submit">Create</button>
      <button type="button" id="add-cancel">Cancel</button>
    </form>
  `;
  document.getElementById("add-cancel").onclick = () => closeForms();
  document.getElementById("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const folders = fd.getAll("add-folder");
    const body = {
      displayName: fd.get("displayName"),
      username: fd.get("username"),
      password: fd.get("password"),
      role: fd.get("role"),
      switches: {
        folders,
        teamFolder: document.getElementById("add-team-folder").value || null,
        assetsView: fd.get("assetsView") === "on",
        artifactsShared: fd.get("artifactsShared") === "on",
      },
    };
    const res = await api("POST", "/api/users", body);
    const data = await readJson(res);
    if (!res.ok) { reportError(data); return; }
    closeForms();
    await loadAll();
    toast("Person added.");
  });
}

function openEditForm(user) {
  els.addForm.innerHTML = "";
  els.editForm.innerHTML = `
    <form class="card" id="edit-form">
      <h1>Edit ${escapeHtml(user.displayName)}</h1>
      <label>Display name<input type="text" name="displayName" value="${escapeHtml(user.displayName)}" required></label>
      <label>Role
        <select name="role">
          <option value="staff" ${user.role === "staff" ? "selected" : ""}>Staff</option>
          <option value="owner" ${user.role === "owner" ? "selected" : ""}>Owner</option>
        </select>
      </label>
      <fieldset><legend>Folders</legend>${folderCheckboxes("edit", user.switches?.folders)}</fieldset>
      <label>Team folder ${teamFolderSelect("edit", user.switches?.teamFolder || "")}</label>
      <label class="checkbox-row"><input type="checkbox" name="assetsView" ${user.switches?.assetsView ? "checked" : ""}> Assets browser</label>
      <label class="checkbox-row"><input type="checkbox" name="artifactsShared" ${user.switches?.artifactsShared ? "checked" : ""}> Shared artifacts</label>
      <div class="error" id="edit-error"></div>
      <button type="submit">Save</button>
      <button type="button" id="edit-reset-password">Reset password</button>
      <button type="button" id="edit-toggle-active">${user.active ? "Deactivate" : "Reactivate"}</button>
      <button type="button" id="edit-cancel">Cancel</button>
    </form>
  `;
  document.getElementById("edit-cancel").onclick = () => closeForms();

  document.getElementById("edit-reset-password").onclick = async () => {
    const pw = prompt("New temporary password (at least 10 characters):");
    if (!pw) return;
    const res = await api("POST", `/api/users/${user.id}/password`, { password: pw });
    if (!res.ok) { reportError(await readJson(res)); return; }
    toast("Password reset.");
  };

  document.getElementById("edit-toggle-active").onclick = async () => {
    const action = user.active ? "deactivate" : "reactivate";
    const res = await api("POST", `/api/users/${user.id}/${action}`, {});
    const data = await readJson(res);
    if (!res.ok) { reportError(data); return; }
    closeForms();
    await loadAll();
    toast(user.active ? "Person deactivated." : "Person reactivated.");
  };

  document.getElementById("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const folders = fd.getAll("edit-folder");
    const body = {
      displayName: fd.get("displayName"),
      role: fd.get("role"),
      switches: {
        folders,
        teamFolder: document.getElementById("edit-team-folder").value || null,
        assetsView: fd.get("assetsView") === "on",
        artifactsShared: fd.get("artifactsShared") === "on",
      },
    };
    const res = await api("PATCH", `/api/users/${user.id}`, body);
    const data = await readJson(res);
    if (!res.ok) { reportError(data); return; }
    closeForms();
    await loadAll();
    toast("Saved.");
  });
}

els.addBtn.addEventListener("click", () => openAddForm());

els.tbody.addEventListener("click", (e) => {
  const btn = e.target.closest(".edit-btn");
  if (!btn) return;
  const user = STATE.users.find((u) => u.id === btn.dataset.id);
  if (user) openEditForm(user);
});

loadAll();
