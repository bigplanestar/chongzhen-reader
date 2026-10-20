import {deriveKey, seal, unseal, toBase64} from './crypto.mjs';

const OWNER = 'bigplanestar', REPO = 'chongzhen-reader';
const API = 'https://api.github.com';
const clone = value => structuredClone(value);
const chapterPath = id => 'data/chapters/' + String(id).padStart(4, '0') + '.json';
const stamp = () => new Date().toISOString();
const problem = (message, status = 400) => Object.assign(new Error(message), {status});

export function brief(record) {
  const chapter = record.chapter;
  const revision = record.revisions.find(r => r.rev === chapter.current_rev);
  if (!revision || revision.chapter_id !== chapter.id) throw problem('章节版本数据不完整。');
  return {...chapter, title: revision.title, words: Array.from(revision.content.replace(/\s/g, '')).length,
    status: chapter.approved_rev === chapter.current_rev ? 'approved' : 'pending', conflict: !!chapter.incoming};
}

export function view(record) {
  const result = brief(record);
  const revision = record.revisions.find(r => r.rev === record.chapter.current_rev);
  delete result.source_content;
  return {...result, content: revision.content, events: clone(record.events)};
}

function catalogItem(record) {
  const row = brief(record), result = {};
  for (const field of ['id', 'volume', 'volume_title', 'source_stage', 'current_rev', 'approved_rev',
    'approved_at', 'approved_by', 'updated_at', 'title', 'words', 'status', 'conflict']) result[field] = row[field];
  return result;
}

export function applyChange(record, action, data, author) {
  record = clone(record);
  const chapter = record.chapter;
  if (!Number.isInteger(data.expected_rev) || data.expected_rev !== chapter.current_rev)
    throw problem('另一台设备已经更新了本章。请保留输入的文字，刷新后对照合并。', 409);
  const note = String(data.note || '').trim().slice(0, 2000);
  const now = stamp();
  const addRevision = (title, content, reason) => {
    title = String(title || '').trim(); content = String(content || '').trim();
    if (!title || title.length > 160 || !content || content.length > 200000)
      throw problem('请填写有效的标题和正文。');
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(title + content))
      throw problem('文字中含有不支持的控制字符。');
    chapter.current_rev += 1;
    record.revisions.push({chapter_id: chapter.id, rev: chapter.current_rev, title, content,
      author, reason, created_at: now});
    chapter.approved_rev = chapter.approved_at = chapter.approved_by = null;
    chapter.updated_at = now;
  };
  if (action === 'save') addRevision(data.title, data.content, note || '网站修改');
  else if (action === 'restore') {
    const old = record.revisions.find(r => r.rev === data.revision);
    if (!old) throw problem('没有找到这个历史版本。', 404);
    addRevision(old.title, old.content, '恢复第 ' + old.rev + ' 版');
  } else if (action === 'approve' || action === 'unapprove') {
    if (chapter.incoming) throw problem('请先处理待合并的新稿，再批准本章。', 409);
    chapter.approved_rev = action === 'approve' ? chapter.current_rev : null;
    chapter.approved_at = action === 'approve' ? now : null;
    chapter.approved_by = action === 'approve' ? author : null;
    chapter.updated_at = now;
    record.events.push({id: crypto.randomUUID(), chapter_id: chapter.id, rev: chapter.current_rev,
      action, author, note, created_at: now});
  } else if (action === 'resolve') {
    const incoming = chapter.incoming;
    if (!incoming || incoming.hash !== data.incoming_hash) throw problem('待合并稿已变化，请重新查看。', 409);
    if (data.choice === 'adopt') addRevision(incoming.title, incoming.content, '采用同步的新稿');
    else if (data.choice !== 'keep') throw problem('合并方式不受支持。');
    chapter.source_title = incoming.title; chapter.source_content = incoming.content;
    chapter.source_hash = incoming.hash; chapter.source_stage = incoming.stage;
    chapter.incoming = null;
  } else throw problem('不支持这个操作。', 404);
  return record;
}

export class PagesStore {
  constructor({fetcher = globalThis.fetch.bind(globalThis), base = new URL('./', globalThis.location?.href || 'http://localhost/'), storage = globalThis.localStorage, branch = 'main'} = {}) {
    if (!/^[a-zA-Z0-9_-]+$/.test(branch)) throw problem('无效的书稿分支。');
    this.fetcher = fetcher; this.base = base; this.storage = storage;
    this.branch = branch;
    this.key = null; this.token = ''; this.name = '作者'; this.catalog = null;
    this.config = null; this.revision = null; this.cache = new Map();
  }

  context(purpose) { return this.config.book_id + ':' + purpose; }
  credentialKey() { return 'cz.pages.github.' + this.config.book_id; }

