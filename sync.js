// 用 Google 登入，把行程存在 Firebase，手機和電腦自動同步
import { FIREBASE_CONFIG } from './firebase-config.js?v=7';

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
  const LINKED = 'jp-trip-linked';
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
    setDoc(ref, { trip: app.getTrip(), device: DEVICE, updatedAt: serverTimestamp() })
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

    // 這台裝置第一次登入：決定要用雲端還是本機的行程
    if (localStorage.getItem(LINKED) !== user.uid) {
      let cloud = null;
      try { const snap = await getDoc(myRef); cloud = snap.exists() ? snap.data().trip : null; } catch (e) { /* 離線，先用本機的 */ }
      const local = app.getTrip();
      if (cloud && cloud.places && cloud.places.length) {
        if (local.places.length && !same(cloud, local) &&
          !confirm(`雲端已經有你的行程（${cloud.places.length} 個地點）。\n\n按「確定」：載入雲端的行程\n按「取消」：改用這台裝置的行程（${local.places.length} 個地點）並覆蓋雲端`)) {
          ref = myRef; push();
        } else {
          applying = true; app.applyTrip(cloud); applying = false;
        }
      } else {
        ref = myRef; push(); // 雲端還沒有資料，上傳這台的
      }
      try { localStorage.setItem(LINKED, user.uid); } catch (e) { /* 忽略 */ }
    }
    ref = myRef;

    unsub = onSnapshot(myRef, { includeMetadataChanges: true }, snap => {
      const m = snap.metadata;
      show(user, m.hasPendingWrites ? '⏳ 等待上傳（沒網路時會先存在這台）' : m.fromCache ? '📴 離線中' : '✓ 已同步');
      const data = snap.data();
      if (!data || !data.trip || m.hasPendingWrites || data.device === DEVICE) return;
      if (same(data.trip, app.getTrip())) return;
      applying = true; app.applyTrip(data.trip); applying = false;
    }, err => show(user, '⚠️ 同步失敗：' + esc(err.code || err.message)));
  });
}

start().catch(e => console.warn('同步功能無法啟動', e));
