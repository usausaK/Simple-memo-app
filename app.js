import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

/* Firebaseの初期化 */

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

/* HTML要素 */

const loginScreen = document.getElementById("login-screen");
const appScreen = document.getElementById("app-screen");

const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const newNoteButton = document.getElementById("new-note-button");
const deleteNoteButton = document.getElementById(
  "delete-note-button"
);

const userName = document.getElementById("user-name");
const noteList = document.getElementById("note-list");

const emptyMessage = document.getElementById("empty-message");
const noteEditor = document.getElementById("note-editor");
const noteTitle = document.getElementById("note-title");
const noteContent = document.getElementById("note-content");
const saveStatus = document.getElementById("save-status");

/* アプリ内の状態 */

let currentUser = null;
let currentNoteId = null;
let notes = [];
let saveTimer = null;
let unsubscribeNotes = null;
let isSelectingNote = false;

/* Googleログイン */

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  loginButton.textContent = "ログイン中…";

  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("ログインエラー:", error);

    if (error.code === "auth/popup-closed-by-user") {
      alert("ログイン画面が閉じられました。");
    } else {
      alert(
        "ログインできませんでした。\n" +
        "時間をおいて、もう一度お試しください。"
      );
    }
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Googleでログイン";
  }
});

/* ログアウト */

logoutButton.addEventListener("click", async () => {
  try {
    await saveCurrentNoteImmediately();
    await signOut(auth);
  } catch (error) {
    console.error("ログアウトエラー:", error);
    alert("ログアウトできませんでした。");
  }
});

/* ログイン状態の監視 */

onAuthStateChanged(auth, (user) => {
  if (unsubscribeNotes) {
    unsubscribeNotes();
    unsubscribeNotes = null;
  }

  clearTimeout(saveTimer);
  currentNoteId = null;
  notes = [];
  noteList.innerHTML = "";

  if (user) {
    currentUser = user;

    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");

    userName.textContent =
      user.displayName ||
      user.email ||
      "ログイン中";

    showEmptyEditor();
    startNotesListener();
  } else {
    currentUser = null;

    appScreen.classList.add("hidden");
    loginScreen.classList.remove("hidden");

    showEmptyEditor();
  }
});

/* メモ一覧をFirestoreから取得 */

function startNotesListener() {
  if (!currentUser) {
    return;
  }

  const notesCollection = collection(
    db,
    "users",
    currentUser.uid,
    "notes"
  );

  const notesQuery = query(
    notesCollection,
    orderBy("updatedAt", "desc")
  );

  unsubscribeNotes = onSnapshot(
    notesQuery,
    (snapshot) => {
      notes = snapshot.docs.map((noteDocument) => ({
        id: noteDocument.id,
        ...noteDocument.data()
      }));

      renderNoteList();

      if (
        currentNoteId &&
        !notes.some((note) => note.id === currentNoteId)
      ) {
        currentNoteId = null;
        showEmptyEditor();
      }

      if (currentNoteId) {
        const currentNote = notes.find(
          (note) => note.id === currentNoteId
        );

        if (currentNote && !isEditing()) {
          displayNote(currentNote);
        }
      }
    },
    (error) => {
      console.error("メモ取得エラー:", error);
      alert(
        "メモを読み込めませんでした。\n" +
        "Firestoreの設定をご確認ください。"
      );
    }
  );
}

/* 左側にメモ一覧を表示 */

function renderNoteList() {
  noteList.innerHTML = "";

  if (notes.length === 0) {
    const message = document.createElement("div");
    message.className = "note-item";
    message.textContent = "メモはまだありません";
    noteList.appendChild(message);
    return;
  }

  notes.forEach((note) => {
    const item = document.createElement("div");
    item.className = "note-item";

    if (note.id === currentNoteId) {
      item.classList.add("active");
    }

    const title = document.createElement("div");
    title.className = "note-item-title";
    title.textContent =
      note.title?.trim() || "無題のメモ";

    const preview = document.createElement("div");
    preview.className = "note-item-preview";
    preview.textContent =
      note.content?.trim() || "本文なし";

    item.appendChild(title);
    item.appendChild(preview);

    item.addEventListener("click", async () => {
      await selectNote(note.id);
    });

    noteList.appendChild(item);
  });
}

/* メモを選択 */