  async json(url, options = {}) {
    let response;
    try { response = await this.fetcher(url, {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(25000), ...options}); }
    catch { throw problem('暂时连接不到 GitHub，请检查网络后重试。', 503); }
    if (!response.ok) {
      if (response.status === 409 || response.status === 422)
        throw problem('保存期间另一个页面更新了书稿。你的输入仍然保留，请刷新后对照合并。', 409);
      if (response.status === 401) throw problem('GitHub 连接已失效，请重新连接编辑。', 401);
      if (response.status === 403) throw problem('GitHub 拒绝了请求。请确认密钥具有本仓库的 Contents 读写权限，或稍后重试。', 403);
      throw problem('GitHub 返回 HTTP ' + response.status + '，操作尚未确认完成。', response.status);
    }
    try { return await response.json(); }
    catch { throw problem('GitHub 返回的数据不完整，请重试。', 502); }
  }

  async github(method, path, body, token = this.token) {
    const headers = {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return this.json(API + path, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  }

  repo(path) { return '/repos/' + OWNER + '/' + REPO + path; }

  async file(path, revision = this.revision) {
    if (!/^data\/(catalog\.json|chapters\/\d{4}\.json)$/.test(path)) throw problem('无效的书稿路径。');
    if (revision) return this.json('https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + revision + '/' + path);
    return this.json(new URL(path, this.base));
  }

  async initialize() {
    if (this.config) return;
    const config = await this.json(new URL('book.json', this.base));
    if (config.format !== 'cz-pages-v1' || config.owner !== OWNER || config.repo !== REPO || config.branch !== 'main')
      throw problem('书房配置与指定仓库不一致。');
    this.config = config;
    try {
      const head = await this.github('GET', this.repo('/git/ref/heads/' + this.branch));
      const box = await this.file('data/catalog.json', head.object.sha);
      this.revision = head.object.sha; this.catalogBox = box;
    } catch {
      // GitHub API throttling must not prevent password-protected reading from Pages.
      this.revision = null; this.catalogBox = await this.file('data/catalog.json', null);
    }
  }

  async unlock(password) {
    await this.initialize();
    const key = await deriveKey(password, this.config);
    let catalog;
    try { catalog = await unseal(key, this.catalogBox, this.context('catalog')); }
    catch { throw problem('访问密码不正确，或加密书稿受损。请使用迁移版书房密码。', 401); }
    if (catalog.format !== 'cz-catalog-v1' || catalog.chapters.length !== this.config.chapters)
      throw problem('章节目录不完整。');
    this.key = key; this.catalog = catalog;
    let remembered;
    try { remembered = JSON.parse(this.storage?.getItem(this.credentialKey()) || 'null'); } catch {}
    if (remembered) {
      try {
        const saved = await unseal(key, remembered, this.context('github-credential'));
        await this.connect(saved.token, saved.name, false, false);
      } catch { this.token = ''; }
    }
  }

  session() {
    return {logged_in: !!this.key, name: this.name, can_write: !!this.token,
      setup_required: false, read_login_required: true, setup_allowed: false};
  }

  async connect(token, name, remember, validateWrite = true) {
    if (!this.key) throw problem('请先打开书房。', 401);
    token = String(token || '').trim();
    if (!token || /\s/.test(token)) throw problem('请填写有效的 GitHub 访问密钥。');
    const user = await this.github('GET', '/user', undefined, token);
    if (user.login.toLowerCase() !== OWNER) throw problem('请连接 bigplanestar 的 GitHub 账号。', 403);
    const repository = await this.github('GET', this.repo(''), undefined, token);
    if (!repository.permissions?.push) throw problem('这个 GitHub 账号没有仓库写入权限。', 403);
    if (validateWrite) await this.github('POST', this.repo('/git/blobs'),
      {content: 'Reading room write permission check', encoding: 'utf-8'}, token);
    const editorName = String(name || user.name || user.login).trim().slice(0, 40);
    if (remember) {
      const box = await seal(this.key, {token, name: editorName}, this.context('github-credential'));
      try { this.storage?.setItem(this.credentialKey(), JSON.stringify(box)); }
      catch { throw problem('浏览器无法保存连接，请取消“在此设备记住连接”后重试。'); }
    }
    this.token = token; this.name = editorName;
  }

  lock() {
    if (this.config) { try { this.storage?.removeItem(this.credentialKey()); } catch {} }
    this.token = ''; this.key = null; this.catalog = null; this.cache.clear();
  }

  async record(id) {
    if (!this.key) throw problem('请先打开书房。', 401);
    if (!Number.isInteger(id) || !this.catalog.chapters.some(c => c.id === id)) throw problem('没有这一个章节。', 404);
    if (!this.cache.has(id)) {
      const box = await this.file(chapterPath(id));
      const result = await unseal(this.key, box, this.context('chapter:' + id));
      if (result.chapter.id !== id) throw problem('章节编号不匹配。');
      this.cache.set(id, result);
    }
    return this.cache.get(id);
  }

  async currentFile(path, revision) {
    return this.json(API + this.repo('/contents/' + path) + '?ref=' + encodeURIComponent(revision), {
      headers: {Accept: 'application/vnd.github.raw+json', Authorization: 'Bearer ' + this.token,
        'X-GitHub-Api-Version': '2022-11-28'}});
  }

  async mutate(id, action, data) {
    if (!this.key || !this.token) throw problem('请先连接 GitHub 编辑，修改才会保存到所有设备共用的书稿。', 401);
    const head = await this.github('GET', this.repo('/git/ref/heads/' + this.branch));
    const base = head.object.sha;
    const [commit, recordBox, catalogBox] = await Promise.all([
      this.github('GET', this.repo('/git/commits/' + base)),
      this.currentFile(chapterPath(id), base), this.currentFile('data/catalog.json', base)]);
    const record = await unseal(this.key, recordBox, this.context('chapter:' + id));
    const catalog = await unseal(this.key, catalogBox, this.context('catalog'));
    if (record.chapter.id !== id) throw problem('章节编号不匹配。');
    const updated = applyChange(record, action, data, this.name);
    const index = catalog.chapters.findIndex(c => c.id === id);
    if (index < 0) throw problem('目录中缺少这个章节。');
    catalog.chapters[index] = catalogItem(updated); catalog.updated_at = stamp();
    const fileValues = [[chapterPath(id), await seal(this.key, updated, this.context('chapter:' + id))],
      ['data/catalog.json', await seal(this.key, catalog, this.context('catalog'))]];
    const treeItems = [];
    for (const [path, value] of fileValues) {
      const blob = await this.github('POST', this.repo('/git/blobs'),
        {content: toBase64(new TextEncoder().encode(JSON.stringify(value) + '\n')), encoding: 'base64'});
      treeItems.push({path, mode: '100644', type: 'blob', sha: blob.sha});
    }
    const tree = await this.github('POST', this.repo('/git/trees'), {base_tree: commit.tree.sha, tree: treeItems});
    const saved = await this.github('POST', this.repo('/git/commits'),
      {message: '书房：更新第 ' + id + ' 章及审阅状态', tree: tree.sha, parents: [base]});
    // Ref updates must remain fast-forward-only: another device's commit wins over stale input.
    await this.github('PATCH', this.repo('/git/refs/heads/' + this.branch), {sha: saved.sha, force: false});
    this.revision = saved.sha; this.catalog = catalog; this.catalogBox = fileValues[1][1];
    this.cache.clear(); this.cache.set(id, updated);
    return view(updated);
  }

  async refresh() {
    if (!this.key) return;
    try {
      const head = await this.github('GET', this.repo('/git/ref/heads/' + this.branch));
      const box = await this.file('data/catalog.json', head.object.sha);
      const catalog = await unseal(this.key, box, this.context('catalog'));
      this.revision = head.object.sha; this.catalog = catalog; this.catalogBox = box; this.cache.clear();
    } catch (error) {
      // A failed refresh is reported rather than claiming an old catalog is up to date.
      throw problem('暂时未能取得 GitHub 上的最新书稿。当前已打开的文字仍可阅读。', error.status || 503);
    }
  }

  async export(progress = () => {}) {
    if (!this.key) throw problem('请先打开书房。', 401);
    const results = new Array(this.catalog.chapters.length); let cursor = 0, finished = 0;
    const workers = Array.from({length: 6}, async () => {
      while (cursor < results.length) {
        const position = cursor++; results[position] = clone(await this.record(this.catalog.chapters[position].id));
        progress(++finished, results.length);
      }
    });
    await Promise.all(workers);
    return {format: 'novel-reader-1', title: this.catalog.title, exported_at: stamp(),
      chapters: results.map(r => r.chapter), revisions: results.flatMap(r => r.revisions),
      events: results.flatMap(r => r.events)};
  }

  async dispatch(path, data) {
    await this.initialize();
    if (path === '/api/session') return this.session();
    if (path === '/api/login') { await this.unlock(data.password); return this.session(); }
    if (path === '/api/logout') { this.lock(); return {ok: true}; }
    if (!this.key) throw problem('请先打开书房。', 401);
    if (path === '/api/chapters') {
      const chapters = clone(this.catalog.chapters);
      return {chapters, stats: {total: chapters.length, approved: chapters.filter(c => c.status === 'approved').length,
        draft: chapters.filter(c => c.source_stage === 'draft').length, conflicts: chapters.filter(c => c.conflict).length}};
    }
    if (path === '/api/export') return this.export();
    const match = path.match(/^\/api\/chapters\/(\d+)(?:\/(save|approve|unapprove|restore|resolve|history)(?:\/(\d+))?)?$/);
    if (!match) throw problem('操作不受支持。', 404);
    const id = Number(match[1]), action = match[2];
    if (data !== undefined) return this.mutate(id, action, data);
    const record = await this.record(id);
    if (!action) return view(record);
    if (action === 'history') {
      if (match[3]) {
        const revision = record.revisions.find(r => r.rev === Number(match[3]));
        if (!revision) throw problem('找不到这个历史版本。', 404);
        return clone(revision);
      }
      return clone([...record.revisions].sort((a, b) => b.rev - a.rev));
    }
    throw problem('操作不受支持。', 404);
  }
}
