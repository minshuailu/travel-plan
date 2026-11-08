// 用 Google 登入，把方案存在 Firebase，手機和電腦自動同步
// 每個方案是 users/{uid}/plans/{方案id} 一筆資料，兩台裝置同時改也不會把對方的方案蓋掉
import { FIREBASE_CONFIG } from './firebase-config.js?v=19';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const bar = document.querySelector('#syncBar');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function start() {
  if (!FIREBASE_CONFIG || !window.tripApp) return;
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } = authMod;
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
    doc, collection, getDoc, setDoc, deleteDoc, onSnapshot } = fsMod;

  const fb = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(fb);
  let db;
  try {
    // 存一份在手機裡：沒網路也能看、能改，有網路時自動上傳
    db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = initializeFirestore(fb, { localCache: memoryLocalCache() });
  }

  const app = window.tripApp;
  let col = null, unsub = null;
  const timers = {};

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

  const upload = plan => {
    if (!col) return;
    const { synced, ...data } = plan; // synced 只是這台自己的記號，不上傳
    setDoc(doc(col, plan.id), JSON.parse(JSON.stringify(data))).catch(e => console.warn('同步失敗', e));
    app.markSynced(plan);
  };
  window.onPlanChange = plan => {
    if (!col) return;
    clearTimeout(timers[plan.id]);
    timers[plan.id] = setTimeout(() => upload(plan), 600);
  };
  window.onPlanDelete = plan => {
    clearTimeout(timers[plan.id]);
    if (col) deleteDoc(doc(col, plan.id)).catch(e => console.warn('刪除失敗', e));
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

  onAuthStateChanged(auth, user => {
    if (unsub) { unsub(); unsub = null; }
    col = null;
    if (!user) { show(null); return; }
    show(user, '連線中…');
    const myCol = collection(db, 'users', user.uid, 'plans');
    let initial = true;

    unsub = onSnapshot(myCol, { includeMetadataChanges: true }, async snap => {
      const m = snap.metadata;
      if (initial && m.fromCache) { show(user, '📴 連線中…（還沒連到雲端）'); return; } // 先等雲端回應，才知道哪些方案是這台獨有的
      show(user, m.hasPendingWrites ? '⏳ 上傳中…' : m.fromCache ? '📴 離線中（改的內容會先存在這台）' : '✓ 已同步');
      if (m.hasPendingWrites) return; // 自己剛改的，還沒上傳完
      const remote = snap.docs.map(d => d.data());

      let extra = [];
      if (initial) {
        // 舊版存在 users/{uid} 一整份的資料，搬過來
        const legacyRef = doc(db, 'users', user.uid);
        try {
          const legacy = await getDoc(legacyRef);
          if (legacy.exists()) {
            const same = (a, b) => JSON.stringify(a.trip.places) === JSON.stringify(b.trip.places);
            extra = app.legacyPlans(legacy.data()).filter(x => !remote.some(r => r.id === x.id || same(r, x)));
            deleteDoc(legacyRef).catch(() => {}); // 搬完就刪掉，免得每次都再搬一次
          }
        } catch (e) { /* 沒有就算了 */ }
      }
      col = myCol;
      const toUpload = app.applyRemote([...remote, ...extra], initial);
      toUpload.forEach(upload);
      extra.forEach(x => { const p = app.plans().find(y => y.id === x.id); if (p) upload(p); });
      initial = false;
    }, err => show(user, '⚠️ 同步失敗：' + esc(err.code || err.message)));
  });
}

start().catch(e => console.warn('同步功能無法啟動', e));
