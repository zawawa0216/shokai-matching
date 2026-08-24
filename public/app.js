/* 紹介制マッチングアプリのフロントエンド。ビルド不要の素の JS。 */
;(function () {
  'use strict'

  const TOKEN_KEY = 'shokai.token'
  const root = document.getElementById('app')
  const toastEl = document.getElementById('toast')

  const state = {
    token: localStorage.getItem(TOKEN_KEY),
    me: null,
    tab: 'discover',
    view: null, // 'chat' などタブの上に重ねる画面
    candidates: [],
    matches: [],
    incoming: [],
    invitations: [],
    screening: null,
    chat: null,
    busy: false,
  }

  // ---- ユーティリティ ------------------------------------------------------

  const GENDER = { MALE: '男性', FEMALE: '女性', OTHER: 'その他' }
  const INTENT = { MARRIAGE: '結婚を前提に', SERIOUS_RELATIONSHIP: '真剣な交際' }
  const RELATIONSHIP = {
    FRIEND: '友人',
    COLLEAGUE: '同僚・元同僚',
    CLASSMATE: '同級生',
    FAMILY: '親族',
    CLIENT: '仕事の関係者',
    OTHER: 'その他',
  }
  const DOC_TYPE = {
    DRIVERS_LICENSE: '運転免許証',
    PASSPORT: 'パスポート',
    MY_NUMBER_CARD: 'マイナンバーカード',
    RESIDENCE_CARD: '在留カード',
  }
  const STATUS_TEXT = {
    PENDING_PROFILE: '入会手続き中',
    PENDING_SCREENING: '運営の審査待ち',
    ACTIVE: '会員',
    REJECTED: '入会をお断りしました',
    SUSPENDED: 'ご利用を停止しています',
    WITHDRAWN: '退会済み',
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    )
  }

  /** 写真がなくても顔が並んで見えるよう、ID から安定した色を作る。 */
  function hueOf(id) {
    let hash = 0
    for (let i = 0; i < String(id).length; i += 1) {
      hash = (hash * 31 + String(id).charCodeAt(i)) % 360
    }
    return hash
  }

  function pictureHtml(person, className) {
    const photo = (person.photos || (person.profile && person.profile.photos) || [])[0]
    const hue = hueOf(person.id)
    const style = `background: linear-gradient(150deg, hsl(${hue} 32% 46%), hsl(${(hue + 40) % 360} 34% 32%));`
    const initial = esc(String(person.displayName || '？').trim().charAt(0))
    const image = /^https?:\/\//.test(photo || '')
      ? `<img src="${esc(photo)}" alt="" loading="lazy" />`
      : ''
    return `<div class="${className}" style="${style}">${initial}${image}</div>`
  }

  function toast(message, isError) {
    toastEl.textContent = message
    toastEl.className = `toast show${isError ? ' error' : ''}`
    clearTimeout(toast.timer)
    toast.timer = setTimeout(() => {
      toastEl.className = 'toast'
    }, 3200)
  }

  function timeText(iso) {
    if (!iso) return ''
    const date = new Date(iso)
    const today = new Date()
    const sameDay = date.toDateString() === today.toDateString()
    return sameDay
      ? date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
  }

  // ---- API -----------------------------------------------------------------

  async function api(method, path, body) {
    const headers = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (state.token) headers.authorization = `Bearer ${state.token}`

    const response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (response.status === 204) return null

    // サーバーやCDNが JSON 以外を返すことがある（古いデプロイの 404 など）。
    // ここで落とすと利用者には解読できないエラーが出るので、必ず言葉にして返す。
    const text = await response.text()
    let payload = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
    }

    if (!response.ok) {
      if (response.status === 401 && state.token) signOut(true)
      const error = new Error(messageFor(response.status, payload))
      error.code = payload && payload.error && payload.error.code
      error.status = response.status
      throw error
    }

    if (text && payload === null) {
      throw new Error('サーバーの応答を読み取れませんでした。ページを再読み込みしてください。')
    }
    return payload
  }

  function messageFor(status, payload) {
    if (payload && payload.error && payload.error.message) return payload.error.message
    if (status === 404) {
      return '古いURLを開いている可能性があります。最新のURLで開き直してください。'
    }
    if (status >= 500) return `サーバーが応答しませんでした（${status}）`
    return `通信に失敗しました（${status}）`
  }

  /** 失敗をトーストに落として、画面側は成功時だけ考えればよいようにする。 */
  async function attempt(fn, successMessage) {
    if (state.busy) return { ok: false }
    state.busy = true
    try {
      const result = await fn()
      if (successMessage) toast(successMessage)
      return { ok: true, result }
    } catch (error) {
      toast(error.message, true)
      return { ok: false, error }
    } finally {
      state.busy = false
    }
  }

  function signOut(silent) {
    state.token = null
    state.me = null
    localStorage.removeItem(TOKEN_KEY)
    if (!silent) toast('ログアウトしました')
    render()
  }

  // ---- 画面: 入口 ----------------------------------------------------------

  function welcomeScreen() {
    return `
      <div class="screen centered">
        <div class="brand">
          <h1>紹介</h1>
          <p>知人の紹介がなければ登録できない、30歳以上のためのマッチング</p>
        </div>

        <div class="card">
          <h3>ログイン</h3>
          <div class="field">
            <label for="loginEmail">メールアドレス</label>
            <input id="loginEmail" type="email" autocomplete="email" />
          </div>
          <div class="field">
            <label for="loginPassword">パスワード</label>
            <input id="loginPassword" type="password" autocomplete="current-password" />
          </div>
          <button class="block" id="loginBtn">ログイン</button>
        </div>

        <div class="card">
          <h3>招待コードをお持ちの方</h3>
          <p class="muted" style="margin-top:0;">
            紹介してくれた方から届いたコードを入れてください。紹介文もそこで読めます。
          </p>
          <div class="field">
            <label for="codeInput">招待コード</label>
            <input id="codeInput" placeholder="XXXXX-XXXXX" autocomplete="off" />
          </div>
          <button class="block ghost" id="lookupBtn">コードを確認する</button>
        </div>
      </div>`
  }

  function bindWelcome() {
    const login = async () => {
      const email = document.getElementById('loginEmail').value
      const password = document.getElementById('loginPassword').value
      const done = await attempt(() => api('POST', '/auth/login', { email, password }))
      if (!done.ok) return
      state.token = done.result.token
      localStorage.setItem(TOKEN_KEY, state.token)
      await loadMe()
      render()
    }

    document.getElementById('loginBtn').addEventListener('click', login)
    document.getElementById('loginPassword').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') login()
    })

    document.getElementById('lookupBtn').addEventListener('click', async () => {
      const code = document.getElementById('codeInput').value.trim()
      const done = await attempt(() => api('GET', `/invitations/${encodeURIComponent(code)}`))
      if (!done.ok) return
      state.view = { name: 'register', invitation: done.result, code }
      render()
    })
  }

  // ---- 画面: 登録 ----------------------------------------------------------

  function registerScreen(invitation) {
    return `
      <div class="topbar">
        <button class="link" data-back>もどる</button>
        <h2>会員登録</h2>
      </div>
      <div class="screen">
        <div class="card">
          <h3>${esc(invitation.referrer.displayName)}さんからの紹介</h3>
          <div class="letter">
            <div class="meta">${esc(RELATIONSHIP[invitation.relationship] || 'その他')}　/　${esc(invitation.inviteeName)}さんへ</div>
            <p>${esc(invitation.introduction.text)}</p>
          </div>
        </div>

        <div class="card">
          <h3>あなたの情報</h3>
          <p class="muted" style="margin-top:0;">
            ご利用は30歳以上の方に限ります。生年月日は、あとで身分証と照合します。
          </p>
          <div class="field">
            <label for="regName">お名前（表示名）</label>
            <input id="regName" value="${esc(invitation.inviteeName)}" autocomplete="name" />
          </div>
          <div class="field">
            <label for="regBirth">生年月日</label>
            <input id="regBirth" type="date" />
          </div>
          <div class="row">
            <div class="field">
              <label for="regGender">性別</label>
              <select id="regGender">
                <option value="FEMALE">女性</option>
                <option value="MALE">男性</option>
                <option value="OTHER">その他</option>
              </select>
            </div>
            <div class="field">
              <label for="regPref">お住まい</label>
              <input id="regPref" value="東京都" autocomplete="address-level1" />
            </div>
          </div>
          <div class="field">
            <label for="regPassword">パスワード（10文字以上）</label>
            <input id="regPassword" type="password" autocomplete="new-password" />
          </div>
          <button class="block" id="registerBtn">登録する</button>
        </div>
      </div>`
  }

  function bindRegister(invitation, code) {
    document.getElementById('registerBtn').addEventListener('click', async () => {
      const done = await attempt(() =>
        api('POST', '/members/register', {
          invitationCode: code,
          email: invitation.inviteeEmail,
          password: document.getElementById('regPassword').value,
          displayName: document.getElementById('regName').value,
          birthDate: document.getElementById('regBirth').value,
          gender: document.getElementById('regGender').value,
          prefecture: document.getElementById('regPref').value,
        }),
      )
      if (!done.ok) return

      const login = await attempt(() =>
        api('POST', '/auth/login', {
          email: invitation.inviteeEmail,
          password: document.getElementById('regPassword').value,
        }),
      )
      if (!login.ok) return
      state.token = login.result.token
      localStorage.setItem(TOKEN_KEY, state.token)
      state.view = null
      await loadMe()
      toast('ようこそ。入会手続きを進めてください')
      render()
    })
  }

  // ---- 画面: 入会手続き ----------------------------------------------------

  function onboardingScreen() {
    const me = state.me
    const s = state.screening
    if (!s) return '<div class="screen"><p class="muted">読み込み中…</p></div>'

    const step = (done, title, note, optional) => `
      <div class="step${done ? ' done' : ''}">
        <span class="mark">${done ? '✓' : ''}</span>
        <span class="what"><strong>${esc(title)}</strong><small>${esc(note)}</small></span>
        ${optional ? '<span class="optional">任意</span>' : ''}
      </div>`

    const missing = (s.missingProfileFields || [])
      .map((f) => ({ occupation: 'お仕事', bio: '自己紹介', intent: '目的', photos: '写真' })[f] || f)
      .join('・')

    const canSubmit = s.eligible && me.status === 'PENDING_PROFILE'

    return `
      <div class="topbar"><h2>入会手続き</h2></div>
      <div class="screen">
        <div class="card">
          <h3>${esc(STATUS_TEXT[me.status])}</h3>
          <div class="steps">
            ${step(true, '知人からの紹介', `${esc(me.introduction.authorRole === 'OPERATOR' ? '運営' : '紹介者')}が紹介文を書いています`)}
            ${step(s.checks.profileComplete, 'プロフィール', s.checks.profileComplete ? '入力できています' : `未入力: ${missing}`)}
            ${step(s.checks.identityVerified, '本人確認書類', s.checks.identityVerified ? '確認できました' : '提出して運営の承認を待ちます')}
            ${step(s.checks.meetsMinimumAge, '年齢の確認', s.checks.meetsMinimumAge ? `${s.verifiedAge}歳` : '身分証の承認後に確定します')}
            ${step(s.optional.singleCertified, '独身証明書', s.optional.singleStatusCertificate === 'SUBMITTED' ? '審査待ち' : s.optional.singleCertified ? '確認できました' : '出さなくても入会できます', true)}
          </div>
          ${
            me.status === 'PENDING_SCREENING'
              ? '<p class="muted">運営が確認しています。承認されるとお相手を探せるようになります。</p>'
              : `<button class="block" id="submitScreeningBtn" ${canSubmit ? '' : 'disabled'} style="margin-top:14px;">審査に進む</button>`
          }
        </div>

        <div class="card">
          <h3>プロフィール</h3>
          <div class="field">
            <label for="pfOccupation">お仕事</label>
            <input id="pfOccupation" value="${esc(me.profile.occupation || '')}" />
          </div>
          <div class="field">
            <label for="pfIntent">目的</label>
            <select id="pfIntent">
              <option value="MARRIAGE"${me.profile.intent === 'MARRIAGE' ? ' selected' : ''}>結婚を前提に</option>
              <option value="SERIOUS_RELATIONSHIP"${me.profile.intent === 'SERIOUS_RELATIONSHIP' ? ' selected' : ''}>真剣な交際</option>
            </select>
          </div>
          <div class="field">
            <label for="pfPhoto">写真のURL（任意）</label>
            <input id="pfPhoto" value="${esc((me.profile.photos || [])[0] || '')}" placeholder="https://…" />
          </div>
          <div class="field">
            <label for="pfBio">自己紹介（100文字以上）</label>
            <textarea id="pfBio">${esc(me.profile.bio || '')}</textarea>
            <div class="counter" id="bioCounter"></div>
          </div>
          <button class="block" id="saveProfileBtn">保存する</button>
        </div>

        <div class="card">
          <h3>本人確認書類</h3>
          <p class="muted" style="margin-top:0;">
            入会に必須です。券面の生年月日が登録内容と一致しないと承認されません。
          </p>
          <div class="field">
            <label for="docType">書類の種類</label>
            <select id="docType">
              ${Object.entries(DOC_TYPE)
                .map(([value, label]) => `<option value="${value}">${esc(label)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field">
            <label for="docName">券面のお名前</label>
            <input id="docName" value="${esc(me.displayName)}" />
          </div>
          <div class="field">
            <label for="docBirth">券面の生年月日</label>
            <input id="docBirth" type="date" value="${esc(me.birthDate)}" />
          </div>
          <button class="block" id="submitIdBtn">提出する</button>
        </div>

        <div class="card">
          <h3>独身証明書 <span class="badge">任意</span></h3>
          <p class="muted" style="margin-top:0;">
            発行から90日以内のものが有効です。承認されるとプロフィールにバッジが付きます。
          </p>
          <div class="field">
            <label for="certIssued">発行日</label>
            <input id="certIssued" type="date" />
          </div>
          <button class="block quiet" id="submitCertBtn">提出する</button>
        </div>
      </div>`
  }

  function bindOnboarding() {
    const bio = document.getElementById('pfBio')
    const counter = document.getElementById('bioCounter')
    const updateCounter = () => {
      const n = bio.value.trim().length
      counter.textContent = `${n} / 100文字`
      counter.className = n < 100 ? 'counter short' : 'counter'
    }
    bio.addEventListener('input', updateCounter)
    updateCounter()

    document.getElementById('saveProfileBtn').addEventListener('click', async () => {
      const photo = document.getElementById('pfPhoto').value.trim()
      const done = await attempt(
        () =>
          api('PATCH', '/me', {
            occupation: document.getElementById('pfOccupation').value,
            intent: document.getElementById('pfIntent').value,
            bio: bio.value,
            photos: [photo || 'no-photo'],
          }),
        'プロフィールを保存しました',
      )
      if (done.ok) await refreshOnboarding()
    })

    document.getElementById('submitIdBtn').addEventListener('click', async () => {
      const done = await attempt(
        () =>
          api('POST', '/me/documents/identity', {
            docType: document.getElementById('docType').value,
            fullName: document.getElementById('docName').value,
            birthDate: document.getElementById('docBirth').value,
            imageRef: 'uploaded-by-user',
          }),
        '提出しました。運営の確認をお待ちください',
      )
      if (done.ok) await refreshOnboarding()
    })

    document.getElementById('submitCertBtn').addEventListener('click', async () => {
      const done = await attempt(
        () =>
          api('POST', '/me/documents/single-status', {
            fullName: state.me.displayName,
            issuedOn: document.getElementById('certIssued').value,
            imageRef: 'uploaded-by-user',
          }),
        '提出しました',
      )
      if (done.ok) await refreshOnboarding()
    })

    const submitBtn = document.getElementById('submitScreeningBtn')
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const done = await attempt(() => api('POST', '/me/screening'), '審査に進みました')
        if (done.ok) {
          await loadMe()
          render()
        }
      })
    }
  }

  async function refreshOnboarding() {
    const [me, screening] = await Promise.all([api('GET', '/me'), api('GET', '/me/screening')])
    state.me = me
    state.screening = screening
    render()
  }

  // ---- 画面: スワイプ ------------------------------------------------------

  function discoverScreen() {
    if (!state.candidates.length) {
      return `
        <div class="topbar"><h2>さがす</h2></div>
        <div class="screen">
          <div class="deck"><div class="empty-deck">
            いまお会いできる方はいません。<br />新しく紹介された方が入会すると、ここに出ます。
          </div></div>
        </div>`
    }

    const cards = state.candidates
      .slice(0, 2)
      .reverse()
      .map((person, index, list) => {
        const isTop = index === list.length - 1
        return `
        <article class="swipe-card" data-card="${esc(person.id)}" style="${isTop ? '' : 'transform: scale(0.96) translateY(10px);'}">
          <span class="stamp like">いいね</span>
          <span class="stamp pass">見送り</span>
          ${pictureHtml(person, 'photo')}
          <div class="info">
            <div>
              <h3>${esc(person.displayName)}</h3>
              <div class="facts">${person.age}歳・${esc(GENDER[person.gender] || '')}・${esc(person.prefecture)}${person.occupation ? '・' + esc(person.occupation) : ''}</div>
            </div>
            <div class="badges">
              <span class="badge verified">本人確認済み</span>
              ${person.badges.singleCertified ? '<span class="badge single">独身証明済み</span>' : ''}
              <span class="badge">${esc(INTENT[person.intent] || '')}</span>
            </div>
            <p class="bio">${esc(person.bio)}</p>
            <div class="letter">
              <div class="meta">${person.introduction.authorRole === 'OPERATOR' ? '運営' : '紹介者'}による紹介　—　${esc(RELATIONSHIP[person.introduction.relationship] || 'その他')}</div>
              <p>${esc(person.introduction.text)}</p>
            </div>
          </div>
        </article>`
      })
      .join('')

    return `
      <div class="topbar"><h2>さがす</h2><span class="muted">${state.candidates.length}人</span></div>
      <div class="screen">
        <div class="deck" id="deck">${cards}</div>
        <div class="deck-actions">
          <button class="circle pass" id="passBtn" aria-label="見送る">見送</button>
          <button class="circle like" id="likeBtn" aria-label="いいね">好</button>
        </div>
      </div>`
  }

  function bindDiscover() {
    const deck = document.getElementById('deck')
    if (!deck) return
    const cards = deck.querySelectorAll('.swipe-card')
    const top = cards[cards.length - 1]
    if (!top) return

    const likeStamp = top.querySelector('.stamp.like')
    const passStamp = top.querySelector('.stamp.pass')
    let startX = 0
    let startY = 0
    let dx = 0
    let dy = 0
    let dragging = false

    function setTransform(x, y, rotate, transition) {
      top.style.transition = transition || 'none'
      top.style.transform = `translate(${x}px, ${y}px) rotate(${rotate}deg)`
      const ratio = Math.min(Math.abs(x) / 110, 1)
      likeStamp.style.opacity = x > 0 ? ratio : 0
      passStamp.style.opacity = x < 0 ? ratio : 0
    }

    function onDown(event) {
      dragging = true
      startX = event.clientX
      startY = event.clientY
      top.classList.add('dragging')
      top.setPointerCapture(event.pointerId)
    }

    function onMove(event) {
      if (!dragging) return
      dx = event.clientX - startX
      dy = event.clientY - startY
      setTransform(dx, dy, dx / 22)
    }

    function onUp() {
      if (!dragging) return
      dragging = false
      top.classList.remove('dragging')
      if (Math.abs(dx) > 110) {
        fly(dx > 0 ? 'like' : 'pass')
      } else {
        setTransform(0, 0, 0, 'transform 0.25s ease')
        dx = 0
        dy = 0
      }
    }

    /** カードを飛ばしてから通信する。結果を待たせないほうが手触りがよい。 */
    function fly(kind) {
      const target = state.candidates[0]
      if (!target) return
      const toX = kind === 'like' ? window.innerWidth : -window.innerWidth
      setTransform(toX, dy, (toX / 22) * 0.6, 'transform 0.32s ease-out')
      likeStamp.style.opacity = kind === 'like' ? 1 : 0
      passStamp.style.opacity = kind === 'pass' ? 1 : 0

      state.candidates = state.candidates.slice(1)
      setTimeout(async () => {
        render()
        try {
          const result = await api('POST', `/members/${encodeURIComponent(target.id)}/${kind}`)
          if (result && result.match) showMatch(result.partner || target)
        } catch (error) {
          toast(error.message, true)
        }
      }, 260)
    }

    top.addEventListener('pointerdown', onDown)
    top.addEventListener('pointermove', onMove)
    top.addEventListener('pointerup', onUp)
    top.addEventListener('pointercancel', onUp)

    document.getElementById('likeBtn').addEventListener('click', () => fly('like'))
    document.getElementById('passBtn').addEventListener('click', () => fly('pass'))
  }

  function showMatch(partner) {
    const overlay = document.createElement('div')
    overlay.className = 'overlay'
    overlay.innerHTML = `
      <div class="panel">
        <h3>ご縁</h3>
        <p class="muted">${esc(partner.displayName)}さんとマッチしました</p>
        ${pictureHtml(partner, 'avatar')}
        <button class="block" data-open-chat>メッセージを送る</button>
        <button class="block quiet" data-close style="margin-top:8px;">さがすに戻る</button>
      </div>`
    document.body.appendChild(overlay)

    overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove())
    overlay.querySelector('[data-open-chat]').addEventListener('click', async () => {
      overlay.remove()
      await switchTab('matches')
    })
  }

  // ---- 画面: マッチと会話 --------------------------------------------------

  function matchesScreen() {
    const incoming = state.incoming.length
      ? `<div class="card">
           <h3>あなたに届いたいいね　${state.incoming.length}件</h3>
           <p class="muted" style="margin:0;">「さがす」で同じ方にいいねを返すとマッチします。</p>
         </div>`
      : ''

    const list = state.matches.length
      ? state.matches
          .map(
            (m) => `
        <button class="list-item" data-match="${esc(m.matchId)}">
          ${pictureHtml(m.partner, 'avatar')}
          <span class="who">
            <strong>${esc(m.partner.displayName)}</strong>
            <small>${m.lastMessage ? esc(m.lastMessage.body) : 'まだメッセージはありません'}</small>
          </span>
          ${m.unreadCount ? `<span class="unread">${m.unreadCount}</span>` : `<span class="muted">${esc(timeText(m.lastMessage ? m.lastMessage.createdAt : m.createdAt))}</span>`}
        </button>`,
          )
          .join('')
      : '<p class="muted">まだマッチはありません。お互いにいいねをすると、ここで話せるようになります。</p>'

    return `
      <div class="topbar"><h2>マッチ</h2></div>
      <div class="screen">
        ${incoming}
        <div class="list">${list}</div>
      </div>`
  }

  function bindMatches() {
    document.querySelectorAll('[data-match]').forEach((el) =>
      el.addEventListener('click', () => openChat(el.dataset.match)),
    )
  }

  async function openChat(matchId) {
    const match = state.matches.find((m) => m.matchId === matchId)
    const done = await attempt(() => api('GET', `/matches/${encodeURIComponent(matchId)}/messages`))
    if (!done.ok) return
    state.chat = { matchId, partner: match.partner, messages: done.result }
    state.view = { name: 'chat' }
    render()
  }

  function chatScreen() {
    const { partner, messages } = state.chat
    const bubbles = messages.length
      ? messages
          .map(
            (m) =>
              `<div class="bubble${m.senderId === state.me.id ? ' mine' : ''}">${esc(m.body)}</div>`,
          )
          .join('')
      : '<p class="muted" style="text-align:center;">最初のメッセージを送ってみましょう。</p>'

    return `
      <div class="topbar">
        <button class="link" data-back>もどる</button>
        <h2>${esc(partner.displayName)}</h2>
      </div>
      <div class="screen" style="padding-bottom:16px;">
        <div class="letter">
          <div class="meta">${partner.introduction.authorRole === 'OPERATOR' ? '運営' : '紹介者'}による紹介</div>
          <p>${esc(partner.introduction.text)}</p>
        </div>
        <div class="thread" id="thread">${bubbles}</div>
        <div class="composer">
          <input id="messageInput" placeholder="メッセージを入力" autocomplete="off" />
          <button id="sendBtn">送る</button>
        </div>
      </div>`
  }

  function bindChat() {
    const input = document.getElementById('messageInput')
    const thread = document.getElementById('thread')
    if (thread) thread.scrollTop = thread.scrollHeight

    const send = async () => {
      const body = input.value.trim()
      if (!body) return
      const done = await attempt(() =>
        api('POST', `/matches/${encodeURIComponent(state.chat.matchId)}/messages`, { body }),
      )
      if (!done.ok) return
      input.value = ''
      state.chat.messages = await api('GET', `/matches/${encodeURIComponent(state.chat.matchId)}/messages`)
      render()
    }

    document.getElementById('sendBtn').addEventListener('click', send)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send()
    })
  }

  // ---- 画面: 紹介する ------------------------------------------------------

  function referScreen() {
    const list = state.invitations.length
      ? state.invitations
          .map((i) => {
            const label =
              i.status === 'USED' ? '登録済み' : i.status === 'REVOKED' ? '取り消し' : '未使用'
            return `
          <div class="list-item" style="cursor:default;">
            <span class="who">
              <strong>${esc(i.inviteeName)}</strong>
              <small>${esc(i.code)}　/　${label}</small>
            </span>
            ${i.status === 'ISSUED' ? `<button class="quiet" data-revoke="${esc(i.id)}">取消</button>` : ''}
          </div>`
          })
          .join('')
      : '<p class="muted">まだ誰も紹介していません。</p>'

    return `
      <div class="topbar"><h2>紹介する</h2></div>
      <div class="screen">
        <div class="card">
          <h3>知人を紹介する</h3>
          <p class="muted" style="margin-top:0;">
            紹介文は必ず書いていただきます。あなたの言葉が、その方のプロフィールに一生ついて回ります。
          </p>
          <div class="field">
            <label for="invName">お相手のお名前</label>
            <input id="invName" autocomplete="off" />
          </div>
          <div class="field">
            <label for="invEmail">お相手のメールアドレス</label>
            <input id="invEmail" type="email" autocomplete="off" />
          </div>
          <div class="field">
            <label for="invRelationship">あなたとの関係</label>
            <select id="invRelationship">
              ${Object.entries(RELATIONSHIP)
                .map(([value, label]) => `<option value="${value}">${esc(label)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field">
            <label for="invText">紹介文（100文字以上）</label>
            <textarea id="invText" placeholder="どんな方か、なぜ紹介したいのかを書いてください"></textarea>
            <div class="counter" id="invCounter"></div>
          </div>
          <button class="block" id="issueBtn">招待コードを発行</button>
        </div>

        <div class="card">
          <h3>発行した招待</h3>
          <div class="list">${list}</div>
        </div>
      </div>`
  }

  function bindRefer() {
    const text = document.getElementById('invText')
    const counter = document.getElementById('invCounter')
    const update = () => {
      const n = text.value.trim().length
      counter.textContent = `${n} / 100文字`
      counter.className = n < 100 ? 'counter short' : 'counter'
    }
    text.addEventListener('input', update)
    update()

    document.getElementById('issueBtn').addEventListener('click', async () => {
      const done = await attempt(() =>
        api('POST', '/me/invitations', {
          inviteeName: document.getElementById('invName').value,
          inviteeEmail: document.getElementById('invEmail').value,
          relationship: document.getElementById('invRelationship').value,
          introduction: text.value,
        }),
      )
      if (!done.ok) return
      toast(`招待コード ${done.result.code} を発行しました`)
      state.invitations = await api('GET', '/me/invitations')
      render()
    })

    document.querySelectorAll('[data-revoke]').forEach((el) =>
      el.addEventListener('click', async () => {
        const done = await attempt(
          () => api('DELETE', `/me/invitations/${encodeURIComponent(el.dataset.revoke)}`),
          '招待を取り消しました',
        )
        if (!done.ok) return
        state.invitations = await api('GET', '/me/invitations')
        render()
      }),
    )
  }

  // ---- 画面: マイページ ----------------------------------------------------

  function meScreen() {
    const me = state.me
    return `
      <div class="topbar"><h2>マイページ</h2></div>
      <div class="screen">
        <div class="card" style="text-align:center;">
          ${pictureHtml(me, 'avatar large')}
          <h3 style="margin:10px 0 2px;">${esc(me.displayName)}</h3>
          <div class="muted">${me.age}歳・${esc(GENDER[me.gender] || '')}・${esc(me.prefecture)}</div>
          <div class="badges" style="justify-content:center; margin-top:10px;">
            ${me.badges.identityVerified ? '<span class="badge verified">本人確認済み</span>' : ''}
            ${me.badges.singleCertified ? '<span class="badge single">独身証明済み</span>' : ''}
            <span class="badge">${esc(STATUS_TEXT[me.status])}</span>
          </div>
        </div>

        <div class="card">
          <h3>あなたの紹介文</h3>
          <p class="muted" style="margin-top:0;">紹介してくれた方が書いた文章です。ご本人は編集できません。</p>
          <div class="letter">
            <div class="meta">${me.introduction.authorRole === 'OPERATOR' ? '運営' : '紹介者'}による紹介</div>
            <p>${esc(me.introduction.text)}</p>
          </div>
        </div>

        <div class="card">
          <h3>プロフィール</h3>
          <p style="font-size:13.5px;">${esc(me.profile.bio || '未入力')}</p>
          <button class="block quiet" id="editProfileBtn">入会手続き・プロフィールを開く</button>
        </div>

        <button class="block quiet" id="logoutBtn">ログアウト</button>
      </div>`
  }

  function bindMe() {
    document.getElementById('logoutBtn').addEventListener('click', () => signOut())
    document.getElementById('editProfileBtn').addEventListener('click', async () => {
      state.view = { name: 'onboarding' }
      await refreshOnboarding()
    })
  }

  // ---- タブと描画 ----------------------------------------------------------

  const TABS = [
    { key: 'discover', label: 'さがす', glyph: '探' },
    { key: 'matches', label: 'マッチ', glyph: '縁' },
    { key: 'refer', label: '紹介', glyph: '紹' },
    { key: 'me', label: 'マイページ', glyph: '己' },
  ]

  function tabbar() {
    return `<nav class="tabbar">${TABS.map(
      (t) => `
      <button data-tab="${t.key}" aria-current="${state.tab === t.key}">
        <span class="glyph">${t.glyph}</span>${t.label}
        ${t.key === 'matches' && state.incoming.length ? '<span class="tab-dot"></span>' : ''}
      </button>`,
    ).join('')}</nav>`
  }

  async function switchTab(tab) {
    state.tab = tab
    state.view = null
    await loadTabData()
    render()
  }

  async function loadTabData() {
    if (!state.me || state.me.status !== 'ACTIVE') return
    try {
      if (state.tab === 'discover') state.candidates = await api('GET', '/discover')
      if (state.tab === 'matches') {
        state.matches = await api('GET', '/matches')
        state.incoming = await api('GET', '/likes/incoming')
      }
      if (state.tab === 'refer') state.invitations = await api('GET', '/me/invitations')
    } catch (error) {
      toast(error.message, true)
    }
  }

  function setupScreen() {
    return `
      <div class="screen centered">
        <div class="brand">
          <h1>紹介</h1>
          <p>あと一歩で公開できます</p>
        </div>
        <div class="card">
          <h3>データベースが未設定です</h3>
          <p class="muted" style="margin-top:0;">
            Vercel のプロジェクト設定で環境変数を追加し、もう一度デプロイしてください。
          </p>
          <ul class="muted" style="padding-left:1.2em;">
            <li><code>SUPABASE_URL</code></li>
            <li><code>SUPABASE_SERVICE_ROLE_KEY</code></li>
            <li><code>OPERATOR_KEY</code>（運営用APIの合言葉。任意の長い文字列）</li>
          </ul>
          <p class="muted">
            サービスロールキーは Supabase の Project Settings → API Keys で確認できます。
            この鍵はサーバー側だけで使うもので、ブラウザには渡りません。
          </p>
        </div>
      </div>`
  }

  function render() {
    if (state.setupNeeded) {
      root.innerHTML = setupScreen()
      return
    }

    // 未ログイン
    if (!state.me) {
      if (state.view && state.view.name === 'register') {
        root.innerHTML = registerScreen(state.view.invitation)
        document.querySelector('[data-back]').addEventListener('click', () => {
          state.view = null
          render()
        })
        bindRegister(state.view.invitation, state.view.code)
        return
      }
      root.innerHTML = welcomeScreen()
      bindWelcome()
      return
    }

    // 会話画面はタブの上に重ねる
    if (state.view && state.view.name === 'chat') {
      root.innerHTML = chatScreen()
      document.querySelector('[data-back]').addEventListener('click', () => switchTab('matches'))
      bindChat()
      return
    }

    // 入会が終わるまでは手続き画面に留める
    if (state.me.status !== 'ACTIVE' || (state.view && state.view.name === 'onboarding')) {
      root.innerHTML = onboardingScreen() + (state.me.status === 'ACTIVE' ? tabbar() : '')
      bindOnboarding()
      bindTabbar()
      return
    }

    const screens = {
      discover: discoverScreen,
      matches: matchesScreen,
      refer: referScreen,
      me: meScreen,
    }
    root.innerHTML = screens[state.tab]() + tabbar()

    if (state.tab === 'discover') bindDiscover()
    if (state.tab === 'matches') bindMatches()
    if (state.tab === 'refer') bindRefer()
    if (state.tab === 'me') bindMe()
    bindTabbar()
  }

  function bindTabbar() {
    document.querySelectorAll('[data-tab]').forEach((el) =>
      el.addEventListener('click', () => switchTab(el.dataset.tab)),
    )
  }

  async function loadMe() {
    try {
      state.me = await api('GET', '/me')
      if (state.me.status !== 'ACTIVE') {
        state.screening = await api('GET', '/me/screening')
      } else {
        await loadTabData()
      }
    } catch {
      state.me = null
    }
  }

  ;(async function start() {
    // 設定漏れのまま真っ白な画面を出さず、何が足りないかを画面で伝える。
    try {
      await api('GET', '/health')
    } catch (error) {
      if (error.code === 'DATABASE_NOT_CONFIGURED') {
        state.setupNeeded = true
        render()
        return
      }
    }
    if (state.token) await loadMe()
    render()
  })()
})()
