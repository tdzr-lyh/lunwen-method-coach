(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ThesisCloud = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
"use strict";
const AUTH_STORAGE_KEY = "lunwen-method-coach:auth:v1";
const CACHE_PREFIX = "lunwen-method-coach:cloud:v1:";

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isState(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function online() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function signupRedirectUrl() {
  const href = globalThis.location?.href;
  if (!href) return null;
  try {
    const url = new URL("./", href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Account-isolated snapshots with durable drafts and optimistic cloud writes. */
class CloudSync {
  constructor({ onStatus, onRemote, onConflict, onAuth, validateState, pollInterval = 5000 } = {}) {
    this._callbacks = { onStatus, onRemote, onConflict, onAuth };
    this._validate = validateState || copy;
    this._pollInterval = pollInterval;
    this._pollTimer = null;
    this._hasRemote = false;
    this._cacheWriteError = false;
    this._client = null;
    this._user = null;
    this._cache = null;
    this._revision = null;
    this._conflict = null;
    this._generation = 0;
    this._syncPromise = null;
    this._initPromise = null;
    this._authInitialized = false;
    this._subscription = null;
    this._lastRemote = "";
    this._onOnline = () => { void this.pull(); };
    this._onFocus = () => { if (online()) void this.pull(); };
    this._onVisible = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") void this.pull(); };
    if (typeof window !== "undefined") {
      window.addEventListener("online", this._onOnline);
      window.addEventListener("focus", this._onFocus);
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", this._onVisible);
    }
  }

  get configured() {
    const config = globalThis.THESIS_CLOUD_CONFIG || {};
    return Boolean(
      config.provider === "supabase" && config.url && config.anonKey &&
      globalThis.supabase?.createClient,
    );
  }

  get user() {
    return this._user;
  }

  _notify(name, ...args) {
    try {
      this._callbacks[name]?.(...args);
    } catch (error) {
      console.warn(`Thesis coach ${name} callback failed.`, error);
    }
  }

  _status(kind, message) {
    this._notify("onStatus", kind, message);
  }

  _ensureClient() {
    if (!this.configured) return null;
    if (!this._client) {
      const config = globalThis.THESIS_CLOUD_CONFIG;
      this._client = globalThis.supabase.createClient(config.url, config.anonKey, {
        auth: {
          storageKey: AUTH_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    return this._client;
  }

  _readCache(userId) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${userId}`);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (value.userId !== userId || !isState(value.state)) return null;
      const revision = value.baseRevision;
      return {
        version: 1,
        userId,
        state: this._validate(value.state),
        baseRevision: Number.isInteger(revision) && revision >= 0 ? revision : null,
        dirty: value.dirty === true,
        savedAt: value.savedAt || "",
      };
    } catch {
      return null;
    }
  }

  _writeCache() {
    if (!this._user || !this._cache || this._cache.userId !== this._user.id) return;
    try {
      localStorage.setItem(`${CACHE_PREFIX}${this._user.id}`, JSON.stringify(this._cache));
      this._cacheWriteError = false;
    } catch {
      this._cacheWriteError = true;
      this._status("error", "此设备无法保存草稿，请勿关闭页面；可先导出备份，或等待云端同步成功。");
    }
  }

  _snapshot() {
    const result = { user: this._user, revision: this._revision, dirty: this._cache?.dirty === true, hasRemote: this._hasRemote };
    if (this._cache) result.state = copy(this._cache.state);
    if (this._conflict) result.conflict = true;
    return result;
  }

  _current(generation, userId) {
    return this._generation === generation && this._user?.id === userId;
  }

  _emitRemote(state, revision) {
    const signature = `${this._user?.id}:${revision}:${JSON.stringify(state)}`;
    if (this._lastRemote === signature) return;
    this._lastRemote = signature;
    this._notify("onRemote", copy(state), revision);
  }

  _setConflict(remote, revision) {
    this._conflict = { remote: copy(remote), revision };
    this._status("conflict", "其他设备更新了学习记录。此设备草稿已保留，请核对两份记录后继续同步。");
    this._notify("onConflict", {
      local: copy(this._cache?.state),
      remote: copy(remote),
      revision,
    });
  }

  _syncError(error) {
    if (this._cacheWriteError && this._cache?.dirty) {
      this._status("error", "云端尚未同步，此设备也无法保存草稿。请勿关闭页面，先导出备份后再重试。");
      return;
    }
    const missingSetup = ["42P01", "42883", "PGRST202", "PGRST205"].includes(error?.code);
    if (missingSetup) {
      this._status("error", "云端学习服务尚未准备好，此设备记录已保留，请稍后重试。");
    } else if (!online() || /fetch|network|connection|timeout/i.test(String(error?.message || error))) {
      this._status("offline", "暂时无法连接云端，草稿已保存在此设备，联网后会先核对版本再同步。");
    } else {
      this._status("error", "云端同步未完成，本机草稿已保留。请检查网络及云端配置后重试。");
    }
  }

  async _activate(user) {
    const userId = user?.id || null;
    if (this._authInitialized && this._user?.id === userId) {
      if (this._syncPromise) await this._syncPromise;
      return this._snapshot();
    }
    if (this._authInitialized && !this._user && !user) return this._snapshot();
    this._authInitialized = true;
    this._generation += 1;
    this._syncPromise = null;
    this._user = user || null;
    this._cache = user ? this._readCache(user.id) : null;
    this._cacheWriteError = false;
    this._revision = this._cache?.baseRevision ?? null;
    this._conflict = null;
    this._lastRemote = "";
    this._hasRemote = false;
    this._notify("onAuth", this._user, this._snapshot());
    if (!user) {
      this._status("signed-out", "未登录。此设备可以保存学习进度，登录后可同步到手机和电脑。");
      return this._snapshot();
    }
    return this.pull();
  }

  init() {
    if (!this._initPromise) this._initPromise = this._initialize();
    return this._initPromise;
  }

  async _initialize() {
    const client = this._ensureClient();
    if (!client) {
      this._notify("onAuth", null);
      this._status("error", "云同步暂未连接，此设备记录已保留。");
      return { user: null };
    }
    let result;
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      result = await this._activate(data.session?.user || null);
    } catch (error) {
      this._notify("onAuth", null);
      this._syncError(error);
      result = { user: null };
    }
    this._subscription = client.auth.onAuthStateChange((_event, session) => {
      // Supabase auth callbacks must return before another Supabase operation starts.
      setTimeout(() => { void this._activate(session?.user || null); }, 0);
    }).data.subscription;
    if (typeof window !== "undefined" && typeof document !== "undefined" && this._pollInterval > 0) {
      this._pollTimer = setInterval(() => {
        if (this._user && document.visibilityState !== "hidden" && online()) void this.pull();
      }, this._pollInterval);
    }
    return result;
  }

  current() { return this._snapshot(); }

  dispose() {
    if (this._pollTimer !== null) clearInterval(this._pollTimer);
    this._subscription?.unsubscribe?.();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this._onOnline);
      window.removeEventListener("focus", this._onFocus);
    }
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this._onVisible);
  }

  async signUp(email, password) {
    const client = this._ensureClient();
    if (!client) throw new Error("本站尚未配置云端登录。");
    const redirectUrl = signupRedirectUrl();
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      ...(redirectUrl ? { options: { emailRedirectTo: redirectUrl } } : {}),
    });
    if (error) throw error;
    if (data.session?.user) {
      const snapshot = await this._activate(data.session.user);
      return { ...snapshot, confirmationRequired: false };
    }
    return { confirmationRequired: true };
  }

  async signIn(email, password) {
    const client = this._ensureClient();
    if (!client) throw new Error("本站尚未配置云端登录。");
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    return this._activate(data.user);
  }

  async signOut() {
    if (this._client) {
      const { error } = await this._client.auth.signOut({ scope: "local" });
      if (error) throw error;
    }
    // Pending work stays under its original user ID; it never enters another account.
    return this._activate(null);
  }

  /** Synchronously preserve an edit before a debounce, reload, or background pull. */
  stage(state) {
    if (!isState(state)) throw new TypeError("学习记录必须是一个对象。");
    if (!this._user) return { user: null, localOnly: true };
    this._cache = {
      version: 1,
      userId: this._user.id,
      state: this._validate(state),
      baseRevision: this._cache?.dirty ? this._cache.baseRevision : this._revision,
      dirty: true,
      savedAt: new Date().toISOString(),
    };
    this._writeCache();
    if (this._conflict) {
      this._status("conflict", "最新草稿已保留，等待你处理设备之间的版本冲突。");
    } else if (!this._cacheWriteError) {
      this._status("pending", "最新修改已保存在此设备，等待同步。");
    }
    return this._snapshot();
  }

  async save(state) {
    const staged = this.stage(state);
    if (staged.localOnly || this._conflict) return staged;
    return this.pull();
  }

  pull() {
    if (!this._user || !this._ensureClient()) return Promise.resolve(this._snapshot());
    if (!online()) {
      this._status(this._cacheWriteError ? "error" : "offline", this._cacheWriteError ? "当前离线且此设备无法保存草稿，请勿关闭页面，先导出备份。" : "当前离线，学习记录保存在此设备。联网后会先检查云端版本。");
      return Promise.resolve(this._snapshot());
    }
    if (this._syncPromise) return this._syncPromise;
    const generation = this._generation;
    const userId = this._user.id;
    const operation = this._synchronize(generation, userId).finally(() => {
      if (this._syncPromise === operation) this._syncPromise = null;
    });
    this._syncPromise = operation;
    return operation;
  }

  async _synchronize(generation, userId) {
    this._status("syncing", "正在核对云端学习记录…");
    try {
      const { data, error } = await this._client
        .from("thesis_coach_states")
        .select("state,revision,updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (!this._current(generation, userId)) return this._snapshot();
      if (error) throw error;
      const remoteState = isState(data?.state) ? this._validate(data.state) : null;
      this._hasRemote = remoteState !== null;
      const remoteRevision = Number.isInteger(data?.revision) ? data.revision : 0;

      if (this._cache?.dirty) {
        if (this._conflict) {
          this._setConflict(remoteState, remoteRevision);
          return this._snapshot();
        }
        if (this._cache.baseRevision === null && remoteRevision === 0) {
          this._cache.baseRevision = 0;
          this._writeCache();
        }
        if (this._cache.baseRevision !== remoteRevision) {
          this._setConflict(remoteState, remoteRevision);
          return this._snapshot();
        }
        this._revision = remoteRevision;
        await this._flush(generation, userId);
      } else {
        this._revision = remoteRevision;
        if (remoteState) {
          this._cache = {
            version: 1,
            userId,
            state: copy(remoteState),
            baseRevision: remoteRevision,
            dirty: false,
            savedAt: data.updated_at || new Date().toISOString(),
          };
          this._writeCache();
          this._emitRemote(remoteState, remoteRevision);
        }
        // No row means a new account, not an instruction to upload or apply {}.
        this._status("ready", remoteState ? "学习记录已与云端同步。" : "账号已连接，完成一次训练后即可保存到云端。");
      }
    } catch (error) {
      if (this._current(generation, userId)) this._syncError(error);
    }
    return this._snapshot();
  }

  async _flush(generation, userId) {
    while (this._current(generation, userId) && this._cache?.dirty && !this._conflict) {
      const pending = this._cache;
      const { data, error } = await this._client.rpc("save_thesis_coach_state", {
        p_expected_revision: pending.baseRevision,
        p_state: copy(pending.state),
      });
      if (!this._current(generation, userId)) return;
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result || typeof result.applied !== "boolean" || !Number.isInteger(result.revision)) {
        throw new Error("Unexpected cloud save response.");
      }
      if (!result.applied) {
        this._setConflict(result.state || null, result.revision);
        return;
      }
      this._revision = result.revision;
      this._hasRemote = true;
      if (this._cache === pending) {
        this._cache = {
          ...pending,
          state: this._validate(result.state || pending.state),
          baseRevision: result.revision,
          dirty: false,
          savedAt: result.updated_at || new Date().toISOString(),
        };
      } else {
        // A newer save arrived while the request was in flight; advance its base only.
        this._cache.baseRevision = result.revision;
      }
      this._writeCache();
    }
    if (this._current(generation, userId) && !this._conflict) {
      this._status("ready", "学习记录已与云端同步。");
    }
  }

  async resolveConflict(choice) {
    if (choice !== "local" && choice !== "remote") throw new TypeError("请选择 local 或 remote。");
    if (!this._conflict || !this._user) return this._snapshot();
    const conflict = this._conflict;
    this._conflict = null;
    this._revision = conflict.revision;
    if (choice === "local") {
      this._cache.baseRevision = conflict.revision;
      this._cache.dirty = true;
      this._writeCache();
    } else if (isState(conflict.remote)) {
      this._cache = {
        version: 1,
        userId: this._user.id,
        state: copy(conflict.remote),
        baseRevision: conflict.revision,
        dirty: false,
        savedAt: new Date().toISOString(),
      };
      this._writeCache();
      this._emitRemote(this._cache.state, conflict.revision);
    } else {
      this._cache = null;
      try { localStorage.removeItem(`${CACHE_PREFIX}${this._user.id}`); } catch { /* Optional cache. */ }
      // This clearing operation follows the user's explicit remote choice.
      this._emitRemote({}, 0);
    }
    return this.pull();
  }
}

return { CloudSync };
});
