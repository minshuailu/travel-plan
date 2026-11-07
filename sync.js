// 用 Google 登入，把行程存在 Firebase，手機和電腦自動同步
import { FIREBASE_CONFIG } from './firebase-config.js?v=8';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const bar = document.querySelector('#syncBar');

async function start() {
  if (!FIREBASE_CONFIG || !window.tripApp) return;
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } = authMod;
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, doc, getDoc, setDoc, onSnapshot, serverTimestamp } = fsMod;

  const fb = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(fb);
  let db;
  try {
    // 存一份在手機裡：沒網路也能看、能改，有網路時自動上傳
    db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = initializeFirestore(fb, { localCache: memoryLocalCache() });
  }

  const DEVICE = Math.random().toString(36).slice(2);
  const LINKED = 'jp-trip-linked-v2'; // 改成多方案後，每台裝置重新合併一次
  const app = window.tripApp;
  let ref = null, unsub = null, timer = null, applying = false;

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const show = (user, status) => {
    bar.hidden = false;
    if (!user) {
      bar.innerHTML = `<button type="button" class="sync-btn" data-act="in">🔄 用 Google 登入，手機電腦同步行程</button>`;
      return;
    }
    bar.innerHTML = `<span class="sync-user">☁️ ${esc(user.displayName || user.email || '已登入')}</span>
      <span class="sync-status">${status}</span>
      <button type="button" class="link" data-act="out">登出</button>`;
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const push = () => {
    if (!ref) return;
    setDoc(ref, { plans: app.getData().plans, device: DEVICE, updatedAt: serverTimestamp() })
      .catch(e => console.warn('同步失敗', e));
  };
  window.onTripChange = () => {
    if (!ref || applying) return;
    clearTimeout(timer);
    timer = setTimeout(push, 600);
  };

  bar.addEventListener('click', async e => {
    const act = e.target.dataset.act;
    if (act === 'in') {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
          signInWithRedirect(auth, provider);
        } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
          alert('登入失敗：' + (err.code || err.message));
        }
      }
    } else if (act === 'out') {
      if (confirm('確定要登出嗎？這台裝置上的行程會保留，但不再同步。')) signOut(auth);
    }
  });

  getRedirectResult(auth).catch(() => {});

  onAuthStateChanged(auth, async user => {
    if (unsub) { unsub(); unsub = null; }
    ref = null;
    if (!user) { show(null); return; }
    show(user, '連線中…');
    const myRef = doc(db, 'users', user.uid);

    // 這台裝置第一次登入：雲端和這台的方案合併在一起
    if (localStorage.getItem(LINKED) !== user.uid) {
      let cloud;
      try {
        const snap = await getDoc(myRef);
        cloud = snap.exists() ? snap.data() : null;
      } catch (e) {
        // 沒網路時先不要合併，免得蓋掉雲端的資料
        show(user, '📴 離線中，連上網路後重新打開網頁就會同步');
        return;
      }
      applying = true;
      const changed = app.merge(cloud);
      applying = false;
      ref = myRef;
      if (changed) push();
      try { localStorage.setItem(LINKED, user.uid); } catch (e) { /* 忽略 */ }
    }
    ref = myRef;

    unsub = onSnapshot(myRef, { includeMetadataChanges: true }, snap => {
      const m = snap.metadata;
      show(user, m.hasPendingWrites ? '⏳ 等待上傳（沒網路時會先存在這台）' : m.fromCache ? '📴 離線中' : '✓ 已同步');
      const data = snap.data();
      if (!data || m.hasPendingWrites || data.device === DEVICE) return;
      if (data.plans && same(data.plans, app.getData().plans)) return;
      applying = true; app.applyData(data); applying = false;
    }, err => show(user, '⚠️ 同步失敗：' + esc(err.code || err.message)));
  });
}

start().catch(e => console.warn('同步功能無法啟動', e));
