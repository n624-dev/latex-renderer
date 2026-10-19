export const siteScript = `
(() => {
  const key = 'latex-renderer-theme';
  const allowed = new Set(['system', 'light', 'dark']);
  const stored = localStorage.getItem(key);
  const initial = stored && allowed.has(stored) ? stored : 'system';

  const apply = (theme) => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = theme;
  };

  const label = (theme) => theme === 'light' ? 'ライト' : theme === 'dark' ? 'ダーク' : 'システム';
  const syncButtons = (theme) => {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.textContent = '表示: ' + label(theme);
      button.setAttribute('aria-label', '表示テーマを変更。現在は' + label(theme));
    });
  };

  apply(initial);
  document.addEventListener('DOMContentLoaded', () => {
    const revealFragment = () => {
      let id;
      try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      target.scrollIntoView({ block: 'start' });
    };
    revealFragment();
    window.addEventListener('hashchange', revealFragment);
    // Static API documentation has the shared header, but no admin app bundle.
    document.querySelectorAll('[data-session-logout]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          const session = await fetch('/auth/session', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
          if (session.status === 401) { location.replace('/login/'); return; }
          if (!session.ok) throw new Error('セッションを確認できません。');
          const value = await session.json();
          if (typeof value.csrfToken !== 'string' || !value.csrfToken) throw new Error('セッションを再読み込みしてください。');
          const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'X-CSRF-Token': value.csrfToken } });
          if (!response.ok) throw new Error('ログアウトできませんでした。');
          location.replace('/login/');
        } catch (error) {
          const message = document.querySelector('#session-error');
          if (message) message.textContent = error instanceof Error ? error.message : 'ログアウトできませんでした。';
          button.disabled = false;
        }
      });
    });
    const docsMenu = document.querySelector('.docs-menu');
    if (docsMenu) {
      const narrow = window.matchMedia('(max-width: 820px)');
      const syncMenu = () => { docsMenu.open = !narrow.matches; };
      syncMenu();
      narrow.addEventListener('change', syncMenu);
    }
    let current = document.documentElement.dataset.themePreference || 'system';
    syncButtons(current);
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        current = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
        localStorage.setItem(key, current);
        apply(current);
        syncButtons(current);
      });
    });

    document.querySelectorAll('.docs-content pre').forEach((pre) => {
      const block = document.createElement('div');
      block.className = 'code-block';
      const toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.textContent = 'コピー';
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || '');
        button.textContent = 'コピー済み';
        window.setTimeout(() => { button.textContent = 'コピー'; }, 1500);
      });
      pre.before(block);
      toolbar.append(button);
      block.append(toolbar, pre);
    });

    const search = document.querySelector('#docs-search');
    const results = document.querySelector('#docs-search-results');
    if (search && results) {
      let indexPromise;
      const loadIndex = () => indexPromise ||= fetch('/assets/docs-search.json').then((response) => {
        if (!response.ok) throw new Error('Search index unavailable');
        return response.json();
      });
      search.addEventListener('input', async () => {
        const query = search.value.normalize('NFKC').trim().toLocaleLowerCase('ja');
        results.replaceChildren();
        if (query.length < 2) return;
        try {
          const index = await loadIndex();
          const matches = index.filter((item) =>
            [item.title, item.description, item.category, item.text, ...item.headings.map((heading) => heading.text)]
              .join(' ').normalize('NFKC').toLocaleLowerCase('ja').includes(query)
          ).slice(0, 8);
          const list = document.createElement('ul');
          for (const item of matches) {
            const entry = document.createElement('li');
            const link = document.createElement('a');
            link.href = item.url;
            link.textContent = item.title + ' — ' + item.description;
            entry.append(link);
            list.append(entry);
          }
          if (matches.length === 0) results.textContent = '一致するページはありません。';
          else results.append(list);
        } catch {
          results.textContent = '検索索引を読み込めませんでした。';
        }
      });
    }
  });
})();
`;