async function selectNote(noteId) {
  if (noteId === currentNoteId) {
    return;
  }

  await saveCurrentNoteImmediately();

  currentNoteId = noteId;

  const selectedNote = notes.find(
    (note) => note.id === noteId
  );

  if (selectedNote) {
    displayNote(selectedNote);
    renderNoteList();
  }
}

/* 選択したメモを右側に表示 */

function displayNote(note) {
  isSelectingNote = true;

  emptyMessage.classList.add("hidden");
  noteEditor.classList.remove("hidden");

  noteTitle.value = note.title || "";
  noteContent.value = note.content || "";
  saveStatus.textContent = "保存済み";

  isSelectingNote = false;
}

/* 編集画面を閉じる */

function showEmptyEditor() {
  emptyMessage.classList.remove("hidden");
  noteEditor.classList.add("hidden");

  noteTitle.value = "";
  noteContent.value = "";
  saveStatus.textContent = "";
}

/* 新しいメモを作成 */

newNoteButton.addEventListener("click", async () => {
  if (!currentUser) {
    return;
  }

  newNoteButton.disabled = true;
  newNoteButton.textContent = "作成中…";

  try {
    await saveCurrentNoteImmediately();

    const notesCollection = collection(
      db,
      "users",
      currentUser.uid,
      "notes"
    );

    const newNote = await addDoc(notesCollection, {
      title: "",
      content: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    currentNoteId = newNote.id;

    emptyMessage.classList.add("hidden");
    noteEditor.classList.remove("hidden");

    noteTitle.value = "";
    noteContent.value = "";
    saveStatus.textContent = "保存済み";

    renderNoteList();
    noteTitle.focus();
  } catch (error) {
    console.error("メモ作成エラー:", error);
    alert("新しいメモを作成できませんでした。");
  } finally {
    newNoteButton.disabled = false;
    newNoteButton.textContent = "＋ 新規メモ";
  }
});

/* 入力すると自動保存 */

noteTitle.addEventListener("input", scheduleSave);
noteContent.addEventListener("input", scheduleSave);

function scheduleSave() {
  if (isSelectingNote || !currentNoteId) {
    return;
  }

  saveStatus.textContent = "入力中…";
  clearTimeout(saveTimer);

  saveTimer = setTimeout(async () => {
    await saveCurrentNote();
  }, 800);
}

/* Firestoreへ保存 */

async function saveCurrentNote() {
  if (!currentUser || !currentNoteId) {
    return;
  }

  saveStatus.textContent = "保存中…";

  try {
    const noteReference = doc(
      db,
      "users",
      currentUser.uid,
      "notes",
      currentNoteId
    );

    await updateDoc(noteReference, {
      title: noteTitle.value,
      content: noteContent.value,
      updatedAt: serverTimestamp()
    });

    saveStatus.textContent = "保存済み";
  } catch (error) {
    console.error("保存エラー:", error);
    saveStatus.textContent = "保存できませんでした";
  }
}

/* 切り替え前などにすぐ保存 */

async function saveCurrentNoteImmediately() {
  if (!currentUser || !currentNoteId) {
    return;
  }

  clearTimeout(saveTimer);
  await saveCurrentNote();
}

/* メモを削除 */

deleteNoteButton.addEventListener("click", async () => {
  if (!currentUser || !currentNoteId) {
    return;
  }

  const shouldDelete = window.confirm(
    "このメモを削除しますか？\n" +
    "削除したメモは元に戻せません。"
  );

  if (!shouldDelete) {
    return;
  }

  deleteNoteButton.disabled = true;
  deleteNoteButton.textContent = "削除中…";

  try {
    clearTimeout(saveTimer);

    const noteReference = doc(
      db,
      "users",
      currentUser.uid,
      "notes",
      currentNoteId
    );

    await deleteDoc(noteReference);

    currentNoteId = null;
    showEmptyEditor();
  } catch (error) {
    console.error("削除エラー:", error);
    alert("メモを削除できませんでした。");
  } finally {
    deleteNoteButton.disabled = false;
    deleteNoteButton.textContent = "削除";
  }
});

/* 現在入力中か簡易的に確認 */

function isEditing() {
  return (
    document.activeElement === noteTitle ||
    document.activeElement === noteContent
  );
}
