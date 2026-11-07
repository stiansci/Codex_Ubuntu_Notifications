"use strict";

// Shared by GJS and Node tests. Conversation titles never become menu labels.
function chatCount(count) {
    return `${count} ${count === 1 ? "chat" : "chats"} working`;
}

function activityDescription(snapshot) {
    if (snapshot.status !== "ready") return "Codex activity unavailable";
    const known = snapshot.count > 0 ? chatCount(snapshot.count) : "No chats working";
    return snapshot.uncertain > 0 ? `${known}; ${snapshot.uncertain} with uncertain activity` : known;
}

function workspaceActions(chats) {
    const groups = new Map();
    for (const chat of chats) {
        if (typeof chat.cwd !== "string" || !chat.cwd.startsWith("/") || chat.cwd.includes("\0")) continue;
        const cwd = chat.cwd.replace(/\/+$/, "") || "/";
        const entry = groups.get(cwd) || { cwd, count: 0 };
        entry.count++;
        groups.set(cwd, entry);
    }
    const entries = [...groups.values()].sort((a, b) => a.cwd.localeCompare(b.cwd));
    const basename = cwd => cwd.split("/").pop() || "/";
    const names = new Map();
    for (const entry of entries) names.set(basename(entry.cwd), (names.get(basename(entry.cwd)) || 0) + 1);
    return entries.map(entry => {
        const name = basename(entry.cwd);
        // Include the path for same-named workspaces, without control characters.
        const display = (names.get(name) > 1 ? entry.cwd : name).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ");
        return { ...entry, label: `Open workspace: ${display} (${chatCount(entry.count)})` };
    });
}

if (typeof module !== "undefined") module.exports = { chatCount, activityDescription, workspaceActions };
